import { Router } from "express";
import { db } from "@workspace/db";
import { voiceUsageEvents, voiceCalls } from "@workspace/db";
import { eq, sql, gte, sum, count } from "drizzle-orm";
import { requireAuth } from "../../middlewares/requireAuth.js";

const router = Router();

// GET /voice/usage — usage summary
router.get("/voice/usage", requireAuth, async (req, res) => {
  try {
    const period = (req.query.period as string) || "month";
    const since = new Date();
    if (period === "month") since.setDate(1);
    else if (period === "week") since.setDate(since.getDate() - 7);
    else if (period === "day") since.setHours(0, 0, 0, 0);
    else since.setDate(1); // default month

    // Total events in period
    const [totals] = await db
      .select({
        totalSeconds: sql<number>`COALESCE(SUM(${voiceUsageEvents.durationSeconds}), 0)`,
        totalTokens: sql<number>`COALESCE(SUM(${voiceUsageEvents.aiTokensUsed}), 0)`,
        totalCostCents: sql<number>`COALESCE(SUM(${voiceUsageEvents.estimatedCostCents}), 0)`,
        totalEvents: count(),
      })
      .from(voiceUsageEvents)
      .where(gte(voiceUsageEvents.createdAt, since));

    // Daily breakdown
    const daily = await db
      .select({
        date: sql<string>`DATE(${voiceUsageEvents.createdAt})`,
        seconds: sql<number>`COALESCE(SUM(${voiceUsageEvents.durationSeconds}), 0)`,
        costCents: sql<number>`COALESCE(SUM(${voiceUsageEvents.estimatedCostCents}), 0)`,
        calls: count(),
      })
      .from(voiceUsageEvents)
      .where(gte(voiceUsageEvents.createdAt, since))
      .groupBy(sql`DATE(${voiceUsageEvents.createdAt})`)
      .orderBy(sql`DATE(${voiceUsageEvents.createdAt})`);

    return res.json({
      period,
      since: since.toISOString(),
      totalMinutes: Math.ceil(Number(totals.totalSeconds) / 60),
      totalTokens: Number(totals.totalTokens),
      totalCostCents: Number(totals.totalCostCents),
      totalCostDollars: (Number(totals.totalCostCents) / 100).toFixed(2),
      totalCalls: Number(totals.totalEvents),
      daily: daily.map((d) => ({
        date: d.date,
        minutes: Math.ceil(Number(d.seconds) / 60),
        costCents: Number(d.costCents),
        calls: Number(d.calls),
      })),
      // Estimates at current rate
      estimatedMonthly: period !== "month"
        ? null
        : (Number(totals.totalCostCents) / 100).toFixed(2),
    });
  } catch (err) {
    req.log.error({ err }, "Error fetching usage");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

// ── Utility: record usage for a completed call ────────────────────────────────
// Twilio: ~$0.0085/min outbound, ~$0.0085/min inbound
// GPT-4o-mini: ~$0.00015/1k input tokens, ~$0.0006/1k output tokens
const TWILIO_COST_PER_MINUTE_CENTS = 0.85;
const GPT_COST_PER_1K_TOKENS_CENTS = 0.015;

export async function recordUsageEvent(
  callId: string,
  configId: string | null | undefined,
  durationSeconds: number,
  aiTokensUsed: number
) {
  try {
    const twilioMinutes = Math.ceil(durationSeconds / 60);
    const twilioCost = twilioMinutes * TWILIO_COST_PER_MINUTE_CENTS;
    const aiCost = (aiTokensUsed / 1000) * GPT_COST_PER_1K_TOKENS_CENTS;
    const estimatedCostCents = Math.round((twilioCost + aiCost) * 100) / 100;

    await db.insert(voiceUsageEvents).values({
      callId,
      configId: configId ?? undefined,
      durationSeconds,
      aiTokensUsed,
      twilioMinutes,
      estimatedCostCents: Math.round(estimatedCostCents),
    });
  } catch {
    // Non-fatal
  }
}
