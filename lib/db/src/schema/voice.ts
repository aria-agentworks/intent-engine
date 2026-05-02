import { pgTable, text, uuid, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";

// ── Core config / location ───────────────────────────────────────────────────
export const voiceConfigs = pgTable("voice_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  // Identity
  locationName: text("location_name").notNull().default("Main Location"),
  businessName: text("business_name").notNull().default("My Business"),
  businessType: text("business_type").notNull().default("general"),
  // AI conversation
  greeting: text("greeting").notNull().default("Thank you for calling. How can I help you today?"),
  instructions: text("instructions").notNull().default(""),
  faqJson: text("faq_json").notNull().default("[]"),
  scriptJson: text("script_json").notNull().default(""),
  // Hours & voice
  hoursJson: text("hours_json").notNull().default("{}"),
  servicesJson: text("services_json").notNull().default("[]"),
  voice: text("voice").notNull().default("nova"),
  language: text("language").notNull().default("en-US"),
  // Twilio
  twilioAccountSid: text("twilio_account_sid"),
  twilioAuthToken: text("twilio_auth_token"),
  twilioPhoneNumber: text("twilio_phone_number"),
  // Transfer / escalation
  transferNumber: text("transfer_number"),
  supervisorPhone: text("supervisor_phone"),
  supervisorEmail: text("supervisor_email"),
  // IVR
  ivrEnabled: boolean("ivr_enabled").notNull().default(false),
  ivrMenuJson: text("ivr_menu_json").notNull().default("[]"),
  // Branding
  logoUrl: text("logo_url"),
  brandColor: text("brand_color").notNull().default("#2563eb"),
  // A/B testing
  abTestEnabled: boolean("ab_test_enabled").notNull().default(false),
  abScriptJson: text("ab_script_json").notNull().default(""),
  abGreeting: text("ab_greeting").notNull().default(""),
  // Reports & compliance
  weeklyReportEnabled: boolean("weekly_report_enabled").notNull().default(false),
  weeklyReportEmail: text("weekly_report_email"),
  dataRetentionDays: integer("data_retention_days").notNull().default(365),
  timezone: text("timezone").notNull().default("America/New_York"),
  isActive: boolean("is_active").notNull().default(false),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Calls ─────────────────────────────────────────────────────────────────────
export const voiceCalls = pgTable("voice_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  callSid: text("call_sid").notNull().unique(),
  configId: uuid("config_id").references(() => voiceConfigs.id, { onDelete: "set null" }),
  fromNumber: text("from_number").notNull(),
  toNumber: text("to_number").notNull(),
  direction: text("direction").notNull().default("inbound"),
  status: text("status").notNull().default("in-progress"),
  language: text("language").notNull().default("en-US"),
  durationSeconds: integer("duration_seconds"),
  outcome: text("outcome"),
  summary: text("summary"),
  // Recording
  recordingSid: text("recording_sid"),
  recordingUrl: text("recording_url"),
  // Quality scoring
  qualityScore: integer("quality_score"),   // 1–5
  qualityNotes: text("quality_notes"),
  qualityFlags: text("quality_flags"),      // JSON array of flag strings
  // Escalation
  escalatedAt: timestamp("escalated_at"),
  escalatedTo: text("escalated_to"),
  // IVR
  ivrPath: text("ivr_path"),                // which IVR branch was taken
  // A/B
  abVariant: text("ab_variant"),            // "A" | "B"
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Messages ──────────────────────────────────────────────────────────────────
export const voiceMessages = pgTable("voice_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  callId: uuid("call_id")
    .references(() => voiceCalls.id, { onDelete: "cascade" })
    .notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  audioReady: boolean("audio_ready").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Appointments ──────────────────────────────────────────────────────────────
export const voiceAppointments = pgTable("voice_appointments", {
  id: uuid("id").primaryKey().defaultRandom(),
  callId: uuid("call_id").references(() => voiceCalls.id, { onDelete: "set null" }),
  configId: uuid("config_id").references(() => voiceConfigs.id, { onDelete: "set null" }),
  patientName: text("patient_name").notNull(),
  patientPhone: text("patient_phone").notNull().default(""),
  requestedDate: text("requested_date").notNull().default(""),
  requestedTime: text("requested_time").notNull().default(""),
  reason: text("reason").notNull().default(""),
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("pending"),
  externalId: text("external_id"),
  externalData: text("external_data"),
  reminderSentAt: timestamp("reminder_sent_at"),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Campaigns ─────────────────────────────────────────────────────────────────
export const voiceCampaigns = pgTable("voice_campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  configId: uuid("config_id").references(() => voiceConfigs.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("draft"),
  purpose: text("purpose").notNull().default(""),
  totalContacts: integer("total_contacts").notNull().default(0),
  calledCount: integer("called_count").notNull().default(0),
  completedCount: integer("completed_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  dncChecked: boolean("dnc_checked").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const voiceCampaignContacts = pgTable("voice_campaign_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").references(() => voiceCampaigns.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("pending"),
  callSid: text("call_sid"),
  calledAt: timestamp("called_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Webhook actions ───────────────────────────────────────────────────────────
export const voiceWebhookActions = pgTable("voice_webhook_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  actionType: text("action_type").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  method: text("method").notNull().default("POST"),
  url: text("url").notNull(),
  headersJson: text("headers_json").notNull().default("{}"),
  bodyTemplate: text("body_template").notNull().default(""),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── RBAC users ────────────────────────────────────────────────────────────────
export const voiceUsers = pgTable("voice_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  role: text("role").notNull().default("receptionist"), // admin | manager | receptionist
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── DNC (Do Not Call) list ────────────────────────────────────────────────────
export const voiceDncList = pgTable("voice_dnc_list", {
  id: uuid("id").primaryKey().defaultRandom(),
  phoneNumber: text("phone_number").notNull().unique(),
  reason: text("reason").notNull().default(""),
  addedBy: text("added_by"),           // clerkUserId or "system"
  expiresAt: timestamp("expires_at"),  // null = permanent
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── HIPAA Audit logs ──────────────────────────────────────────────────────────
export const voiceAuditLogs = pgTable("voice_audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id"),
  userEmail: text("user_email"),
  action: text("action").notNull(),          // e.g. "call.view", "recording.play", "config.update"
  resourceType: text("resource_type"),       // "call" | "appointment" | "config" | "recording"
  resourceId: text("resource_id"),
  details: text("details"),                 // JSON string with extra context
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Knowledge base versions ───────────────────────────────────────────────────
export const voiceKbVersions = pgTable("voice_kb_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  configId: uuid("config_id").references(() => voiceConfigs.id, { onDelete: "cascade" }).notNull(),
  faqJson: text("faq_json").notNull().default("[]"),
  scriptJson: text("script_json").notNull().default(""),
  ivrMenuJson: text("ivr_menu_json").notNull().default("[]"),
  notes: text("notes").notNull().default(""),
  createdBy: text("created_by"),             // clerkUserId
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Usage / metering ──────────────────────────────────────────────────────────
export const voiceUsageEvents = pgTable("voice_usage_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  callId: uuid("call_id").references(() => voiceCalls.id, { onDelete: "cascade" }).notNull(),
  configId: uuid("config_id").references(() => voiceConfigs.id, { onDelete: "set null" }),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  aiTokensUsed: integer("ai_tokens_used").notNull().default(0),
  twilioMinutes: integer("twilio_minutes").notNull().default(0),
  estimatedCostCents: integer("estimated_cost_cents").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Type exports ──────────────────────────────────────────────────────────────
export type VoiceConfig = typeof voiceConfigs.$inferSelect;
export type VoiceCall = typeof voiceCalls.$inferSelect;
export type VoiceMessage = typeof voiceMessages.$inferSelect;
export type VoiceAppointment = typeof voiceAppointments.$inferSelect;
export type VoiceWebhookAction = typeof voiceWebhookActions.$inferSelect;
export type VoiceCampaign = typeof voiceCampaigns.$inferSelect;
export type VoiceCampaignContact = typeof voiceCampaignContacts.$inferSelect;
export type VoiceUser = typeof voiceUsers.$inferSelect;
export type VoiceDncEntry = typeof voiceDncList.$inferSelect;
export type VoiceAuditLog = typeof voiceAuditLogs.$inferSelect;
export type VoiceKbVersion = typeof voiceKbVersions.$inferSelect;
export type VoiceUsageEvent = typeof voiceUsageEvents.$inferSelect;
