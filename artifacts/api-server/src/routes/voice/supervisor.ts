import { Router } from "express";
import { db } from "@workspace/db";
import { voiceCalls, voiceMessages } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { supervisorEvents, type SupervisorEvent } from "../../lib/supervisorEvents.js";
import { requireAuth } from "../../middlewares/requireAuth.js";

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

// GET /voice/supervisor/active-calls — snapshot of currently active calls with recent messages
router.get("/voice/supervisor/active-calls", requireAuth, async (req, res) => {
  try {
    const liveCalls = await db.query.voiceCalls.findMany({
      where: eq(voiceCalls.status, "in-progress"),
      orderBy: [desc(voiceCalls.startedAt)],
      limit: 20,
    });

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

    return res.json(callsWithMessages);
  } catch (err) {
    req.log.error({ err }, "Error fetching active calls for supervisor");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
