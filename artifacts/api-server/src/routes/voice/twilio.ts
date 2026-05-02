import { Router } from "express";
import { db } from "@workspace/db";
import { voiceCalls, voiceMessages, voiceConfigs, voiceAppointments, voiceWebhookActions } from "@workspace/db";
import { eq, and, ilike, or } from "drizzle-orm";
import { generateVoiceResponseWithFunctions, isWithinBusinessHours, getBusinessHoursSummary } from "./gpt.js";
import { callWebhookAction } from "./integrations.js";
import { openai } from "@workspace/integrations-openai-ai-server";
import { supervisorEvents } from "../../lib/supervisorEvents.js";

const router = Router();

// ── Language → Polly voice map ───────────────────────────────────────────────
const POLLY_VOICES: Record<string, string> = {
  "en-US": "Polly.Joanna-Neural",
  "en-GB": "Polly.Amy-Neural",
  "es-US": "Polly.Lupe-Neural",
  "es-ES": "Polly.Conchita-Neural",
  "fr-FR": "Polly.Lea-Neural",
  "de-DE": "Polly.Vicki-Neural",
  "pt-BR": "Polly.Camila-Neural",
  "it-IT": "Polly.Bianca-Neural",
  "ja-JP": "Polly.Takumi-Neural",
  "ko-KR": "Polly.Seoyeon-Neural",
};

function getPollyVoice(language: string): string {
  return POLLY_VOICES[language] ?? "Polly.Joanna-Neural";
}

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

function gatherTwiml(action: string, sayText: string, language = "en-US"): string {
  const voice = getPollyVoice(language);
  return twiml(`
    <Say voice="${voice}">${xmlSafe(sayText)}</Say>
    <Gather input="speech" action="${action}" method="POST" speechTimeout="3" timeout="10" language="${language}">
    </Gather>
    <Say voice="${voice}">I didn't catch that. Thank you for calling. Goodbye!</Say>
    <Hangup/>
  `);
}

function ivrMenuTwiml(menu: IvrMenuItem[], language = "en-US"): string {
  const voice = getPollyVoice(language);
  const optionText = menu
    .map((m) => `Press ${m.digit} for ${m.label}.`)
    .join(" ");
  const prompt = `Thank you for calling. ${optionText}`;
  return twiml(`
    <Say voice="${voice}">${xmlSafe(prompt)}</Say>
    <Gather input="dtmf" numDigits="1" action="/api/voice/ivr-select" method="POST" timeout="10">
    </Gather>
    <Say voice="${voice}">We did not receive your selection. Goodbye.</Say>
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

interface IvrMenuItem {
  digit: string;
  label: string;
  action: "ai" | "transfer" | "voicemail";
  transferTo?: string;
  prompt?: string;
}

// ── Tool execution ─────────────────────────────────────────────────────────────
async function executeToolCall(
  toolName: string,
  args: Record<string, unknown>,
  callId: string,
  fromNumber: string,
  config: typeof voiceConfigs.$inferSelect,
  logger: { error: (obj: object, msg: string) => void }
): Promise<{ response: string; shouldTransfer?: string }> {
  try {
    // Check for configured webhook action first
    const webhookAction = await db.query.voiceWebhookActions.findFirst({
      where: and(
        eq(voiceWebhookActions.actionType, toolName),
        eq(voiceWebhookActions.isActive, true)
      ),
    });

    if (webhookAction) {
      try {
        const result = await callWebhookAction(webhookAction, { ...args, callId });
        return { response: result };
      } catch (err) {
        logger.error({ err }, `Webhook action failed for ${toolName}, falling back to internal`);
      }
    }

    switch (toolName) {
      case "transfer_to_human": {
        const transferTo = config.transferNumber;
        if (!transferTo) {
          return { response: "I'd like to transfer you to a team member, but no transfer number is configured. Let me note your details and have someone call you back." };
        }
        // Update call with escalation info
        await db.update(voiceCalls).set({
          escalatedAt: new Date(),
          escalatedTo: transferTo,
        }).where(eq(voiceCalls.id, callId));

        supervisorEvents.emit("event", {
          type: "escalation",
          callId,
          callSid: "",
          timestamp: new Date().toISOString(),
        });
        return {
          response: "Please hold while I transfer you to one of our team members.",
          shouldTransfer: transferTo,
        };
      }

      case "book_appointment": {
        const { patientName, patientPhone, requestedDate, requestedTime, reason } = args as Record<string, string>;
        if (!patientName) return { response: JSON.stringify({ success: false, message: "Patient name is required to book an appointment." }) };

        const [appointment] = await db.insert(voiceAppointments).values({
          callId,
          patientName: patientName || "Unknown",
          patientPhone: patientPhone || fromNumber || "",
          requestedDate: requestedDate || "",
          requestedTime: requestedTime || "",
          reason: reason || "",
          status: "pending",
        }).returning();

        return {
          response: JSON.stringify({
            success: true,
            appointmentId: appointment.id,
            message: `Appointment request saved for ${patientName}${requestedDate ? ` on ${requestedDate}` : ""}${requestedTime ? ` at ${requestedTime}` : ""}. Our staff will confirm shortly.`,
          }),
        };
      }

      case "check_availability": {
        const { requestedDate, requestedTime } = args as Record<string, string>;
        return {
          response: JSON.stringify({
            success: true,
            available: true,
            message: `We have availability${requestedDate ? ` on ${requestedDate}` : ""}${requestedTime ? ` around ${requestedTime}` : ""}. Would you like to book that time?`,
            slots: ["9:00 AM", "10:30 AM", "2:00 PM", "3:30 PM"],
          }),
        };
      }

      case "cancel_appointment": {
        const { patientName, requestedDate } = args as Record<string, string>;
        const existingAppts = await db.query.voiceAppointments.findMany({
          where: ilike(voiceAppointments.patientName, `%${patientName || ""}%`),
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
          return { response: JSON.stringify({ success: true, message: `Appointment cancelled for ${patientName}.` }) };
        }
        return { response: JSON.stringify({ success: false, message: `No appointment found for ${patientName || "that name"}.` }) };
      }

      case "lookup_patient": {
        const { patientName, patientPhone } = args as Record<string, string>;
        const appointments = await db.query.voiceAppointments.findMany({
          where: or(
            patientName ? ilike(voiceAppointments.patientName, `%${patientName}%`) : undefined,
            patientPhone ? ilike(voiceAppointments.patientPhone, `%${patientPhone}%`) : undefined,
          ),
          orderBy: (a, { desc }) => [desc(a.createdAt)],
          limit: 3,
        });
        if (appointments.length === 0) return { response: JSON.stringify({ found: false, message: "No records found for that patient." }) };
        const appt = appointments[0]!;
        return {
          response: JSON.stringify({
            found: true,
            message: `Found record for ${appt.patientName}.${appt.requestedDate ? ` Next appointment: ${appt.requestedDate}${appt.requestedTime ? ` at ${appt.requestedTime}` : ""}` : ""} Status: ${appt.status}.`,
          }),
        };
      }

      default:
        return { response: JSON.stringify({ message: "Action completed." }) };
    }
  } catch (err) {
    logger.error({ err }, `Tool execution failed: ${toolName}`);
    return { response: JSON.stringify({ success: false, message: "I'm having trouble accessing that information right now." }) };
  }
}

// ── Recording ─────────────────────────────────────────────────────────────────
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

// ── Quality scoring (after call completes) ────────────────────────────────────
async function scoreCallQuality(callId: string, logger: { error: (obj: object, msg: string) => void }) {
  try {
    const messages = await db.query.voiceMessages.findMany({
      where: eq(voiceMessages.callId, callId),
      orderBy: (m, { asc }) => [asc(m.createdAt)],
    });
    if (messages.length < 2) return;

    const transcript = messages
      .map((m) => `${m.role === "user" ? "Caller" : "Agent"}: ${m.content}`)
      .join("\n");

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 300,
      messages: [
        {
          role: "system",
          content: `Score this phone call on a scale of 1-5 (5=excellent). Consider: issue resolution, caller satisfaction indicators, efficiency, and accuracy. Return JSON: {"score": 1-5, "notes": "brief explanation", "flags": ["any issues like: long_silence, caller_frustrated, unresolved_issue"]}`,
        },
        { role: "user", content: transcript },
      ],
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(resp.choices[0]?.message?.content ?? "{}");
    if (parsed.score) {
      await db.update(voiceCalls).set({
        qualityScore: parsed.score,
        qualityNotes: parsed.notes ?? null,
        qualityFlags: parsed.flags ? JSON.stringify(parsed.flags) : null,
      }).where(eq(voiceCalls.id, callId));
    }
  } catch (err) {
    logger.error({ err }, "Quality scoring failed");
  }
}

// ── Auto-summarize ────────────────────────────────────────────────────────────
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
          content: 'Summarize this phone call in one concise sentence. Classify outcome. Return JSON: {"summary": "...", "outcome": "appointment_booked|inquiry_handled|complaint|transfer_requested|wrong_number|callback_requested|resolved|no_answer"}',
        },
        { role: "user", content: transcript },
      ],
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}");
    if (parsed.summary || parsed.outcome) {
      await db.update(voiceCalls)
        .set({ summary: parsed.summary ?? undefined, outcome: parsed.outcome ?? undefined })
        .where(eq(voiceCalls.id, callId));
    }
  } catch (err) {
    logger.error({ err }, "Auto-summarize failed");
  }
}

// ── Voicemail notification ─────────────────────────────────────────────────────
async function notifyVoicemail(
  callSid: string,
  recordingUrl: string,
  config: typeof voiceConfigs.$inferSelect,
  logger: { error: (obj: object, msg: string) => void }
) {
  if (!config.supervisorPhone || !config.twilioAccountSid || !config.twilioAuthToken || !config.twilioPhoneNumber) return;
  try {
    const twilio = (await import("twilio")).default;
    const client = twilio(config.twilioAccountSid, config.twilioAuthToken);
    await client.messages.create({
      body: `📞 New voicemail from ${callSid.slice(-6)} at ${config.businessName}. Listen: ${recordingUrl}`,
      from: config.twilioPhoneNumber,
      to: config.supervisorPhone,
    });
  } catch (err) {
    logger.error({ err }, "Voicemail notification failed");
  }
}

// ── ROUTES ────────────────────────────────────────────────────────────────────

// Recording status callback
router.post("/voice/recording-status", async (req, res) => {
  const { CallSid, RecordingSid, RecordingUrl, RecordingStatus } = req.body as Record<string, string>;
  res.sendStatus(204);
  if (RecordingStatus !== "completed" || !RecordingUrl) return;
  try {
    const call = await db.query.voiceCalls.findFirst({ where: eq(voiceCalls.callSid, CallSid) });
    if (!call) return;
    const mp3Url = RecordingUrl.endsWith(".mp3") ? RecordingUrl : `${RecordingUrl}.mp3`;
    await db.update(voiceCalls)
      .set({ recordingSid: RecordingSid, recordingUrl: mp3Url })
      .where(eq(voiceCalls.id, call.id));

    // If this call had no AI messages, it was an after-hours voicemail → notify supervisor
    const msgCount = await db.query.voiceMessages.findFirst({ where: eq(voiceMessages.callId, call.id) });
    if (!msgCount) {
      const config = await db.query.voiceConfigs.findFirst();
      if (config) void notifyVoicemail(CallSid, mp3Url, config, { error: () => {} });
    }
  } catch {
    // non-fatal
  }
});

// Inbound call
router.post("/voice/inbound", async (req, res) => {
  const { CallSid, From, To } = req.body as Record<string, string>;
  res.setHeader("Content-Type", "text/xml");

  try {
    // Find config by phone number (multi-location) or fall back to first
    const config = await db.query.voiceConfigs.findFirst({
      where: To ? eq(voiceConfigs.twilioPhoneNumber, To) : undefined,
    }) ?? await db.query.voiceConfigs.findFirst();

    if (!config) {
      return res.send(twiml(`<Say voice="Polly.Joanna-Neural">Sorry, this service is not configured. Goodbye.</Say><Hangup/>`));
    }

    const lang = config.language ?? "en-US";
    const voice = getPollyVoice(lang);

    const existing = await db.query.voiceCalls.findFirst({ where: eq(voiceCalls.callSid, CallSid) });
    if (!existing) {
      await db.insert(voiceCalls).values({
        callSid: CallSid,
        configId: config.id,
        fromNumber: From || "unknown",
        toNumber: To || config.twilioPhoneNumber || "unknown",
        direction: "inbound",
        status: "in-progress",
        language: lang,
      });
    }

    // Emit supervisor event
    supervisorEvents.emit("event", {
      type: "call_start",
      callId: existing?.id ?? CallSid,
      callSid: CallSid,
      fromNumber: From,
      toNumber: To,
      direction: "inbound",
      timestamp: new Date().toISOString(),
    });

    // Start recording async
    void startCallRecording(CallSid, getBaseUrl(req), config, req.log);

    // After-hours voicemail
    if (config.hoursJson && !isWithinBusinessHours(config.hoursJson, config.timezone)) {
      const hoursSummary = getBusinessHoursSummary(config.hoursJson);
      const afterHoursMsg = `Thank you for calling ${config.businessName}. We are currently closed. Our hours are ${hoursSummary}. Please leave a message after the tone and we will call you back.`;
      return res.send(twiml(`
        <Say voice="${voice}">${xmlSafe(afterHoursMsg)}</Say>
        <Record maxLength="120" action="/api/voice/status" transcribeCallback="/api/voice/status" recordingStatusCallback="/api/voice/recording-status" recordingStatusCallbackMethod="POST" />
        <Say voice="${voice}">Thank you for your message. Goodbye.</Say>
        <Hangup/>
      `));
    }

    // IVR menu
    if (config.ivrEnabled && config.ivrMenuJson && config.ivrMenuJson !== "[]") {
      let menu: IvrMenuItem[] = [];
      try { menu = JSON.parse(config.ivrMenuJson); } catch {}
      if (menu.length > 0) {
        return res.send(ivrMenuTwiml(menu, lang));
      }
    }

    // Straight to AI
    const greeting = config.greeting || `Thank you for calling ${config.businessName}. How can I help you today?`;
    return res.send(gatherTwiml("/api/voice/gather", greeting, lang));
  } catch (err) {
    req.log.error({ err }, "Error handling inbound call");
    return res.send(twiml(`<Say voice="Polly.Joanna-Neural">We are experiencing technical difficulties. Please try again later.</Say><Hangup/>`));
  }
});

// IVR digit selection
router.post("/voice/ivr-select", async (req, res) => {
  const { CallSid, Digits, To } = req.body as Record<string, string>;
  res.setHeader("Content-Type", "text/xml");

  try {
    const config = await db.query.voiceConfigs.findFirst({
      where: To ? eq(voiceConfigs.twilioPhoneNumber, To) : undefined,
    }) ?? await db.query.voiceConfigs.findFirst();

    if (!config) return res.send(twiml(`<Hangup/>`));

    const lang = config.language ?? "en-US";
    const voice = getPollyVoice(lang);

    let menu: IvrMenuItem[] = [];
    try { menu = JSON.parse(config.ivrMenuJson ?? "[]"); } catch {}

    const selected = menu.find((m) => m.digit === Digits);
    if (!selected) {
      return res.send(twiml(`
        <Say voice="${voice}">Invalid selection. Please try again.</Say>
        ${ivrMenuTwiml(menu, lang).replace('<?xml version="1.0" encoding="UTF-8"?>\n<Response>', "").replace("</Response>", "")}
      `));
    }

    if (selected.action === "transfer" && selected.transferTo) {
      return res.send(twiml(`
        <Say voice="${voice}">Please hold while I transfer your call.</Say>
        <Dial callerId="${config.twilioPhoneNumber ?? ""}">${xmlSafe(selected.transferTo)}</Dial>
        <Hangup/>
      `));
    }

    if (selected.action === "voicemail") {
      const vmMsg = selected.prompt ?? "Please leave a message after the tone.";
      return res.send(twiml(`
        <Say voice="${voice}">${xmlSafe(vmMsg)}</Say>
        <Record maxLength="120" action="/api/voice/status" />
        <Hangup/>
      `));
    }

    // Default: connect to AI with optional custom prompt
    const prompt = selected.prompt ?? (config.greeting || `Thank you for calling ${config.businessName}. How can I help you today?`);
    return res.send(gatherTwiml("/api/voice/gather", prompt, lang));
  } catch (err) {
    req.log.error({ err }, "Error handling IVR selection");
    return res.send(twiml(`<Say voice="Polly.Joanna-Neural">Sorry, something went wrong. Please try again.</Say><Hangup/>`));
  }
});

// Gather (AI conversation)
router.post("/voice/gather", async (req, res) => {
  const { CallSid, SpeechResult, CallLanguage } = req.body as Record<string, string>;
  res.setHeader("Content-Type", "text/xml");

  try {
    if (!SpeechResult?.trim()) {
      return res.send(twiml(`
        <Say voice="Polly.Joanna-Neural">I didn't catch that. Could you please repeat?</Say>
        <Gather input="speech" action="/api/voice/gather" method="POST" speechTimeout="3" timeout="10">
        </Gather>
        <Hangup/>
      `));
    }

    const call = await db.query.voiceCalls.findFirst({ where: eq(voiceCalls.callSid, CallSid) });
    if (!call) return res.send(twiml(`<Say voice="Polly.Joanna-Neural">Session not found. Goodbye.</Say><Hangup/>`));

    const config = call.configId
      ? await db.query.voiceConfigs.findFirst({ where: eq(voiceConfigs.id, call.configId) })
      : await db.query.voiceConfigs.findFirst();

    if (!config) return res.send(twiml(`<Say voice="Polly.Joanna-Neural">Service not configured. Goodbye.</Say><Hangup/>`));

    // Detect language (prefer config lang, fall back to Twilio's CallLanguage hint)
    const lang = call.language ?? CallLanguage ?? config.language ?? "en-US";
    const voice = getPollyVoice(lang);

    // Update call language if changed
    if (call.language !== lang) {
      await db.update(voiceCalls).set({ language: lang }).where(eq(voiceCalls.id, call.id));
    }

    const historyMessages = await db.query.voiceMessages.findMany({
      where: eq(voiceMessages.callId, call.id),
      orderBy: (m, { asc }) => [asc(m.createdAt)],
    });

    await db.insert(voiceMessages).values({ callId: call.id, role: "user", content: SpeechResult.trim() });

    // Emit supervisor event
    supervisorEvents.emit("event", {
      type: "message",
      callId: call.id,
      callSid: CallSid,
      role: "user",
      content: SpeechResult.trim(),
      timestamp: new Date().toISOString(),
    });

    const history = historyMessages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    let shouldTransfer: string | undefined;
    const aiResponse = await generateVoiceResponseWithFunctions(
      SpeechResult.trim(),
      config,
      history,
      async (toolName, args) => {
        const result = await executeToolCall(toolName, args, call.id, call.fromNumber, config, req.log);
        if (result.shouldTransfer) shouldTransfer = result.shouldTransfer;
        return result.response;
      }
    );

    await db.insert(voiceMessages).values({ callId: call.id, role: "assistant", content: aiResponse });

    // Emit supervisor event for AI response
    supervisorEvents.emit("event", {
      type: "message",
      callId: call.id,
      callSid: CallSid,
      role: "assistant",
      content: aiResponse,
      timestamp: new Date().toISOString(),
    });

    // If human transfer requested, dial out
    if (shouldTransfer) {
      return res.send(twiml(`
        <Say voice="${voice}">${xmlSafe(aiResponse)}</Say>
        <Dial callerId="${config.twilioPhoneNumber ?? ""}" action="/api/voice/status">${xmlSafe(shouldTransfer)}</Dial>
        <Hangup/>
      `));
    }

    return res.send(twiml(`
      <Say voice="${voice}">${xmlSafe(aiResponse)}</Say>
      <Gather input="speech" action="/api/voice/gather" method="POST" speechTimeout="3" timeout="10" language="${lang}">
      </Gather>
      <Say voice="${voice}">Thank you for calling ${xmlSafe(config.businessName)}. Goodbye!</Say>
      <Hangup/>
    `));
  } catch (err) {
    req.log.error({ err }, "Error handling gather");
    return res.send(twiml(`<Say voice="Polly.Joanna-Neural">I am having trouble right now. Please try again shortly.</Say><Hangup/>`));
  }
});

// Outbound TwiML
router.post("/voice/outbound-twiml", async (req, res) => {
  const { CallSid, To } = req.body as Record<string, string>;
  res.setHeader("Content-Type", "text/xml");

  try {
    const config = await db.query.voiceConfigs.findFirst();
    if (!config) return res.send(twiml(`<Say voice="Polly.Joanna-Neural">Hello, this is an automated call. Thank you. Goodbye.</Say><Hangup/>`));

    const lang = config.language ?? "en-US";
    const existing = await db.query.voiceCalls.findFirst({ where: eq(voiceCalls.callSid, CallSid) });
    if (!existing) {
      await db.insert(voiceCalls).values({
        callSid: CallSid,
        configId: config.id,
        fromNumber: config.twilioPhoneNumber || "unknown",
        toNumber: To || "unknown",
        direction: "outbound",
        status: "in-progress",
        language: lang,
      });
    }

    const greeting = `Hello, this is ${config.businessName} calling. How can I assist you today?`;
    return res.send(gatherTwiml("/api/voice/gather", greeting, lang));
  } catch (err) {
    req.log.error({ err }, "Error in outbound TwiML");
    return res.send(twiml(`<Say voice="Polly.Joanna-Neural">Hello, this is an automated call. Thank you. Goodbye.</Say><Hangup/>`));
  }
});

// ── Media Streams (WebSocket) inbound entry point ────────────────────────────
// Point your Twilio number's webhook here for real-time AI calls:
//   POST https://{domain}/api/voice/stream-inbound
router.post("/voice/stream-inbound", async (req, res) => {
  const { CallSid, From, To } = req.body as Record<string, string>;
  res.setHeader("Content-Type", "text/xml");

  try {
    const config = await db.query.voiceConfigs.findFirst({
      where: To ? eq(voiceConfigs.twilioPhoneNumber, To) : undefined,
    }) ?? await db.query.voiceConfigs.findFirst();

    if (!config) {
      return res.send(twiml(`<Say>Sorry, this service is not configured. Goodbye.</Say><Hangup/>`));
    }

    const lang = config.language ?? "en-US";
    const voice = getPollyVoice(lang);

    // Upsert call record
    const existing = await db.query.voiceCalls.findFirst({ where: eq(voiceCalls.callSid, CallSid) });
    if (!existing) {
      await db.insert(voiceCalls).values({
        callSid: CallSid,
        configId: config.id,
        fromNumber: From || "unknown",
        toNumber: To || config.twilioPhoneNumber || "unknown",
        direction: "inbound",
        status: "in-progress",
        language: lang,
      });
    }

    supervisorEvents.emit("event", {
      type: "call_start",
      callId: existing?.id ?? CallSid,
      callSid: CallSid,
      fromNumber: From,
      toNumber: To,
      direction: "inbound",
      timestamp: new Date().toISOString(),
    });

    // After-hours → voicemail (can't use stream for this)
    if (config.hoursJson && !isWithinBusinessHours(config.hoursJson, config.timezone)) {
      const hoursSummary = getBusinessHoursSummary(config.hoursJson);
      const msg = `Thank you for calling ${config.businessName}. We are currently closed. Our hours are ${hoursSummary}. Please leave a message after the tone.`;
      return res.send(twiml(`
        <Say voice="${voice}">${xmlSafe(msg)}</Say>
        <Record maxLength="120" action="/api/voice/status" recordingStatusCallback="/api/voice/recording-status" recordingStatusCallbackMethod="POST" />
        <Hangup/>
      `));
    }

    // IVR → use existing DTMF handler
    if (config.ivrEnabled && config.ivrMenuJson && config.ivrMenuJson !== "[]") {
      let menu: IvrMenuItem[] = [];
      try { menu = JSON.parse(config.ivrMenuJson); } catch {}
      if (menu.length > 0) {
        return res.send(ivrMenuTwiml(menu, lang));
      }
    }

    // Start recording async
    void startCallRecording(CallSid, getBaseUrl(req), config, req.log);

    // Connect to WebSocket Media Stream
    const baseUrl = getBaseUrl(req);
    const wsUrl = baseUrl.replace(/^http/, "ws") + "/api/voice/stream";

    return res.send(twiml(`
      <Connect>
        <Stream url="${wsUrl}">
          <Parameter name="configId" value="${config.id}" />
        </Stream>
      </Connect>
    `));
  } catch (err) {
    req.log.error({ err }, "Error in stream-inbound");
    return res.send(twiml(`<Say>We are experiencing difficulties. Please try again later.</Say><Hangup/>`));
  }
});

// Outbound stream TwiML (WebSocket-based outbound calls)
router.post("/voice/outbound-stream-twiml", async (req, res) => {
  const { CallSid, To } = req.body as Record<string, string>;
  res.setHeader("Content-Type", "text/xml");

  try {
    const config = await db.query.voiceConfigs.findFirst();
    if (!config) return res.send(twiml(`<Say>Hello, this is an automated call. Goodbye.</Say><Hangup/>`));

    const lang = config.language ?? "en-US";
    const existing = await db.query.voiceCalls.findFirst({ where: eq(voiceCalls.callSid, CallSid) });
    if (!existing) {
      await db.insert(voiceCalls).values({
        callSid: CallSid,
        configId: config.id,
        fromNumber: config.twilioPhoneNumber || "unknown",
        toNumber: To || "unknown",
        direction: "outbound",
        status: "in-progress",
        language: lang,
      });
    }

    const baseUrl = getBaseUrl(req);
    const wsUrl = baseUrl.replace(/^http/, "ws") + "/api/voice/stream";

    return res.send(twiml(`
      <Connect>
        <Stream url="${wsUrl}">
          <Parameter name="configId" value="${config.id}" />
        </Stream>
      </Connect>
    `));
  } catch (err) {
    req.log.error({ err }, "Error in outbound-stream-twiml");
    return res.send(twiml(`<Say>Hello, this is an automated call. Goodbye.</Say><Hangup/>`));
  }
});

// Status callback
router.post("/voice/status", async (req, res) => {
  const { CallSid, CallStatus, CallDuration } = req.body as Record<string, string>;

  try {
    const call = await db.query.voiceCalls.findFirst({ where: eq(voiceCalls.callSid, CallSid) });
    if (call) {
      const isTerminal = ["completed", "failed", "busy", "no-answer", "canceled"].includes(CallStatus);
      const durationSec = CallDuration ? parseInt(CallDuration, 10) : undefined;
      await db.update(voiceCalls).set({
        status: CallStatus || "completed",
        durationSeconds: durationSec,
        endedAt: isTerminal ? new Date() : undefined,
      }).where(eq(voiceCalls.id, call.id));

      if (isTerminal) {
        supervisorEvents.emit("event", {
          type: "call_end",
          callId: call.id,
          callSid: CallSid,
          timestamp: new Date().toISOString(),
        });
      }

      if (isTerminal && CallStatus === "completed") {
        autoSummarizeCall(call.id, req.log).catch(() => {});
        scoreCallQuality(call.id, req.log).catch(() => {});
      }
    }
  } catch (err) {
    req.log.error({ err }, "Error handling status callback");
  }

  res.status(200).send("OK");
});

export default router;
