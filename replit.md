# Aria AgentWorks — Workspace

## Overview

pnpm workspace monorepo using TypeScript. Two products:
1. **Intent Engine** — Lead generation tool that scrapes multiple platforms for buying-intent signals, scores them with configurable keywords, and generates outreach responses.
2. **Voice Agent** — Enterprise AI voice agent for medical/dental/business front desks. Twilio telephony + GPT-5-mini intelligence + OpenAI TTS.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec → `lib/api-spec/openapi.yaml`)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + wouter + TanStack Query + shadcn/ui

## Artifacts

| Path | Kind | Description |
|------|------|-------------|
| `artifacts/api-server` | api | Express 5 REST API, port 8080, path `/api` |
| `artifacts/intent-engine` | web | Intent Engine React+Vite frontend, path `/` |
| `artifacts/voice-agent` | web | Voice Agent React+Vite frontend, path `/voice-agent` |

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec (run after any spec change)
- `pnpm --filter @workspace/db run push-force` — push DB schema changes (dev)
- `pnpm --filter @workspace/api-server run build` — build API server

## Database Schema

Tables in `lib/db/src/schema/`:

### Intent Engine
- `saved_leads` — bookmarked leads with `status` (new/contacted/following_up/closed)
- `keywords` — intent keywords with phrase, score (1-10), category, enabled flag

### Voice Agent
- `voice_configs` — single-row business configuration (name, type, greeting, instructions, hours, services, voice, Twilio credentials)
- `voice_calls` — call log with SID, direction, status, duration, outcome, summary
- `voice_messages` — per-call transcript messages (role: user|assistant, content, audioReady flag)

## Voice Agent Architecture

### Real-time WebSocket call flow (primary, Whisper + GPT + OpenAI TTS)
```
Twilio inbound call
  → POST /api/voice/stream-inbound  (returns TwiML <Connect><Stream>)
  → WS upgrade /api/voice/stream    (Twilio Media Streams WebSocket)
  → mulaw decode → VAD (energy-based, 800ms silence) → 8kHz PCM buffer
  → Whisper-1 STT (WAV file)
  → GPT-4o-mini with system prompt + tool calls (book_appointment, transfer_call, etc.)
  → OpenAI TTS (PCM 24kHz) → resample to 8kHz → mulaw encode → Twilio stream
```

### Legacy Gather-based flow (backward compatible, kept intact)
```
POST /api/voice/inbound → <Gather> STT → POST /api/voice/gather → GPT → TTS → <Play>
```

**Key source files** (`artifacts/api-server/src/routes/voice/`):
- `stream.ts` — WebSocket brain: Twilio ↔ Whisper ↔ GPT ↔ TTS pipeline
- `mulaw.ts` — G.711 mulaw codec + WAV wrapper + 24kHz→8kHz resampler (no ffmpeg)
- `vad.ts` — energy-based VAD, 20ms frames, 800ms silence detection
- `gpt.ts` — `generateVoiceResponseWithFunctions()` with tool call support
- `config.ts` — GET/PUT `/voice/config`, returns `webhookUrl` + `streamWebhookUrl` + `statusCallbackUrl`
- `twilio.ts` — all TwiML routes (stream-inbound, inbound, gather, outbound, status)
- `calls.ts` — call log CRUD, stats, TTS proxy
- `locations.ts` — multi-location CRUD for voiceConfigs
- `appointments.ts`, `campaigns.ts`, `dnc.ts`, `integrations.ts` — feature routes

**WebSocket endpoint**: `ws://<host>/api/voice/stream` — HTTP upgrade handled in `index.ts`

**Business templates**: medical, dental, legal, restaurant, salon, general — each has preset greeting and instructions

**DB tables**: `voice_configs` (multi-row, one per location), `voice_calls`, `voice_messages`, `voice_users`, `voice_appointments`, `voice_campaigns`, `voice_campaign_contacts`, `voice_dnc`, `voice_usage_events`

## Important Patterns

- **Route registration order matters** — specific routes (`/voice/calls/stats`) before parameterized ones (`/voice/calls/:id`)
- **Codegen naming** — request body schemas use `CreateXInput` naming in OpenAPI; Orval generates mutation body Zod schema as `CreateXBody`
- **Scorer cache** — `lib/scorer.ts` caches active keywords for 60s; call `invalidateScorerCache()` after keyword changes
- **Lead cache** — `routes/leads.ts` caches all-source results for 5 min; `POST /leads/refresh` force-invalidates
- **Twilio auth token** — always masked as `••••••••` in API responses; only updated when a new non-masked value is submitted
- **Stream webhook** — dynamically computed from request headers; `streamWebhookUrl` = `${proto}://${host}/api/voice/stream-inbound`
- **OpenAI TTS format** — `response_format: "pcm"` = raw 16-bit LE PCM at 24kHz; resample to 8kHz mulaw for Twilio
- **Greeting** — played immediately on WebSocket connect using TTS before caller speaks
- **VAD silence threshold** — 800ms of silence triggers STT; tunable in `vad.ts`

## Voice Agent Setup (for users)

1. Go to **Configure** — pick business type template, fill in name, greeting, instructions, hours
2. Go to **Settings** — enter Twilio Account SID, Auth Token, phone number, enable agent
3. Copy the **Real-time AI** webhook URL from Settings → paste into Twilio console as the phone number's Voice webhook (HTTP POST)
4. Copy the **Status Callback** URL → paste into Twilio's Call Status Changes field
5. Use **Outbound** to place outbound AI calls

## Lead Sources (Intent Engine)

| Source | File | Status | Notes |
|--------|------|--------|-------|
| Reddit | `lib/sources/../reddit.ts` | Active (fallback to examples when 403) | Searches r/entrepreneur, r/startups, etc. |
| Hacker News | `lib/sources/hacker-news.ts` | Active (live via Algolia API) | No auth required |
| X / Twitter | `lib/sources/twitter.ts` | Inactive until `TWITTER_BEARER_TOKEN` env var is set | Twitter API v2 |
