import { Router } from "express";
import { db } from "@workspace/db";
import { voiceUsers } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, type AuthedRequest } from "../../middlewares/requireAuth.js";
import { getAuth } from "@clerk/express";

const router = Router();

// GET /voice/me — get or create current user profile
router.get("/voice/me", requireAuth, async (req, res) => {
  try {
    const authed = req as AuthedRequest;
    const clerkUserId = authed.userId;

    let user = await db.query.voiceUsers.findFirst({
      where: eq(voiceUsers.clerkUserId, clerkUserId),
    });

    if (!user) {
      // First user ever → admin; otherwise receptionist
      const existing = await db.query.voiceUsers.findFirst();
      const role = existing ? "receptionist" : "admin";

      const auth = getAuth(req);
      const email = (auth?.sessionClaims as Record<string, unknown> | undefined)?.email as string
        ?? clerkUserId;

      [user] = await db
        .insert(voiceUsers)
        .values({ clerkUserId, email, role })
        .onConflictDoUpdate({
          target: voiceUsers.clerkUserId,
          set: { updatedAt: new Date() },
        })
        .returning();
    }

    return res.json(user);
  } catch (err) {
    req.log.error({ err }, "Error fetching current user");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// GET /voice/users — list all users (admin only)
router.get("/voice/users", requireAuth, async (req, res) => {
  try {
    const authed = req as AuthedRequest;
    const currentUser = await db.query.voiceUsers.findFirst({
      where: eq(voiceUsers.clerkUserId, authed.userId),
    });

    if (!currentUser || !["admin", "manager"].includes(currentUser.role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    const users = await db.query.voiceUsers.findMany({
      orderBy: (u, { asc }) => [asc(u.createdAt)],
    });
    return res.json(users);
  } catch (err) {
    req.log.error({ err }, "Error listing users");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /voice/users/:id/role — update a user's role (admin only)
router.put("/voice/users/:id/role", requireAuth, async (req, res) => {
  try {
    const authed = req as AuthedRequest;
    const currentUser = await db.query.voiceUsers.findFirst({
      where: eq(voiceUsers.clerkUserId, authed.userId),
    });

    if (!currentUser || currentUser.role !== "admin") {
      return res.status(403).json({ error: "Only admins can change roles" });
    }

    const { role } = req.body as { role?: string };
    if (!role || !["admin", "manager", "receptionist"].includes(role)) {
      return res.status(400).json({ error: "Invalid role" });
    }

    const userId = req.params["id"] as string;
    const [updated] = await db
      .update(voiceUsers)
      .set({ role, updatedAt: new Date() })
      .where(eq(voiceUsers.id, userId))
      .returning();

    if (!updated) return res.status(404).json({ error: "User not found" });
    return res.json(updated);
  } catch (err) {
    req.log.error({ err }, "Error updating user role");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
