import { Router } from "express";
import twilioRouter from "./twilio.js";
import configRouter from "./config.js";
import callsRouter from "./calls.js";
import analyticsRouter from "./analytics.js";
import appointmentsRouter from "./appointments.js";
import integrationsRouter from "./integrations.js";
import remindersRouter from "./reminders.js";
import campaignsRouter from "./campaigns.js";
import dncRouter from "./dnc.js";
import auditRouter from "./audit.js";
import locationsRouter from "./locations.js";
import supervisorRouter from "./supervisor.js";
import usageRouter from "./usage.js";
import reportsRouter from "./reports.js";
import userMgmtRouter from "./userMgmt.js";

const router = Router();

// Twilio webhooks first (no auth required — Twilio calls these)
router.use(twilioRouter);

// Authenticated routes
router.use(analyticsRouter);
router.use(appointmentsRouter);
router.use(integrationsRouter);
router.use(remindersRouter);
router.use(campaignsRouter);
router.use(configRouter);
router.use(callsRouter);

// Enterprise features
router.use(dncRouter);
router.use(auditRouter);
router.use(locationsRouter);
router.use(supervisorRouter);
router.use(usageRouter);
router.use(reportsRouter);
router.use(userMgmtRouter);

export default router;
