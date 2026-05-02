import { Router } from "express";
import { db } from "@workspace/db";
import { voiceAuditLogs } from "@workspace/db";
import { desc, and, gte, lte } from "drizzle-orm";
import { requireAuth } from "../../middlewares/requireAuth.js";

const router = Router();

// GET /voice/audit-logs
router.get("/voice/audit-logs", requireAuth, async (req, res) => {
  try {
    const page = parseInt(req.query.page as string) || 1;
    const limit = Math.min(parseInt(req.query.limit as string) || 50, 200);
    const offset = (page - 1) * limit;
    const since = req.query.since as string | undefined;
    const until = req.query.until as string | undefined;

    const conditions = [];
    if (since) conditions.push(gte(voiceAuditLogs.createdAt, new Date(since)));
    if (until) conditions.push(lte(voiceAuditLogs.createdAt, new Date(until)));

    const logs = await db.query.voiceAuditLogs.findMany({
      where: conditions.length ? and(...conditions) : undefined,
      orderBy: [desc(voiceAuditLogs.createdAt)],
      limit,
      offset,
    });

    return res.json({ logs, page, total: logs.length });
  } catch (err) {
    req.log.error({ err }, "Error fetching audit logs");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

// ── Utility: write an audit log entry ────────────────────────────────────────
export async function writeAuditLog(opts: {
  clerkUserId?: string;
  userEmail?: string;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  ipAddress?: string;
  userAgent?: string;
}) {
  try {
    await db.insert(voiceAuditLogs).values({
      clerkUserId: opts.clerkUserId,
      userEmail: opts.userEmail,
      action: opts.action,
      resourceType: opts.resourceType,
      resourceId: opts.resourceId,
      details: opts.details ? JSON.stringify(opts.details) : undefined,
      ipAddress: opts.ipAddress,
      userAgent: opts.userAgent,
    });
  } catch {
    // Audit log failures must never crash the main flow
  }
}
