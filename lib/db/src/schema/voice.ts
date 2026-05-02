import { pgTable, text, uuid, timestamp, integer, boolean } from "drizzle-orm/pg-core";

export const voiceConfigs = pgTable("voice_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  businessName: text("business_name").notNull().default("My Business"),
  businessType: text("business_type").notNull().default("general"),
  greeting: text("greeting").notNull().default("Thank you for calling. How can I help you today?"),
  instructions: text("instructions").notNull().default(""),
  hoursJson: text("hours_json").notNull().default("{}"),
  servicesJson: text("services_json").notNull().default("[]"),
  voice: text("voice").notNull().default("nova"),
  transferNumber: text("transfer_number"),
  twilioAccountSid: text("twilio_account_sid"),
  twilioAuthToken: text("twilio_auth_token"),
  twilioPhoneNumber: text("twilio_phone_number"),
  faqJson: text("faq_json").notNull().default("[]"),
  scriptJson: text("script_json").notNull().default(""),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const voiceCalls = pgTable("voice_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  callSid: text("call_sid").notNull().unique(),
  fromNumber: text("from_number").notNull(),
  toNumber: text("to_number").notNull(),
  direction: text("direction").notNull().default("inbound"),
  status: text("status").notNull().default("in-progress"),
  durationSeconds: integer("duration_seconds"),
  outcome: text("outcome"),
  summary: text("summary"),
  recordingSid: text("recording_sid"),
  recordingUrl: text("recording_url"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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

export const voiceAppointments = pgTable("voice_appointments", {
  id: uuid("id").primaryKey().defaultRandom(),
  callId: uuid("call_id").references(() => voiceCalls.id, { onDelete: "set null" }),
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
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const voiceCampaigns = pgTable("voice_campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("draft"), // draft | running | paused | completed
  purpose: text("purpose").notNull().default(""),
  totalContacts: integer("total_contacts").notNull().default(0),
  calledCount: integer("called_count").notNull().default(0),
  completedCount: integer("completed_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const voiceCampaignContacts = pgTable("voice_campaign_contacts", {
  id: uuid("id").primaryKey().defaultRandom(),
  campaignId: uuid("campaign_id").references(() => voiceCampaigns.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  phone: text("phone").notNull(),
  notes: text("notes").notNull().default(""),
  status: text("status").notNull().default("pending"), // pending | calling | completed | failed | no-answer | skipped
  callSid: text("call_sid"),
  calledAt: timestamp("called_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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

export type VoiceConfig = typeof voiceConfigs.$inferSelect;
export type VoiceCall = typeof voiceCalls.$inferSelect;
export type VoiceMessage = typeof voiceMessages.$inferSelect;
export type VoiceAppointment = typeof voiceAppointments.$inferSelect;
export type VoiceWebhookAction = typeof voiceWebhookActions.$inferSelect;
export type VoiceCampaign = typeof voiceCampaigns.$inferSelect;
export type VoiceCampaignContact = typeof voiceCampaignContacts.$inferSelect;
