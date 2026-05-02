import { Router } from "express";
import { db } from "@workspace/db";
import { voiceCalls, voiceMessages } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { supervisorEvents, type SupervisorEvent } from "../../lib/supervisorEvents.js";
import { requireAuth } from "../../middlewares/requireAuth.js";
import { getActiveSessions } from "./stream.js";

const router = Router();

// GET /voice/supervisor/live — SSE stream of live call events
router.get("/voice/supervisor/live", requireAuth, (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no"); // disable nginx buffering
  res.flushHeaders();

  // Heartbeat every 15s to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 15000);

  function onEvent(event: SupervisorEvent) {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  }

  supervisorEvents.on("event", onEvent);

  req.on("close", () => {
    clearInterval(heartbeat);
    supervisorEvents.off("event", onEvent);
  });
});

// GET /voice/supervisor/active-calls — snapshot of active calls (DB + in-memory WebSocket sessions)
router.get("/voice/supervisor/active-calls", requireAuth, async (req, res) => {
  try {
    // Query DB for in-progress calls
    const liveCalls = await db.query.voiceCalls.findMany({
      where: eq(voiceCalls.status, "in-progress"),
      orderBy: [desc(voiceCalls.startedAt)],
      limit: 20,
    });

    const dbCallSids = new Set(liveCalls.map((c) => c.callSid));

    const callsWithMessages = await Promise.all(
      liveCalls.map(async (call) => {
        const messages = await db.query.voiceMessages.findMany({
          where: eq(voiceMessages.callId, call.id),
          orderBy: (m, { asc }) => [asc(m.createdAt)],
          limit: 50,
        });
        return { ...call, messages };
      })
    );

    // Merge in-memory WebSocket sessions not yet reflected in DB
    const inMemory = getActiveSessions();
    for (const session of inMemory) {
      if (dbCallSids.has(session.callSid)) continue; // already in DB results
      callsWithMessages.push({
        id: session.callDbId ?? session.callSid,
        callSid: session.callSid,
        fromNumber: session.fromNumber,
        toNumber: session.toNumber,
        direction: session.direction as "inbound" | "outbound",
        status: "in-progress",
        startedAt: new Date(session.startedAt),
        endedAt: null,
        durationSeconds: null,
        outcome: null,
        summary: null,
        qualityScore: null,
        qualityNotes: null,
        qualityFlags: null,
        escalatedAt: null,
        escalatedTo: null,
        configId: null,
        language: "en-US",
        createdAt: new Date(session.startedAt),
        updatedAt: new Date(session.startedAt),
        messages: [],
      } as typeof callsWithMessages[number]);
    }

    return res.json(callsWithMessages);
  } catch (err) {
    req.log.error({ err }, "Error fetching active calls for supervisor");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
