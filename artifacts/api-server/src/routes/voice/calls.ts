import { Router } from "express";
import { db } from "@workspace/db";
import { voiceCalls, voiceMessages, voiceConfigs } from "@workspace/db";
import { eq, desc, count, sql, isNotNull, and } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { isDncBlocked } from "./dnc.js";

const router = Router();

router.get("/voice/calls/stats", async (req, res) => {
  try {
    const [{ total }] = await db.select({ total: count() }).from(voiceCalls);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [{ todayTotal }] = await db
      .select({ todayTotal: count() })
      .from(voiceCalls)
      .where(sql`${voiceCalls.startedAt} >= ${today}`);

    const [avgResult] = await db
      .select({ avg: sql<number>`AVG(${voiceCalls.durationSeconds})` })
      .from(voiceCalls)
      .where(isNotNull(voiceCalls.durationSeconds));

    const [{ inbound }] = await db
      .select({ inbound: count() })
      .from(voiceCalls)
      .where(eq(voiceCalls.direction, "inbound"));

    const [{ outbound }] = await db
      .select({ outbound: count() })
      .from(voiceCalls)
      .where(eq(voiceCalls.direction, "outbound"));

    const byStatus = await db
      .select({ status: voiceCalls.status, count: count() })
      .from(voiceCalls)
      .groupBy(voiceCalls.status);

    const byOutcome = await db
      .select({ outcome: voiceCalls.outcome, count: count() })
      .from(voiceCalls)
      .where(isNotNull(voiceCalls.outcome))
      .groupBy(voiceCalls.outcome);

    return res.json({
      totalCalls: Number(total),
      todayCalls: Number(todayTotal),
      avgDurationSeconds: avgResult?.avg != null ? Number(avgResult.avg) : null,
      inboundCount: Number(inbound),
      outboundCount: Number(outbound),
      byStatus: byStatus.map((s) => ({ status: s.status, count: Number(s.count) })),
      byOutcome: byOutcome.map((o) => ({
        outcome: o.outcome ?? "unknown",
        count: Number(o.count),
      })),
    });
  } catch (err) {
    req.log.error({ err }, "Error getting voice call stats");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/voice/calls", async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 20, 100);
    const offset = (page - 1) * limit;
    const direction = req.query.direction as string | undefined;
    const status = req.query.status as string | undefined;
    const outcome = req.query.outcome as string | undefined;

    const conditions = [];
    if (direction) conditions.push(eq(voiceCalls.direction, direction));
    if (status) conditions.push(eq(voiceCalls.status, status));
    if (outcome) conditions.push(eq(voiceCalls.outcome, outcome));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const calls = await db.query.voiceCalls.findMany({
      where,
      orderBy: [desc(voiceCalls.startedAt)],
      limit,
      offset,
    });

    const callsWithCounts = await Promise.all(
      calls.map(async (call) => {
        const [{ msgCount }] = await db
          .select({ msgCount: count() })
          .from(voiceMessages)
          .where(eq(voiceMessages.callId, call.id));
        return { ...call, messageCount: Number(msgCount) };
      })
    );

    const [{ total }] = await db
      .select({ total: count() })
      .from(voiceCalls)
      .where(where);

    return res.json({
      calls: callsWithCounts,
      total: Number(total),
      page,
      totalPages: Math.ceil(Number(total) / limit),
    });
  } catch (err) {
    req.log.error({ err }, "Error getting voice calls");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/voice/calls/live", async (req, res) => {
  try {
    const liveCalls = await db.query.voiceCalls.findMany({
      where: eq(voiceCalls.status, "in-progress"),
      orderBy: [desc(voiceCalls.startedAt)],
      limit: 20,
    });
    const withCounts = await Promise.all(
      liveCalls.map(async (call) => {
        const [{ msgCount }] = await db
          .select({ msgCount: count() })
          .from(voiceMessages)
          .where(eq(voiceMessages.callId, call.id));
        return { ...call, messageCount: Number(msgCount) };
      })
    );
    return res.json(withCounts);
  } catch (err) {
    req.log.error({ err }, "Error getting live calls");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/voice/calls/export", async (req, res) => {
  try {
    const calls = await db.query.voiceCalls.findMany({
      orderBy: [desc(voiceCalls.startedAt)],
      limit: 5000,
    });
    const header = "Call SID,From,To,Direction,Status,Duration (s),Outcome,Summary,Started At,Ended At\n";
    const rows = calls
      .map((c) =>
        [
          c.callSid,
          c.fromNumber,
          c.toNumber,
          c.direction,
          c.status,
          c.durationSeconds ?? "",
          c.outcome ?? "",
          `"${(c.summary ?? "").replace(/"/g, '""')}"`,
          c.startedAt?.toISOString() ?? "",
          c.endedAt?.toISOString() ?? "",
        ].join(",")
      )
      .join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="voice-calls-${new Date().toISOString().slice(0, 10)}.csv"`);
    return res.send(header + rows);
  } catch (err) {
    req.log.error({ err }, "Error exporting calls");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.post("/voice/calls/:id/summarize", async (req, res) => {
  try {
    const call = await db.query.voiceCalls.findFirst({
      where: eq(voiceCalls.id, req.params.id),
    });
    if (!call) return res.status(404).json({ error: "Call not found" });

    const messages = await db.query.voiceMessages.findMany({
      where: eq(voiceMessages.callId, call.id),
      orderBy: (m, { asc }) => [asc(m.createdAt)],
    });

    if (!messages.length) {
      return res.json({ ...call, messageCount: 0 });
    }

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
            'Summarize this phone call transcript in one concise sentence. Also classify the outcome. Return JSON: {"summary": "...", "outcome": "appointment_booked|inquiry_handled|complaint|transfer_requested|wrong_number|callback_requested|resolved|no_answer"}',
        },
        { role: "user", content: transcript },
      ],
      response_format: { type: "json_object" },
    });

    let summary = call.summary;
    let outcome = call.outcome;
    try {
      const parsed = JSON.parse(response.choices[0]?.message?.content ?? "{}");
      summary = parsed.summary ?? summary;
      outcome = parsed.outcome ?? outcome;
    } catch {}

    const [updated] = await db
      .update(voiceCalls)
      .set({ summary, outcome })
      .where(eq(voiceCalls.id, call.id))
      .returning();

    return res.json({ ...updated, messageCount: messages.length });
  } catch (err) {
    req.log.error({ err }, "Error summarizing call");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/voice/calls/:id", async (req, res) => {
  try {
    const call = await db.query.voiceCalls.findFirst({
      where: eq(voiceCalls.id, req.params.id),
    });

    if (!call) return res.status(404).json({ error: "Call not found" });

    const messages = await db.query.voiceMessages.findMany({
      where: eq(voiceMessages.callId, call.id),
      orderBy: (m, { asc }) => [asc(m.createdAt)],
    });

    return res.json({
      call: { ...call, messageCount: messages.length },
      messages,
    });
  } catch (err) {
    req.log.error({ err }, "Error getting voice call detail");
    return res.status(500).json({ error: "Internal server error" });
  }
});

router.get("/voice/tts/:messageId", async (req, res) => {
  try {
    const message = await db.query.voiceMessages.findFirst({
      where: eq(voiceMessages.id, req.params.messageId),
    });

    if (!message) return res.status(404).send("Message not found");

    const config = await db.query.voiceConfigs.findFirst();
    const voice =
      (config?.voice as "alloy" | "echo" | "fable" | "onyx" | "nova" | "shimmer") || "nova";

    const mp3Response = await openai.audio.speech.create({
      model: "tts-1",
      voice,
      input: message.content,
      response_format: "mp3",
    });

    const audioBuffer = Buffer.from(await mp3Response.arrayBuffer());

    await db
      .update(voiceMessages)
      .set({ audioReady: true })
      .where(eq(voiceMessages.id, message.id));

    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Content-Length", audioBuffer.length.toString());
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.send(audioBuffer);
  } catch (err) {
    req.log.error({ err }, "Error generating TTS audio");
    return res.status(500).send("TTS generation failed");
  }
});

router.post("/voice/outbound", async (req, res) => {
  try {
    const { toNumber, purpose } = req.body as {
      toNumber?: string;
      purpose?: string;
    };

    if (!toNumber) {
      return res.status(400).json({ error: "toNumber is required" });
    }

    // DNC compliance check before placing any outbound call
    const blocked = await isDncBlocked(toNumber);
    if (blocked) {
      return res.status(403).json({ error: "This number is on the Do-Not-Call list and cannot be dialed." });
    }

    const config = await db.query.voiceConfigs.findFirst();

    if (!config?.twilioAccountSid || !config?.twilioAuthToken || !config?.twilioPhoneNumber) {
      return res.status(400).json({
        error:
          "Twilio credentials not configured. Please add your Account SID, Auth Token, and phone number in Settings.",
      });
    }

    const twilio = (await import("twilio")).default;
    const client = twilio(config.twilioAccountSid, config.twilioAuthToken);

    const proto = (req.headers["x-forwarded-proto"] as string) || "https";
    const host =
      (req.headers["x-forwarded-host"] as string) || (req.headers["host"] as string);
    const baseUrl = `${proto}://${host}`;

    const call = await client.calls.create({
      to: toNumber,
      from: config.twilioPhoneNumber,
      url: `${baseUrl}/api/voice/outbound-twiml`,
      statusCallback: `${baseUrl}/api/voice/status`,
      statusCallbackEvent: ["completed", "failed", "busy", "no-answer"],
      statusCallbackMethod: "POST",
      record: true,
      recordingStatusCallback: `${baseUrl}/api/voice/recording-status`,
      recordingStatusCallbackMethod: "POST",
    });

    await db.insert(voiceCalls).values({
      callSid: call.sid,
      fromNumber: config.twilioPhoneNumber,
      toNumber,
      direction: "outbound",
      status: call.status,
    });

    return res.json({
      callSid: call.sid,
      status: call.status,
      toNumber,
    });
  } catch (err) {
    req.log.error({ err }, "Error creating outbound call");
    return res.status(500).json({ error: "Failed to initiate call. Check your Twilio credentials." });
  }
});

// ── Audio proxy — streams Twilio recording to browser without exposing credentials ──
router.get("/voice/calls/:id/recording", async (req, res) => {
  try {
    const call = await db.query.voiceCalls.findFirst({
      where: eq(voiceCalls.id, req.params.id),
    });
    if (!call?.recordingUrl) return res.status(404).json({ error: "No recording available" });

    const config = await db.query.voiceConfigs.findFirst();
    if (!config?.twilioAccountSid || !config?.twilioAuthToken) {
      return res.status(503).json({ error: "Twilio credentials not configured" });
    }

    // Fetch audio from Twilio with Basic Auth
    const auth = Buffer.from(`${config.twilioAccountSid}:${config.twilioAuthToken}`).toString("base64");
    const upstream = await fetch(call.recordingUrl, {
      headers: { Authorization: `Basic ${auth}` },
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({ error: "Recording fetch failed" });
    }

    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "audio/mpeg");
    res.setHeader("Cache-Control", "private, max-age=3600");
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) res.setHeader("Content-Length", contentLength);

    const reader = upstream.body?.getReader();
    if (!reader) return res.status(500).send("Stream unavailable");

    const pump = async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) { res.end(); break; }
        if (!res.write(Buffer.from(value))) {
          await new Promise((r) => res.once("drain", r));
        }
      }
    };
    await pump();
  } catch (err) {
    req.log.error({ err }, "Error proxying recording");
    if (!res.headersSent) res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
