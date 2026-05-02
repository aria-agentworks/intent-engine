import { Router } from "express";
import { db } from "@workspace/db";
import { voiceCalls, voiceMessages, voiceConfigs, voiceAppointments, voiceWebhookActions } from "@workspace/db";
import { eq, and, ilike, or } from "drizzle-orm";
import { generateVoiceResponseWithFunctions, isWithinBusinessHours, getBusinessHoursSummary } from "./gpt.js";
import { callWebhookAction } from "./integrations.js";
import { sendAppointmentConfirmation } from "./sms.js";
import { openai } from "@workspace/integrations-openai-ai-server";

const router = Router();

function xmlSafe(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function twiml(content: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>\n<Response>${content}</Response>`;
}

function gatherTwiml(action: string, sayText: string): string {
  return twiml(`
    <Say voice="Polly.Joanna-Neural">${xmlSafe(sayText)}</Say>
    <Gather input="speech" action="${action}" method="POST" speechTimeout="3" timeout="10" language="en-US">
    </Gather>
    <Say voice="Polly.Joanna-Neural">I didn't catch that. Thank you for calling. Goodbye!</Say>
    <Hangup/>
  `);
}

function getBaseUrl(req: { headers: Record<string, string | string[] | undefined> }): string {
  const proto = (req.headers["x-forwarded-proto"] as string) || "https";
  const forwardedHost = req.headers["x-forwarded-host"] as string;
  const host = req.headers["host"] as string;
  const replitDomain = process.env.REPLIT_DOMAINS?.split(",")[0];
  const resolvedHost = forwardedHost || replitDomain || host;
  return `${proto}://${resolvedHost}`;
}

async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  callId: string,
  fromNumber: string,
  logger: { error: (obj: object, msg: string) => void }
): Promise<string> {
  try {
    // Check for a configured webhook action first
    const webhookAction = await db.query.voiceWebhookActions.findFirst({
      where: and(
        eq(voiceWebhookActions.actionType, toolName),
        eq(voiceWebhookActions.isActive, true)
      ),
    });

    if (webhookAction) {
      try {
        const result = await callWebhookAction(webhookAction, { ...args, callId });
        return result;
      } catch (err) {
        logger.error({ err }, `Webhook action failed for ${toolName}, falling back to internal`);
      }
    }

    // Internal fallback logic
    switch (toolName) {
      case "book_appointment": {
        const { patientName, patientPhone, requestedDate, requestedTime, reason } = args as Record<string, string>;
        if (!patientName) return JSON.stringify({ success: false, message: "Patient name is required to book an appointment." });

        const [appointment] = await db.insert(voiceAppointments).values({
          callId,
          patientName: patientName || "Unknown",
          patientPhone: patientPhone || fromNumber || "",
          requestedDate: requestedDate || "",
          requestedTime: requestedTime || "",
          reason: reason || "",
          status: "pending",
        }).returning();

        return JSON.stringify({
          success: true,
          appointmentId: appointment.id,
          message: `Appointment request saved for ${patientName}${requestedDate ? ` on ${requestedDate}` : ""}${requestedTime ? ` at ${requestedTime}` : ""}. Our staff will confirm shortly.`,
        });
      }

      case "check_availability": {
        const { requestedDate, requestedTime } = args as Record<string, string>;
        return JSON.stringify({
          success: true,
          available: true,
          message: `We have availability${requestedDate ? ` on ${requestedDate}` : ""}${requestedTime ? ` around ${requestedTime}` : ""}. Would you like to book that time?`,
          slots: ["9:00 AM", "10:30 AM", "2:00 PM", "3:30 PM"],
        });
      }

      case "cancel_appointment": {
        const { patientName, patientPhone, requestedDate } = args as Record<string, string>;
        // Try to find and cancel the appointment
        const searchPhone = patientPhone || fromNumber;
        const existingAppts = await db.query.voiceAppointments.findMany({
          where: and(
            ilike(voiceAppointments.patientName, `%${patientName || ""}%`),
          ),
          orderBy: (a, { desc }) => [desc(a.createdAt)],
          limit: 5,
        });

        const toCancel = requestedDate
          ? existingAppts.find((a) => a.requestedDate?.includes(requestedDate))
          : existingAppts[0];

        if (toCancel) {
          await db.update(voiceAppointments)
            .set({ status: "cancelled", updatedAt: new Date() })
            .where(eq(voiceAppointments.id, toCancel.id));
          return JSON.stringify({
            success: true,
            message: `Appointment cancelled for ${patientName}${toCancel.requestedDate ? ` on ${toCancel.requestedDate}` : ""}.`,
          });
        }

        return JSON.stringify({
          success: false,
          message: `No appointment found for ${patientName || "that name"}. Please call back during business hours to cancel.`,
        });
      }

      case "lookup_patient": {
        const { patientName, patientPhone } = args as Record<string, string>;
        const searchPhone = patientPhone || fromNumber;

        const appointments = await db.query.voiceAppointments.findMany({
          where: or(
            patientName ? ilike(voiceAppointments.patientName, `%${patientName}%`) : undefined,
            searchPhone ? ilike(voiceAppointments.patientPhone, `%${searchPhone}%`) : undefined,
          ),
          orderBy: (a, { desc }) => [desc(a.createdAt)],
          limit: 3,
        });

        if (appointments.length === 0) {
          return JSON.stringify({
            found: false,
            message: "No records found for that patient.",
          });
        }

        const appt = appointments[0]!;
        return JSON.stringify({
          found: true,
          message: `Found record for ${appt.patientName}.${appt.requestedDate ? ` Next appointment: ${appt.requestedDate}${appt.requestedTime ? ` at ${appt.requestedTime}` : ""}` : ""} Status: ${appt.status}.`,
          appointments: appointments.map((a) => ({
            date: a.requestedDate,
            time: a.requestedTime,
            reason: a.reason,
            status: a.status,
          })),
        });
      }

      default:
        return JSON.stringify({ message: "Action completed." });
    }
  } catch (err) {
    logger.error({ err }, `Tool execution failed: ${toolName}`);
    return JSON.stringify({ success: false, message: "I'm having trouble accessing that information right now." });
  }
}

async function startCallRecording(
  callSid: string,
  baseUrl: string,
  config: { twilioAccountSid?: string | null; twilioAuthToken?: string | null },
  logger: { error: (obj: object, msg: string) => void }
) {
  if (!config.twilioAccountSid || !config.twilioAuthToken) return;
  try {
    const twilio = (await import("twilio")).default;
    const client = twilio(config.twilioAccountSid, config.twilioAuthToken);
    await client.calls(callSid).recordings.create({
      recordingStatusCallback: `${baseUrl}/api/voice/recording-status`,
      recordingStatusCallbackMethod: "POST",
    });
  } catch (err) {
    logger.error({ err }, "Failed to start call recording");
  }
}

router.post("/voice/recording-status", async (req, res) => {
  const { CallSid, RecordingSid, RecordingUrl, RecordingStatus } = req.body as Record<string, string>;
  res.sendStatus(204);
  if (RecordingStatus !== "completed" || !RecordingUrl) return;
  try {
    const call = await db.query.voiceCalls.findFirst({ where: eq(voiceCalls.callSid, CallSid) });
    if (!call) return;
    // Store recording URL with .mp3 extension for direct playback
    const mp3Url = RecordingUrl.endsWith(".mp3") ? RecordingUrl : `${RecordingUrl}.mp3`;
    await db
      .update(voiceCalls)
      .set({ recordingSid: RecordingSid, recordingUrl: mp3Url })
      .where(eq(voiceCalls.id, call.id));
  } catch (err) {
    // non-fatal
  }
});

router.post("/voice/inbound", async (req, res) => {
  const { CallSid, From, To } = req.body as Record<string, string>;
  res.setHeader("Content-Type", "text/xml");

  try {
    const config = await db.query.voiceConfigs.findFirst();

    if (!config) {
      return res.send(
        twiml(`<Say voice="Polly.Joanna-Neural">Sorry, this service is not configured. Goodbye.</Say><Hangup/>`)
      );
    }

    const existing = await db.query.voiceCalls.findFirst({
      where: eq(voiceCalls.callSid, CallSid),
    });

    if (!existing) {
      await db.insert(voiceCalls).values({
        callSid: CallSid,
        fromNumber: From || "unknown",
        toNumber: To || config.twilioPhoneNumber || "unknown",
        direction: "inbound",
        status: "in-progress",
      });
    }

    // Start recording async — don't block TwiML response
    void startCallRecording(CallSid, getBaseUrl(req), config, req.log);

    if (config.hoursJson && !isWithinBusinessHours(config.hoursJson, config.timezone)) {
      const hoursSummary = getBusinessHoursSummary(config.hoursJson);
      const afterHoursMsg = `Thank you for calling ${config.businessName}. We are currently closed. Our hours are ${hoursSummary}. Please call back during business hours or leave a message after the tone.`;
      return res.send(
        twiml(`
          <Say voice="Polly.Joanna-Neural">${xmlSafe(afterHoursMsg)}</Say>
          <Record maxLength="120" action="/api/voice/status" transcribeCallback="/api/voice/status" />
          <Say voice="Polly.Joanna-Neural">Thank you for your message. Goodbye.</Say>
          <Hangup/>
        `)
      );
    }

    const greeting = config.greeting || `Thank you for calling ${config.businessName}. How can I help you today?`;
    return res.send(gatherTwiml("/api/voice/gather", greeting));
  } catch (err) {
    req.log.error({ err }, "Error handling inbound call");
    return res.send(
      twiml(`<Say voice="Polly.Joanna-Neural">We are experiencing technical difficulties. Please try again later.</Say><Hangup/>`)
    );
  }
});

router.post("/voice/gather", async (req, res) => {
  const { CallSid, SpeechResult } = req.body as Record<string, string>;
  res.setHeader("Content-Type", "text/xml");

  try {
    if (!SpeechResult || !SpeechResult.trim()) {
      return res.send(
        twiml(`
        <Say voice="Polly.Joanna-Neural">I didn't catch that. Could you please repeat?</Say>
        <Gather input="speech" action="/api/voice/gather" method="POST" speechTimeout="3" timeout="10">
        </Gather>
        <Hangup/>
      `)
      );
    }

    const call = await db.query.voiceCalls.findFirst({
      where: eq(voiceCalls.callSid, CallSid),
    });

    if (!call) {
      return res.send(
        twiml(`<Say voice="Polly.Joanna-Neural">Session not found. Goodbye.</Say><Hangup/>`)
      );
    }

    const config = await db.query.voiceConfigs.findFirst();
    if (!config) {
      return res.send(
        twiml(`<Say voice="Polly.Joanna-Neural">Service not configured. Goodbye.</Say><Hangup/>`)
      );
    }

    const historyMessages = await db.query.voiceMessages.findMany({
      where: eq(voiceMessages.callId, call.id),
      orderBy: (m, { asc }) => [asc(m.createdAt)],
    });

    await db.insert(voiceMessages).values({
      callId: call.id,
      role: "user",
      content: SpeechResult.trim(),
    });

    const history = historyMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    const aiResponse = await generateVoiceResponseWithFunctions(
      SpeechResult.trim(),
      config,
      history,
      async (toolName, args) => {
        return executeToolCall(toolName, args, call.id, call.fromNumber, req.log);
      }
    );

    await db.insert(voiceMessages).values({
      callId: call.id,
      role: "assistant",
      content: aiResponse,
    });

    return res.send(
      twiml(`
      <Say voice="Polly.Joanna-Neural">${xmlSafe(aiResponse)}</Say>
      <Gather input="speech" action="/api/voice/gather" method="POST" speechTimeout="3" timeout="10" language="en-US">
      </Gather>
      <Say voice="Polly.Joanna-Neural">Thank you for calling ${xmlSafe(config.businessName)}. Goodbye!</Say>
      <Hangup/>
    `)
    );
  } catch (err) {
    req.log.error({ err }, "Error handling gather");
    return res.send(
      twiml(`<Say voice="Polly.Joanna-Neural">I am having trouble right now. Please try again shortly.</Say><Hangup/>`)
    );
  }
});

router.post("/voice/outbound-twiml", async (req, res) => {
  const { CallSid, To } = req.body as Record<string, string>;
  res.setHeader("Content-Type", "text/xml");

  try {
    const config = await db.query.voiceConfigs.findFirst();
    if (!config) {
      return res.send(
        twiml(`<Say voice="Polly.Joanna-Neural">Hello, this is an automated call. Thank you. Goodbye.</Say><Hangup/>`)
      );
    }

    const existing = await db.query.voiceCalls.findFirst({
      where: eq(voiceCalls.callSid, CallSid),
    });

    if (!existing) {
      await db.insert(voiceCalls).values({
        callSid: CallSid,
        fromNumber: config.twilioPhoneNumber || "unknown",
        toNumber: To || "unknown",
        direction: "outbound",
        status: "in-progress",
      });
    }

    const greeting = `Hello, this is ${config.businessName} calling. How can I assist you today?`;
    return res.send(gatherTwiml("/api/voice/gather", greeting));
  } catch (err) {
    req.log.error({ err }, "Error in outbound TwiML");
    return res.send(
      twiml(`<Say voice="Polly.Joanna-Neural">Hello, this is an automated call. Thank you. Goodbye.</Say><Hangup/>`)
    );
  }
});

async function autoSummarizeCall(callId: string, logger: { error: (obj: object, msg: string) => void }) {
  try {
    const messages = await db.query.voiceMessages.findMany({
      where: eq(voiceMessages.callId, callId),
      orderBy: (m, { asc }) => [asc(m.createdAt)],
    });
    if (messages.length < 2) return;

    const transcript = messages
      .map((m) => `${m.role === "user" ? "Caller" : "Agent"}: ${m.content}`)
      .join("\n");

    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 200,
      messages: [
        {
          role: "system",
          content:
            'Summarize this phone call in one concise sentence. Classify outcome as one of: appointment_booked, inquiry_handled, complaint, transfer_requested, wrong_number, callback_requested, resolved, no_answer. Return JSON: {"summary": "...", "outcome": "..."}',
        },
        { role: "user", content: transcript },
      ],
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}");
    if (parsed.summary || parsed.outcome) {
      await db
        .update(voiceCalls)
        .set({ summary: parsed.summary ?? undefined, outcome: parsed.outcome ?? undefined })
        .where(eq(voiceCalls.id, callId));
    }
  } catch (err) {
    logger.error({ err }, "Auto-summarize failed");
  }
}

router.post("/voice/status", async (req, res) => {
  const { CallSid, CallStatus, CallDuration } = req.body as Record<string, string>;

  try {
    const call = await db.query.voiceCalls.findFirst({
      where: eq(voiceCalls.callSid, CallSid),
    });

    if (call) {
      const isTerminal = ["completed", "failed", "busy", "no-answer", "canceled"].includes(CallStatus);
      await db
        .update(voiceCalls)
        .set({
          status: CallStatus || "completed",
          durationSeconds: CallDuration ? parseInt(CallDuration, 10) : undefined,
          endedAt: isTerminal ? new Date() : undefined,
        })
        .where(eq(voiceCalls.id, call.id));

      if (isTerminal && CallStatus === "completed") {
        autoSummarizeCall(call.id, req.log).catch(() => {});
      }
    }
  } catch (err) {
    req.log.error({ err }, "Error handling status callback");
  }

  res.status(200).send("OK");
});

export default router;
