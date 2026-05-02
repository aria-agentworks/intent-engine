import { Router } from "express";
import { db } from "@workspace/db";
import { voiceDncList } from "@workspace/db";
import { eq, desc, ilike, or } from "drizzle-orm";
import { requireAuth } from "../../middlewares/requireAuth.js";

const router = Router();

// GET /voice/dnc
router.get("/voice/dnc", requireAuth, async (req, res) => {
  try {
    const search = req.query.search as string | undefined;
    const entries = await db.query.voiceDncList.findMany({
      where: search
        ? or(
            ilike(voiceDncList.phoneNumber, `%${search}%`),
            ilike(voiceDncList.reason, `%${search}%`)
          )
        : undefined,
      orderBy: [desc(voiceDncList.createdAt)],
      limit: 500,
    });
    return res.json({ entries, total: entries.length });
  } catch (err) {
    req.log.error({ err }, "Error fetching DNC list");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /voice/dnc — add number
router.post("/voice/dnc", requireAuth, async (req, res) => {
  try {
    const { phoneNumber, reason, expiresAt } = req.body as {
      phoneNumber?: string;
      reason?: string;
      expiresAt?: string;
    };

    if (!phoneNumber) return res.status(400).json({ error: "phoneNumber is required" });

    // Normalize: strip non-digits except leading +
    const normalized = phoneNumber.trim().replace(/(?!^\+)\D/g, "");

    const [entry] = await db
      .insert(voiceDncList)
      .values({
        phoneNumber: normalized,
        reason: reason ?? "",
        addedBy: (req as Request & { userId?: string }).userId ?? "admin",
        expiresAt: expiresAt ? new Date(expiresAt) : null,
      })
      .onConflictDoUpdate({
        target: voiceDncList.phoneNumber,
        set: {
          reason: reason ?? "",
          expiresAt: expiresAt ? new Date(expiresAt) : null,
        },
      })
      .returning();

    return res.status(201).json(entry);
  } catch (err) {
    req.log.error({ err }, "Error adding DNC entry");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /voice/dnc/bulk — import CSV array
router.post("/voice/dnc/bulk", requireAuth, async (req, res) => {
  try {
    const { numbers } = req.body as { numbers?: string[] };
    if (!Array.isArray(numbers) || numbers.length === 0) {
      return res.status(400).json({ error: "numbers array is required" });
    }
    const values = numbers.map((n) => ({
      phoneNumber: n.trim().replace(/(?!^\+)\D/g, ""),
      reason: "bulk import",
      addedBy: (req as Request & { userId?: string }).userId ?? "admin",
    }));
    await db.insert(voiceDncList).values(values).onConflictDoNothing();
    return res.json({ imported: values.length });
  } catch (err) {
    req.log.error({ err }, "Error bulk importing DNC");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /voice/dnc/:id
router.delete("/voice/dnc/:id", requireAuth, async (req, res) => {
  try {
    await db.delete(voiceDncList).where(eq(voiceDncList.id, req.params.id));
    return res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Error deleting DNC entry");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;

// ── Utility: check if a number is on the DNC list ────────────────────────────
export async function isDncBlocked(phoneNumber: string): Promise<boolean> {
  const normalized = phoneNumber.trim().replace(/(?!^\+)\D/g, "");
  const entry = await db.query.voiceDncList.findFirst({
    where: eq(voiceDncList.phoneNumber, normalized),
  });
  if (!entry) return false;
  if (entry.expiresAt && entry.expiresAt < new Date()) return false;
  return true;
}
