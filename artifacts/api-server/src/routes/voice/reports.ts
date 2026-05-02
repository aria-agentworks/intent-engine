import { Router } from "express";
import { db } from "@workspace/db";
import { voiceCalls, voiceAppointments, voiceUsageEvents, voiceConfigs } from "@workspace/db";
import { sql, gte, eq, count } from "drizzle-orm";
import { requireAuth } from "../../middlewares/requireAuth.js";

const router = Router();

// GET /voice/reports/weekly — generate weekly summary data
router.get("/voice/reports/weekly", requireAuth, async (req, res) => {
  try {
    const since = new Date();
    since.setDate(since.getDate() - 7);
    since.setHours(0, 0, 0, 0);

    const [callStats] = await db
      .select({
        total: count(),
        completed: sql<number>`COUNT(*) FILTER (WHERE ${voiceCalls.status} = 'completed')`,
        avgDuration: sql<number>`ROUND(AVG(${voiceCalls.durationSeconds}) FILTER (WHERE ${voiceCalls.durationSeconds} IS NOT NULL), 0)`,
        avgQuality: sql<number>`ROUND(AVG(${voiceCalls.qualityScore}) FILTER (WHERE ${voiceCalls.qualityScore} IS NOT NULL), 1)`,
        escalated: sql<number>`COUNT(*) FILTER (WHERE ${voiceCalls.escalatedAt} IS NOT NULL)`,
      })
      .from(voiceCalls)
      .where(gte(voiceCalls.startedAt, since));

    const [apptStats] = await db
      .select({ total: count() })
      .from(voiceAppointments)
      .where(gte(voiceAppointments.createdAt, since));

    const [usageStats] = await db
      .select({
        totalSeconds: sql<number>`COALESCE(SUM(${voiceUsageEvents.durationSeconds}), 0)`,
        totalCostCents: sql<number>`COALESCE(SUM(${voiceUsageEvents.estimatedCostCents}), 0)`,
      })
      .from(voiceUsageEvents)
      .where(gte(voiceUsageEvents.createdAt, since));

    const byOutcome = await db
      .select({ outcome: voiceCalls.outcome, total: count() })
      .from(voiceCalls)
      .where(gte(voiceCalls.startedAt, since))
      .groupBy(voiceCalls.outcome);

    const dailyVolume = await db
      .select({
        date: sql<string>`DATE(${voiceCalls.startedAt})`,
        calls: count(),
      })
      .from(voiceCalls)
      .where(gte(voiceCalls.startedAt, since))
      .groupBy(sql`DATE(${voiceCalls.startedAt})`)
      .orderBy(sql`DATE(${voiceCalls.startedAt})`);

    const config = await db.query.voiceConfigs.findFirst();

    return res.json({
      businessName: config?.businessName ?? "My Business",
      period: { from: since.toISOString(), to: new Date().toISOString() },
      calls: {
        total: Number(callStats.total),
        completed: Number(callStats.completed),
        avgDurationSeconds: callStats.avgDuration ? Number(callStats.avgDuration) : null,
        avgQualityScore: callStats.avgQuality ? Number(callStats.avgQuality) : null,
        escalated: Number(callStats.escalated),
      },
      appointments: { booked: Number(apptStats.total) },
      usage: {
        totalMinutes: Math.ceil(Number(usageStats.totalSeconds) / 60),
        costDollars: (Number(usageStats.totalCostCents) / 100).toFixed(2),
      },
      byOutcome: byOutcome.map((o) => ({ outcome: o.outcome ?? "unknown", count: Number(o.total) })),
      dailyVolume: dailyVolume.map((d) => ({ date: d.date, calls: Number(d.calls) })),
    });
  } catch (err) {
    req.log.error({ err }, "Error generating weekly report");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /voice/reports/send — send weekly report via SMS to supervisor
router.post("/voice/reports/send", requireAuth, async (req, res) => {
  try {
    const config = await db.query.voiceConfigs.findFirst();
    if (!config?.twilioAccountSid || !config?.twilioAuthToken || !config?.twilioPhoneNumber) {
      return res.status(400).json({ error: "Twilio not configured" });
    }
    if (!config.supervisorPhone && !config.supervisorEmail) {
      return res.status(400).json({ error: "No supervisor phone or email configured in Settings" });
    }

    const since = new Date();
    since.setDate(since.getDate() - 7);
    const [callStats] = await db
      .select({
        total: count(),
        completed: sql<number>`COUNT(*) FILTER (WHERE ${voiceCalls.status} = 'completed')`,
      })
      .from(voiceCalls)
      .where(gte(voiceCalls.startedAt, since));

    const [apptStats] = await db
      .select({ total: count() })
      .from(voiceAppointments)
      .where(gte(voiceAppointments.createdAt, since));

    const message = `📊 Weekly AI Report — ${config.businessName}\n` +
      `Period: Last 7 days\n` +
      `• Total calls: ${Number(callStats.total)}\n` +
      `• Completed: ${Number(callStats.completed)}\n` +
      `• Appointments booked: ${Number(apptStats.total)}\n` +
      `Powered by VoiceAgent AI`;

    if (config.supervisorPhone) {
      const twilio = (await import("twilio")).default;
      const client = twilio(config.twilioAccountSid, config.twilioAuthToken);
      await client.messages.create({
        body: message,
        from: config.twilioPhoneNumber,
        to: config.supervisorPhone,
      });
    }

    return res.json({ ok: true, message });
  } catch (err) {
    req.log.error({ err }, "Error sending report");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
