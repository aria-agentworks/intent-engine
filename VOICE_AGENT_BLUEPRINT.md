# VoiceAgent — Complete Build Blueprint
> Paste this entire document into the new Replit project agent to rebuild the standalone Voice Agent app.

---

## AGENT PROMPT (paste this first)

```
Build a standalone, full-stack enterprise AI Voice Agent SaaS platform for medical, dental, legal, and professional front desks. This is a pnpm monorepo with a React+Vite frontend, a Node/Express API server, and a PostgreSQL database. Use Clerk for auth, Drizzle ORM, Twilio Media Streams WebSocket for real-time AI phone calls, OpenAI Whisper for STT, GPT-4o-mini for conversation, and OpenAI TTS for voice output. Full feature list, schema, implementation code, and dependencies are all provided below — implement exactly as specified.
```

---

## 1. ARCHITECTURE

```
monorepo/
├── artifacts/
│   ├── api-server/          # Express + WebSocket backend  (PORT env, /api/* paths)
│   └── voice-agent/         # React + Vite frontend        (/voice-agent/ path)
├── lib/
│   ├── db/                  # Drizzle schema + migrations
│   ├── api-spec/            # OpenAPI spec + codegen
│   └── api-client-react/    # Generated React Query hooks
└── pnpm-workspace.yaml
```

**Deployment:**
- API server: `deploymentTarget = "vm"` (always-running — WebSocket sessions + in-memory EventEmitter)
- Frontend: `serve = "static"` (CDN)

---

## 2. TECH STACK

| Layer | Technology |
|---|---|
| Frontend | React 19, Vite, Tailwind CSS v4, shadcn/ui, Wouter router, TanStack Query |
| Auth | Clerk (`@clerk/react` + `@clerk/express`) |
| Backend | Express 5, Node.js, TypeScript, ESBuild |
| WebSocket | `ws` package (noServer mode, upgraded from HTTP server) |
| Database | PostgreSQL + Drizzle ORM |
| AI — STT | OpenAI Whisper (`whisper-1`) |
| AI — NLU | OpenAI GPT-4o-mini with function calling |
| AI — TTS | OpenAI TTS (`tts-1`, pcm format) |
| Telephony | Twilio Media Streams (real-time mu-law audio over WebSocket) |
| Codec | Pure JS mu-law G.711 encoder/decoder + linear resampler (no ffmpeg) |
| Logging | Pino + pino-http |
| Charts | Recharts |
| Icons | Lucide React |

---

## 3. ENVIRONMENT SECRETS REQUIRED

```
# Twilio (stored in DB per config, but also as env fallback)
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_PHONE_NUMBER=

# OpenAI
OPENAI_API_KEY=

# Clerk
CLERK_SECRET_KEY=
CLERK_PUBLISHABLE_KEY=
VITE_CLERK_PUBLISHABLE_KEY=   # same value, exposed to Vite frontend

# Replit auto-provided
DATABASE_URL=
SESSION_SECRET=
REPLIT_DOMAINS=
PORT=
```

---

## 4. DATABASE SCHEMA (Drizzle ORM — lib/db/src/schema/voice.ts)

```typescript
import { pgTable, text, uuid, timestamp, integer, boolean, jsonb } from "drizzle-orm/pg-core";

export const voiceConfigs = pgTable("voice_configs", {
  id: uuid("id").primaryKey().defaultRandom(),
  locationName: text("location_name").notNull().default("Main Location"),
  businessName: text("business_name").notNull().default("My Business"),
  businessType: text("business_type").notNull().default("general"),
  greeting: text("greeting").notNull().default("Thank you for calling. How can I help you today?"),
  instructions: text("instructions").notNull().default(""),
  faqJson: text("faq_json").notNull().default("[]"),
  scriptJson: text("script_json").notNull().default(""),
  hoursJson: text("hours_json").notNull().default("{}"),
  servicesJson: text("services_json").notNull().default("[]"),
  voice: text("voice").notNull().default("nova"),
  language: text("language").notNull().default("en-US"),
  twilioAccountSid: text("twilio_account_sid"),
  twilioAuthToken: text("twilio_auth_token"),
  twilioPhoneNumber: text("twilio_phone_number"),
  transferNumber: text("transfer_number"),
  supervisorPhone: text("supervisor_phone"),
  supervisorEmail: text("supervisor_email"),
  ivrEnabled: boolean("ivr_enabled").notNull().default(false),
  ivrMenuJson: text("ivr_menu_json").notNull().default("[]"),
  logoUrl: text("logo_url"),
  brandColor: text("brand_color").notNull().default("#2563eb"),
  abTestEnabled: boolean("ab_test_enabled").notNull().default(false),
  abScriptJson: text("ab_script_json").notNull().default(""),
  abGreeting: text("ab_greeting").notNull().default(""),
  weeklyReportEnabled: boolean("weekly_report_enabled").notNull().default(false),
  weeklyReportEmail: text("weekly_report_email"),
  dataRetentionDays: integer("data_retention_days").notNull().default(365),
  timezone: text("timezone").notNull().default("America/New_York"),
  isActive: boolean("is_active").notNull().default(false),
  isDefault: boolean("is_default").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

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
  recordingSid: text("recording_sid"),
  recordingUrl: text("recording_url"),
  qualityScore: integer("quality_score"),
  qualityNotes: text("quality_notes"),
  qualityFlags: text("quality_flags"),
  escalatedAt: timestamp("escalated_at"),
  escalatedTo: text("escalated_to"),
  ivrPath: text("ivr_path"),
  abVariant: text("ab_variant"),
  startedAt: timestamp("started_at").defaultNow().notNull(),
  endedAt: timestamp("ended_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const voiceMessages = pgTable("voice_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  callId: uuid("call_id").references(() => voiceCalls.id, { onDelete: "cascade" }).notNull(),
  role: text("role").notNull(),       // "user" | "assistant"
  content: text("content").notNull(),
  audioReady: boolean("audio_ready").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
  reminderSentAt: timestamp("reminder_sent_at"),
  confirmedAt: timestamp("confirmed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const voiceCampaigns = pgTable("voice_campaigns", {
  id: uuid("id").primaryKey().defaultRandom(),
  configId: uuid("config_id").references(() => voiceConfigs.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  status: text("status").notNull().default("draft"),  // draft|active|paused|completed
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
  status: text("status").notNull().default("pending"),  // pending|called|completed|failed|dnc
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

export const voiceUsers = pgTable("voice_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  email: text("email").notNull(),
  name: text("name").notNull().default(""),
  role: text("role").notNull().default("receptionist"),  // admin|manager|receptionist
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const voiceDncList = pgTable("voice_dnc_list", {
  id: uuid("id").primaryKey().defaultRandom(),
  phoneNumber: text("phone_number").notNull().unique(),
  reason: text("reason").notNull().default(""),
  addedBy: text("added_by"),
  expiresAt: timestamp("expires_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const voiceAuditLogs = pgTable("voice_audit_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  clerkUserId: text("clerk_user_id"),
  userEmail: text("user_email"),
  action: text("action").notNull(),
  resourceType: text("resource_type"),
  resourceId: text("resource_id"),
  details: text("details"),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const voiceKbVersions = pgTable("voice_kb_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  configId: uuid("config_id").references(() => voiceConfigs.id, { onDelete: "cascade" }).notNull(),
  faqJson: text("faq_json").notNull().default("[]"),
  scriptJson: text("script_json").notNull().default(""),
  ivrMenuJson: text("ivr_menu_json").notNull().default("[]"),
  notes: text("notes").notNull().default(""),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

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
```

---

## 5. API SERVER — PACKAGES

```json
{
  "dependencies": {
    "@clerk/express": "^2.1.12",
    "cookie-parser": "^1.4.7",
    "cors": "^2",
    "drizzle-orm": "catalog:",
    "express": "^5",
    "pino": "^9",
    "pino-http": "^10",
    "twilio": "^5",
    "ws": "^8.20.0"
  },
  "devDependencies": {
    "@types/cookie-parser": "^1.4.10",
    "@types/cors": "^2.8.19",
    "@types/express": "^5.0.6",
    "@types/node": "catalog:",
    "@types/ws": "^8.18.1",
    "esbuild": "^0.27.3",
    "esbuild-plugin-pino": "^2.3.3",
    "pino-pretty": "^13",
    "thread-stream": "3.1.0"
  }
}
```

---

## 6. API ROUTES MAP

### Twilio Webhooks (NO auth — Twilio calls these directly)
| Method | Path | Purpose |
|---|---|---|
| POST | `/api/voice/stream-inbound` | **Primary** — returns `<Connect><Stream>` TwiML to start WebSocket real-time AI session |
| WS | `/api/voice/stream` | WebSocket brain: mu-law audio → VAD → Whisper STT → GPT → TTS → mu-law |
| POST | `/api/voice/inbound` | Legacy fallback — Gather TwiML loop (non-streaming) |
| POST | `/api/voice/gather` | Processes speech from Gather, runs GPT, returns next TwiML |
| POST | `/api/voice/ivr-select` | Handles DTMF IVR menu digit selection |
| POST | `/api/voice/status` | Call status callback — updates call record on complete/failed |
| POST | `/api/voice/outbound-stream-twiml` | TwiML for outbound AI calls (Connect/Stream) |
| POST | `/api/voice/recording-status` | Recording webhook — saves MP3 URL, triggers voicemail SMS |

### Authenticated Routes (Clerk JWT required)
| Method | Path | Purpose |
|---|---|---|
| GET | `/api/voice/config` | Get business config (returns webhookUrls too) |
| PUT | `/api/voice/config/:id` | Update business config |
| POST | `/api/voice/config` | Create new config |
| GET | `/api/voice/calls` | Paginated call log (filter: status, outcome, date, search) |
| GET | `/api/voice/calls/stats` | Dashboard stats (total, missed, avg duration, quality avg) |
| GET | `/api/voice/calls/:id` | Single call with messages (transcript) |
| PUT | `/api/voice/calls/:id` | Update call (outcome, notes) |
| GET | `/api/voice/analytics` | Chart data (daily volume, hourly heatmap, sentiment, outcomes) |
| GET | `/api/voice/appointments` | List appointments |
| PUT | `/api/voice/appointments/:id` | Update appointment status |
| GET | `/api/voice/locations` | Multi-location list |
| POST | `/api/voice/locations` | Create location |
| GET | `/api/voice/dnc` | DNC list |
| POST | `/api/voice/dnc` | Add to DNC |
| DELETE | `/api/voice/dnc/:id` | Remove from DNC |
| GET | `/api/voice/audit` | Audit log |
| GET | `/api/voice/usage` | Usage metrics |
| GET | `/api/voice/reports` | Analytics reports |
| GET | `/api/voice/supervisor/live` | **SSE stream** — real-time call events for supervisor |
| GET | `/api/voice/supervisor/active-calls` | Snapshot: active calls (DB + in-memory WS sessions) |
| POST | `/api/voice/outbound/call` | Place outbound AI call via Twilio |
| GET | `/api/voice/campaigns` | Outbound campaigns list |
| POST | `/api/voice/campaigns` | Create campaign |

---

## 7. CORE IMPLEMENTATION FILES

### 7a. mulaw.ts — G.711 Codec (pure JS, no native deps)

```typescript
// Twilio sends 8-bit mu-law at 8000 Hz. OpenAI TTS PCM is 16-bit at 24000 Hz.
const ULAW_BIAS = 0x84;
const ULAW_CLIP = 32635;

export function decodeUlawSample(b: number): number {
  b = ~b & 0xff;
  const sign = b & 0x80;
  const exp = (b >> 4) & 0x07;
  const mantissa = b & 0x0f;
  let sample = ((mantissa << 3) + ULAW_BIAS) << exp;
  sample -= ULAW_BIAS;
  return sign ? -sample : sample;
}

export function encodeUlawSample(sample: number): number {
  let sign = 0;
  if (sample < 0) { sample = -sample; sign = 0x80; }
  sample = Math.min(sample, ULAW_CLIP);
  sample += ULAW_BIAS;
  let exp = 7;
  for (let mask = 0x4000; (sample & mask) === 0 && exp > 0; exp--, mask >>= 1) {}
  const mantissa = (sample >> (exp + 3)) & 0x0f;
  return (~(sign | (exp << 4) | mantissa)) & 0xff;
}

export function ulawToLinear(buf: Buffer): Int16Array {
  const out = new Int16Array(buf.length);
  for (let i = 0; i < buf.length; i++) out[i] = decodeUlawSample(buf[i]!);
  return out;
}

export function linearToUlaw(pcm: Int16Array): Buffer {
  const out = Buffer.allocUnsafe(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = encodeUlawSample(pcm[i]!);
  return out;
}

export function resample(samples: Int16Array, srcRate: number, dstRate: number): Int16Array {
  if (srcRate === dstRate) return samples;
  const ratio = srcRate / dstRate;
  const outLen = Math.floor(samples.length / ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const lo = Math.floor(srcIdx);
    const hi = Math.min(lo + 1, samples.length - 1);
    const frac = srcIdx - lo;
    out[i] = Math.round((samples[lo]! * (1 - frac)) + (samples[hi]! * frac));
  }
  return out;
}

export function wrapInWav(pcm: Int16Array, sampleRate: number): Buffer {
  const numChannels = 1, bitsPerSample = 16;
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcm.length * 2;
  const buf = Buffer.allocUnsafe(44 + dataSize);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + dataSize, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(numChannels, 22); buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28); buf.writeUInt16LE(blockAlign, 32);
  buf.writeUInt16LE(bitsPerSample, 34); buf.write("data", 36); buf.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < pcm.length; i++) buf.writeInt16LE(pcm[i]!, 44 + i * 2);
  return buf;
}
```

### 7b. vad.ts — Voice Activity Detector

```typescript
// Energy-based VAD at 8000 Hz. Detects utterances: silence → speech → silence.
const FRAME_MS = 20;
const SAMPLES_PER_FRAME = 160;        // 8000 Hz × 20ms
const SPEECH_THRESHOLD = 300;         // RMS energy cutoff
const SILENCE_FRAMES_NEEDED = 40;     // 800ms silence → end of phrase
const MIN_SPEECH_FRAMES = 5;          // 100ms minimum to trigger

function rms(samples: Int16Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i]! * samples[i]!;
  return Math.sqrt(sum / samples.length);
}

export interface VadResult { complete: boolean; samples?: Int16Array; }

export class VAD {
  private accumulator: number[] = [];
  private speechBuffer: Int16Array[] = [];
  private silenceCount = 0;
  private speechCount = 0;
  private active = false;

  addChunk(chunk: Int16Array): VadResult {
    for (let i = 0; i < chunk.length; i++) this.accumulator.push(chunk[i]!);
    let result: VadResult = { complete: false };
    while (this.accumulator.length >= SAMPLES_PER_FRAME) {
      const frame = new Int16Array(this.accumulator.splice(0, SAMPLES_PER_FRAME));
      const isSpeech = rms(frame) > SPEECH_THRESHOLD;
      if (isSpeech) {
        this.speechCount++; this.silenceCount = 0; this.active = true;
        this.speechBuffer.push(frame);
      } else if (this.active) {
        this.silenceCount++;
        this.speechBuffer.push(frame);
        if (this.silenceCount >= SILENCE_FRAMES_NEEDED && this.speechCount >= MIN_SPEECH_FRAMES) {
          result = { complete: true, samples: this.drain() };
          this.reset(); break;
        }
      }
    }
    return result;
  }

  private drain(): Int16Array {
    const total = this.speechBuffer.reduce((n, b) => n + b.length, 0);
    const out = new Int16Array(total);
    let offset = 0;
    for (const b of this.speechBuffer) { out.set(b, offset); offset += b.length; }
    return out;
  }

  reset() { this.accumulator = []; this.speechBuffer = []; this.silenceCount = 0; this.speechCount = 0; this.active = false; }
  isActive() { return this.active; }
}
```

### 7c. gpt.ts — Conversation Intelligence

Key facts:
- Model: `gpt-4o-mini`, max 200 tokens per response (phone calls must be concise)
- System prompt includes: business name, type context, services, hours, FAQ, custom script, transfer rules
- Function tools: `book_appointment`, `check_availability`, `cancel_appointment`, `lookup_patient`, `transfer_to_human`
- Business types: `medical`, `dental`, `legal`, `salon`, `restaurant`, `general`
- Hours checked via `Intl.DateTimeFormat` with per-config timezone
- Two entrypoints: `generateVoiceResponse` (simple) and `generateVoiceResponseWithFunctions` (with tool calling)
- CRITICAL: responses must be 1-2 sentences, no markdown, natural phone speech only

### 7d. stream.ts — WebSocket Brain (MOST CRITICAL FILE)

**Flow:** Twilio connects WebSocket → `start` event → initSession → play greeting TTS → `media` events → VAD accumulates audio → utterance detected → Whisper STT → GPT with tools → OpenAI TTS (pcm 24kHz) → resample to 8kHz → linearToUlaw → sendMedia back to Twilio

**Key constants:**
```typescript
const TTS_SAMPLE_RATE = 24000;   // OpenAI TTS output
const TWILIO_SAMPLE_RATE = 8000; // Twilio Media Streams
const SEND_CHUNK_BYTES = 160;    // 20ms chunks to Twilio's jitter buffer
```

**Session object:**
```typescript
interface Session {
  callSid: string;
  streamSid: string;
  callDbId: string | null;
  config: VoiceConfig | null;
  vad: VAD;
  processing: boolean;   // prevents overlapping STT/GPT/TTS calls
  done: boolean;
}
```

**In-memory live session registry (for supervisor):**
```typescript
const liveSessionMap = new Map<string, LiveSessionMeta>();
export function getActiveSessions(): LiveSessionMeta[] {
  return Array.from(liveSessionMap.values());
}
```

**WebSocket events handled:** `connected`, `start`, `media`, `stop`

**On utterance complete:**
1. `transcribe()` — PCM → WAV → Whisper → text
2. Persist user message to DB + emit SSE supervisor event
3. Load last 20 messages as history
4. `generateVoiceResponseWithFunctions()` — GPT with tools
5. Persist AI message + emit SSE event
6. `sendClear()` — cancel in-flight audio
7. `textToUlaw()` — TTS → PCM 24kHz → resample → mu-law
8. `sendMedia()` — stream 20ms chunks to Twilio

**On call end (`stop` event):**
- Remove from liveSessionMap
- `finalizeCall()` — GPT summarizes transcript, scores quality (1-5), classifies outcome, updates DB

**TwiML for stream-inbound:**
```xml
<Response>
  <Connect>
    <Stream url="wss://your-domain.replit.app/api/voice/stream">
      <Parameter name="configId" value="uuid-here" />
    </Stream>
  </Connect>
</Response>
```

**HTTP server setup (index.ts):**
```typescript
import http from "http";
import app from "./app";
import { createMediaStreamWss } from "./routes/voice/stream.js";
import { startReminderScheduler } from "./routes/voice/reminders.js";

const server = http.createServer(app);
const mediaStreamWss = createMediaStreamWss();

server.on("upgrade", (req, socket, head) => {
  if (req.url === "/api/voice/stream") {
    mediaStreamWss.handleUpgrade(req, socket, head, (ws) => {
      mediaStreamWss.emit("connection", ws, req);
    });
  } else {
    socket.destroy();
  }
});

server.listen(port);
startReminderScheduler();
```

### 7e. supervisorEvents.ts — SSE EventEmitter

```typescript
import { EventEmitter } from "events";

export interface SupervisorEvent {
  type: "message" | "call_start" | "call_end" | "escalation";
  callId: string;
  callSid: string;
  fromNumber?: string;
  toNumber?: string;
  direction?: string;
  role?: "user" | "assistant";
  content?: string;
  timestamp: string;
}

class SupervisorEventEmitter extends EventEmitter {}
export const supervisorEvents = new SupervisorEventEmitter();
supervisorEvents.setMaxListeners(200);
```

**Supervisor SSE route:** `GET /api/voice/supervisor/live`
- Sets `Content-Type: text/event-stream`, `X-Accel-Buffering: no`
- Heartbeat every 15s
- Listens on `supervisorEvents.on("event", handler)`
- Cleans up on `req.on("close")`

**Active calls route:** `GET /api/voice/supervisor/active-calls`
- Queries DB for `status = "in-progress"` calls
- Merges with `getActiveSessions()` in-memory map (sessions not yet in DB)
- Returns calls with their messages (transcripts)

---

## 8. TWILIO WEBHOOK FLOW

```
Inbound call → Twilio dials your Twilio number
  → POST /api/voice/stream-inbound (your server)
  → Returns TwiML: <Connect><Stream url="wss://...domain/api/voice/stream" />
  → Twilio opens WebSocket to /api/voice/stream
  → Real-time bidirectional audio begins
  → On call end → POST /api/voice/status
```

**Twilio console setup:**
1. Phone Number → Voice → "A call comes in" → Webhook → `POST https://your-domain/api/voice/stream-inbound`
2. Status Callback URL → `https://your-domain/api/voice/status`
3. Enable "Media Streams" on the phone number

**Outbound calls:**
- Use Twilio REST API to initiate call with `url` pointing to `/api/voice/outbound-stream-twiml`
- Returns same Connect/Stream TwiML for AI to handle the outbound call

---

## 9. FRONTEND — PACKAGES

```json
{
  "devDependencies": {
    "@clerk/react": "^6.5.0",
    "@clerk/themes": "^2.4.57",
    "@hookform/resolvers": "^3.10.0",
    "@radix-ui/react-*": "latest",
    "@tailwindcss/vite": "catalog:",
    "@tanstack/react-query": "catalog:",
    "@vitejs/plugin-react": "catalog:",
    "class-variance-authority": "catalog:",
    "clsx": "catalog:",
    "cmdk": "^1.1.1",
    "date-fns": "^3.6.0",
    "framer-motion": "catalog:",
    "lucide-react": "catalog:",
    "next-themes": "^0.4.6",
    "react": "catalog:",
    "react-dom": "catalog:",
    "react-hook-form": "^7.55.0",
    "react-icons": "^5.4.0",
    "recharts": "^2.15.2",
    "sonner": "^2.0.7",
    "tailwind-merge": "catalog:",
    "tailwindcss": "catalog:",
    "tw-animate-css": "^1.4.0",
    "vaul": "^1.1.2",
    "wouter": "^3.3.5",
    "zod": "catalog:"
  }
}
```

---

## 10. FRONTEND PAGES (all auth-protected via Clerk)

| Page | Route | Lines | Key Features |
|---|---|---|---|
| **Dashboard** | `/` | 411 | Call volume charts (7/30/90d), missed calls badge, avg duration, quality score, sentiment pie, hourly heatmap (Recharts) |
| **Call Logs** | `/calls` | 250 | Paginated table, search, filter by outcome/sentiment/date, missed badge, CSV export |
| **Call Detail** | `/calls/:id` | 419 | Full transcript with speaker labels, recording playback, sentiment per turn, AI summary, outcome tag |
| **Appointments** | `/appointments` | 500 | AI-extracted from calls, status management (pending/confirmed/cancelled), reminder tracking |
| **Outbound** | `/outbound` | 646 | Campaign management, contact upload (CSV), dial status, live progress, place single calls |
| **Integrations** | `/integrations` | 552 | EHR/CRM/calendar webhook connectors, test webhooks |
| **Configure** | `/configure` | 613 | Business template picker (Medical/Dental/Legal/General/Salon/Restaurant), greeting editor, hours per day, services, FAQ builder, IVR menu, A/B testing, voice selector (nova/alloy/echo/fable/onyx/shimmer) |
| **Settings** | `/settings` | 355 | Twilio credentials form, copy webhook URLs (stream + status), step-by-step setup guide |
| **Live Monitor** | `/supervisor` | 406 | SSE-powered real-time view, animated pulse per active call, live duration timer, color-coded transcript (user=blue, AI=green, system=gray), auto-scroll |
| **Locations** | `/locations` | 268 | Multi-location CRUD, each with own config + phone number |
| **Usage & Cost** | `/usage` | 211 | Monthly Twilio + OpenAI cost breakdown, minute/token consumption |
| **Reports** | `/reports` | 266 | Exportable analytics, outcome summaries, sentiment trends |
| **DNC List** | `/dnc` | 251 | Do-Not-Call registry, enforced on outbound, add/remove/search |
| **Audit Logs** | `/audit` | 159 | HIPAA audit trail, all data access + config changes |
| **Trust & Security** | `/trust` | 276 | HIPAA BAA, SOC 2, GDPR DPA, CCPA, TCPA, sub-processors table, system status, security contact |

### Layout / Nav
```
Main nav: Dashboard, Call Logs, Appointments, Outbound, Integrations, Configure, Settings
Enterprise nav (collapsible): Live Monitor, Locations, Usage & Cost, Reports, DNC List, Audit Logs, Trust & Security
Footer: User avatar, email, Sign out button
Mobile: hamburger menu with overlay
```

---

## 11. LANDING PAGE

Dark gradient (`from-slate-900 to-blue-950`), centered layout:
- Mic icon (blue rounded square)
- "VoiceAgent" h1
- "Enterprise AI Front Desk Platform" subtitle
- Description: "AI-powered phone answering for medical, dental, and professional practices. 24/7 scheduling, HIPAA-aware, multi-location, and fully enterprise-ready."
- "Get Started" (blue) + "Sign In" (ghost) buttons
- **6 compliance badges** (pill-shaped, colored):
  - 🟢 HIPAA Compliant (emerald)
  - 🔵 SOC 2 Type II (blue)
  - 🟣 GDPR Ready (violet)
  - 🩵 CCPA Compliant (sky)
  - ⚫ 256-bit Encryption (slate)
  - 🟡 ISO 27001 (amber)
- "Enterprise-grade security & compliance" footnote

---

## 12. AUTH SETUP (Clerk)

- Clerk app name: **VoiceAgent** (NOT "Intent Engine")
- Routes: `/sign-in/*?`, `/sign-up/*?`
- Google OAuth enabled
- Theme: shadcn, colorPrimary `#2563eb`
- All dashboard routes wrapped in `<Show when="signed-in">` + redirect to `/sign-in` when signed out

---

## 13. OUTCOME CLASSIFICATIONS

Calls are auto-classified by GPT on completion into one of:
`appointment_booked` | `inquiry_handled` | `complaint` | `transfer_requested` | `wrong_number` | `callback_requested` | `resolved` | `no_answer`

---

## 14. QUALITY SCORING

After each call, GPT scores 1–5 considering:
- Issue resolution
- Caller satisfaction indicators
- Efficiency
- Accuracy
- Flags: `long_silence`, `caller_frustrated`, `unresolved_issue`

---

## 15. MULTI-LANGUAGE SUPPORT

Twilio Polly voices mapped per language:
```
en-US → Polly.Joanna-Neural
en-GB → Polly.Amy-Neural
es-US → Polly.Lupe-Neural
es-ES → Polly.Conchita-Neural
fr-FR → Polly.Lea-Neural
de-DE → Polly.Vicki-Neural
pt-BR → Polly.Camila-Neural
it-IT → Polly.Bianca-Neural
ja-JP → Polly.Takumi-Neural
ko-KR → Polly.Seoyeon-Neural
```
(Used for legacy Gather TwiML fallback. Stream/WebSocket path uses OpenAI TTS voices.)

---

## 16. AFTER-HOURS HANDLING

If call arrives outside configured business hours (checked via `Intl.DateTimeFormat` with timezone):
- Plays hours summary message
- Records voicemail (up to 120s)
- SMS notification to supervisorPhone if configured
- Recording URL saved to call record

---

## 17. IVR MENU (optional)

Configurable DTMF menu per location:
- Each option: `digit`, `label`, `action` (`ai` | `transfer` | `voicemail`), optional `transferTo`, optional `prompt`
- Handled at `/api/voice/ivr-select`

---

## 18. REMINDER SYSTEM

`startReminderScheduler()` runs on server start:
- Checks appointments with `status = "pending"` and `requestedDate` within next 24h
- Sends SMS reminder via Twilio if `twilioPhoneNumber` + `twilioAuthToken` configured
- Marks `reminderSentAt` to prevent duplicate sends

---

## 19. GITHUB REPO

Push to: `https://github.com/aria-agentworks/Voice-Agent`
Token secret name: `GITHUB_PERSONAL_ACCESS_TOKEN`

```bash
git push "https://${GITHUB_PERSONAL_ACCESS_TOKEN}@github.com/aria-agentworks/Voice-Agent.git" HEAD:main
```

---

## 20. DEPLOYMENT CONFIG

**API server artifact.toml:**
```toml
kind = "api"
deploymentTarget = "vm"    # REQUIRED — WebSocket sessions are in-memory

[[services]]
localPort = 8080
paths = ["/api"]

[services.production.build]
args = ["pnpm", "--filter", "@workspace/api-server", "run", "build"]

[services.production.run]
args = ["node", "--enable-source-maps", "artifacts/api-server/dist/index.mjs"]

[services.production.run.env]
PORT = "8080"
NODE_ENV = "production"

[services.production.health.startup]
path = "/api/healthz"
```

**Voice Agent artifact.toml:**
```toml
kind = "web"
previewPath = "/voice-agent/"
serve = "static"
publicDir = "artifacts/voice-agent/dist/public"

[[services.production.rewrites]]
from = "/*"
to = "/index.html"
```
