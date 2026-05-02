import { Router } from "express";
import { db } from "@workspace/db";
import { voiceConfigs } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../../middlewares/requireAuth.js";

const router = Router();

const DEFAULT_HOURS = JSON.stringify({
  monday:    { open: "09:00", close: "17:00", closed: false },
  tuesday:   { open: "09:00", close: "17:00", closed: false },
  wednesday: { open: "09:00", close: "17:00", closed: false },
  thursday:  { open: "09:00", close: "17:00", closed: false },
  friday:    { open: "09:00", close: "17:00", closed: false },
  saturday:  { open: "09:00", close: "13:00", closed: true },
  sunday:    { open: "09:00", close: "13:00", closed: true },
});

// GET /voice/locations — list all locations
router.get("/voice/locations", requireAuth, async (req, res) => {
  try {
    const locations = await db.query.voiceConfigs.findMany({
      orderBy: [desc(voiceConfigs.isDefault), desc(voiceConfigs.createdAt)],
    });
    // Mask auth tokens
    const masked = locations.map((l) => ({
      ...l,
      twilioAuthToken: l.twilioAuthToken ? "••••••••" : null,
    }));
    return res.json(masked);
  } catch (err) {
    req.log.error({ err }, "Error listing locations");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /voice/locations — create a new location
router.post("/voice/locations", requireAuth, async (req, res) => {
  try {
    const body = req.body as Partial<typeof voiceConfigs.$inferInsert>;
    const [location] = await db
      .insert(voiceConfigs)
      .values({
        locationName: body.locationName ?? "New Location",
        businessName: body.businessName ?? "My Business",
        businessType: body.businessType ?? "general",
        greeting: body.greeting ?? "Thank you for calling. How can I help you today?",
        instructions: body.instructions ?? "",
        hoursJson: body.hoursJson ?? DEFAULT_HOURS,
        servicesJson: body.servicesJson ?? "[]",
        faqJson: body.faqJson ?? "[]",
        scriptJson: body.scriptJson ?? "",
        voice: body.voice ?? "nova",
        language: body.language ?? "en-US",
        twilioAccountSid: body.twilioAccountSid,
        twilioAuthToken: body.twilioAuthToken,
        twilioPhoneNumber: body.twilioPhoneNumber,
        transferNumber: body.transferNumber,
        supervisorPhone: body.supervisorPhone,
        supervisorEmail: body.supervisorEmail,
        brandColor: body.brandColor ?? "#2563eb",
        isActive: body.isActive ?? false,
        isDefault: false,
      })
      .returning();
    return res.status(201).json({ ...location, twilioAuthToken: location.twilioAuthToken ? "••••••••" : null });
  } catch (err) {
    req.log.error({ err }, "Error creating location");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// PUT /voice/locations/:id
router.put("/voice/locations/:id", requireAuth, async (req, res) => {
  try {
    const body = req.body as Partial<typeof voiceConfigs.$inferInsert>;
    // Don't accidentally clear auth token if masked placeholder sent
    const patch: Partial<typeof voiceConfigs.$inferInsert> & { updatedAt: Date } = {
      ...body,
      updatedAt: new Date(),
    };
    if (patch.twilioAuthToken === "••••••••") delete patch.twilioAuthToken;

    const locId = req.params["id"] as string;
    const [updated] = await db
      .update(voiceConfigs)
      .set(patch)
      .where(eq(voiceConfigs.id, locId))
      .returning();
    if (!updated) return res.status(404).json({ error: "Location not found" });
    return res.json({ ...updated, twilioAuthToken: updated.twilioAuthToken ? "••••••••" : null });
  } catch (err) {
    req.log.error({ err }, "Error updating location");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// POST /voice/locations/:id/set-default
router.post("/voice/locations/:id/set-default", requireAuth, async (req, res) => {
  try {
    const locId = req.params["id"] as string;
    await db.update(voiceConfigs).set({ isDefault: false });
    await db.update(voiceConfigs)
      .set({ isDefault: true })
      .where(eq(voiceConfigs.id, locId));
    return res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Error setting default location");
    return res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /voice/locations/:id
router.delete("/voice/locations/:id", requireAuth, async (req, res) => {
  try {
    const locId = req.params["id"] as string;
    const loc = await db.query.voiceConfigs.findFirst({
      where: eq(voiceConfigs.id, locId),
    });
    if (!loc) return res.status(404).json({ error: "Location not found" });
    if (loc.isDefault) return res.status(400).json({ error: "Cannot delete the default location" });
    await db.delete(voiceConfigs).where(eq(voiceConfigs.id, locId));
    return res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Error deleting location");
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
