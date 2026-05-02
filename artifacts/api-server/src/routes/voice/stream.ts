// ── Twilio Media Streams WebSocket Handler ────────────────────────────────────
// This is the real-time audio brain:
//   Twilio sends mu-law 8kHz audio → VAD detects utterances →
//   Whisper STT → GPT (with tools) → OpenAI TTS → mu-law → back to Twilio.

import type { IncomingMessage } from "http";
import type { WebSocket as WsSocket } from "ws";
import { WebSocketServer } from "ws";
import { db } from "@workspace/db";
import { voiceCalls, voiceMessages, voiceConfigs, voiceAppointments } from "@workspace/db";
import { eq, ilike } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { logger as rootLogger } from "../../lib/logger.js";
import { supervisorEvents } from "../../lib/supervisorEvents.js";
import { generateVoiceResponseWithFunctions } from "./gpt.js";
import { ulawToLinear, linearToUlaw, resample, wrapInWav } from "./mulaw.js";
import { VAD } from "./vad.js";

// TTS sample rate from OpenAI (pcm format = 24kHz)
const TTS_SAMPLE_RATE = 24000;
const TWILIO_SAMPLE_RATE = 8000;
// Chunk size for sending audio back: 20ms at 8kHz = 160 samples
const SEND_CHUNK_BYTES = 160;

// ── Live session registry (for supervisor monitor) ───────────────────────────

export interface LiveSessionMeta {
  callSid: string;
  callDbId: string | null;
  fromNumber: string;
  toNumber: string;
  direction: string;
  startedAt: string;
  businessName: string;
}

const liveSessionMap = new Map<string, LiveSessionMeta>();

export function getActiveSessions(): LiveSessionMeta[] {
  return Array.from(liveSessionMap.values());
}

type Config = typeof voiceConfigs.$inferSelect;

interface Session {
  callSid: string;
  streamSid: string;
  callDbId: string | null;
  config: Config | null;
  vad: VAD;
  processing: boolean;  // prevent overlapping STT/GPT/TTS calls
  done: boolean;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function sendMedia(ws: WsSocket, streamSid: string, ulawBuf: Buffer) {
  if (ws.readyState !== 1 /* OPEN */) return;
  // Split into 20ms chunks so Twilio's jitter buffer stays happy
  for (let offset = 0; offset < ulawBuf.length; offset += SEND_CHUNK_BYTES) {
    const chunk = ulawBuf.subarray(offset, offset + SEND_CHUNK_BYTES);
    ws.send(JSON.stringify({
      event: "media",
      streamSid,
      media: { payload: chunk.toString("base64") },
    }));
  }
}

function sendClear(ws: WsSocket, streamSid: string) {
  if (ws.readyState !== 1) return;
  ws.send(JSON.stringify({ event: "clear", streamSid }));
}

async function transcribe(pcm8k: Int16Array): Promise<string> {
  const wav = wrapInWav(pcm8k, TWILIO_SAMPLE_RATE);
  const file = new File([wav], "audio.wav", { type: "audio/wav" });
  const result = await openai.audio.transcriptions.create({
    model: "whisper-1",
    file,
    language: "en",
  });
  return result.text.trim();
}

async function textToUlaw(text: string, voice = "nova"): Promise<Buffer> {
  const response = await openai.audio.speech.create({
    model: "tts-1",
    voice: voice as "nova" | "alloy" | "echo" | "fable" | "onyx" | "shimmer",
    input: text,
    response_format: "pcm",
  });
  const arrayBuf = await response.arrayBuffer();
  const pcm24k = new Int16Array(arrayBuf);
  const pcm8k = resample(pcm24k, TTS_SAMPLE_RATE, TWILIO_SAMPLE_RATE);
  return linearToUlaw(pcm8k);
}

async function executeToolCall(
  name: string,
  args: Record<string, unknown>,
  session: Session
): Promise<{ response: string; shouldTransfer?: string }> {
  const callDbId = session.callDbId;
  const fromNumber = session.callSid;

  switch (name) {
    case "transfer_to_human": {
      const to = session.config?.transferNumber;
      if (!to) return { response: "I'd like to transfer you but no transfer number is configured. Let me take a message and have someone call you back." };
      if (callDbId) {
        await db.update(voiceCalls)
          .set({ escalatedAt: new Date(), escalatedTo: to })
          .where(eq(voiceCalls.id, callDbId));
        supervisorEvents.emit("event", { type: "escalation", callId: callDbId, callSid: session.callSid, timestamp: new Date().toISOString() });
      }
      return { response: "Please hold while I transfer you to a team member.", shouldTransfer: to };
    }

    case "book_appointment": {
      const { patientName, patientPhone, requestedDate, requestedTime, reason } = args as Record<string, string>;
      if (!patientName) return { response: "I need your name to book the appointment. Could you tell me your name?" };
      if (callDbId) {
        await db.insert(voiceAppointments).values({
          callId: callDbId,
          patientName,
          patientPhone: patientPhone || fromNumber || "",
          requestedDate: requestedDate || "",
          requestedTime: requestedTime || "",
          reason: reason || "",
          status: "pending",
        });
      }
      return { response: `Got it! I've booked an appointment request for ${patientName}${requestedDate ? ` on ${requestedDate}` : ""}${requestedTime ? ` at ${requestedTime}` : ""}. Our staff will confirm soon.` };
    }

    case "check_availability": {
      const { requestedDate, requestedTime } = args as Record<string, string>;
      return {
        response: `We have availability${requestedDate ? ` on ${requestedDate}` : ""}${requestedTime ? ` around ${requestedTime}` : ""}. Available slots include 9 AM, 10:30 AM, 2 PM, and 3:30 PM. Would you like to book one of those?`,
      };
    }

    case "cancel_appointment": {
      const { patientName, requestedDate } = args as Record<string, string>;
      if (callDbId) {
        const existing = await db.query.voiceAppointments.findMany({
          where: ilike(voiceAppointments.patientName, `%${patientName || ""}%`),
          limit: 1,
        });
        if (existing[0]) {
          await db.update(voiceAppointments)
            .set({ status: "cancelled", updatedAt: new Date() })
            .where(eq(voiceAppointments.id, existing[0].id));
          return { response: `I've cancelled the appointment for ${patientName}. Is there anything else I can help you with?` };
        }
      }
      return { response: `I couldn't find an appointment for ${patientName || "that name"}. Could you double-check the name?` };
    }

    case "lookup_patient": {
      const { patientName, patientPhone } = args as Record<string, string>;
      const appts = await db.query.voiceAppointments.findMany({
        where: patientName ? ilike(voiceAppointments.patientName, `%${patientName}%`) : undefined,
        orderBy: (a, { desc }) => [desc(a.createdAt)],
        limit: 1,
      });
      if (!appts.length) return { response: `I don't see a record for ${patientName || "that name"}. Would you like to set up an appointment?` };
      const a = appts[0]!;
      return { response: `I found a record for ${a.patientName}. ${a.requestedDate ? `Next appointment is on ${a.requestedDate}${a.requestedTime ? ` at ${a.requestedTime}` : ""}.` : ""} Status: ${a.status}.` };
    }

    default:
      return { response: "Done! Is there anything else I can help you with?" };
  }
}

// ── Session init ──────────────────────────────────────────────────────────────

async function initSession(
  callSid: string,
  streamSid: string,
  customParams: Record<string, string>
): Promise<Session> {
  const session: Session = {
    callSid,
    streamSid,
    callDbId: null,
    config: null,
    vad: new VAD(),
    processing: false,
    done: false,
  };

  try {
    const call = await db.query.voiceCalls.findFirst({ where: eq(voiceCalls.callSid, callSid) });
    if (call) {
      session.callDbId = call.id;
      const configId = call.configId ?? customParams["configId"];
      session.config = configId
        ? (await db.query.voiceConfigs.findFirst({ where: eq(voiceConfigs.id, configId) })) ?? null
        : null;
    }
    if (!session.config) {
      session.config = await db.query.voiceConfigs.findFirst() ?? null;
    }
  } catch (err) {
    rootLogger.error({ err }, "stream: failed to init session");
  }

  return session;
}

// ── Utterance handler ─────────────────────────────────────────────────────────

async function handleUtterance(ws: WsSocket, session: Session, pcm8k: Int16Array) {
  if (session.processing || session.done) return;
  session.processing = true;

  const log = rootLogger.child({ callSid: session.callSid });

  try {
    // 1. STT — Whisper
    const transcript = await transcribe(pcm8k);
    if (!transcript) {
      session.processing = false;
      return;
    }
    log.info({ transcript }, "stream: STT result");

    // 2. Persist user message
    if (session.callDbId) {
      await db.insert(voiceMessages).values({ callId: session.callDbId, role: "user", content: transcript });
      supervisorEvents.emit("event", {
        type: "message", callId: session.callDbId, callSid: session.callSid,
        role: "user", content: transcript, timestamp: new Date().toISOString(),
      });
    }

    // 3. Load conversation history
    const history = session.callDbId
      ? (await db.query.voiceMessages.findMany({
          where: eq(voiceMessages.callId, session.callDbId),
          orderBy: (m, { asc }) => [asc(m.createdAt)],
          limit: 20,
        })).slice(0, -1).map((m) => ({ role: m.role as "user" | "assistant", content: m.content }))
      : [];

    // 4. GPT — with function tools
    let shouldTransfer: string | undefined;
    const config = session.config;

    const aiText = config
      ? await generateVoiceResponseWithFunctions(
          transcript,
          {
            businessName: config.businessName,
            businessType: config.businessType,
            greeting: config.greeting,
            instructions: config.instructions,
            hoursJson: config.hoursJson,
            servicesJson: config.servicesJson,
            faqJson: config.faqJson,
            scriptJson: config.scriptJson,
            transferNumber: config.transferNumber,
            timezone: config.timezone ?? undefined,
          },
          history,
          async (name, args) => {
            const result = await executeToolCall(name, args, session);
            if (result.shouldTransfer) shouldTransfer = result.shouldTransfer;
            return result.response;
          }
        )
      : "I'm sorry, this service is not configured yet.";

    log.info({ aiText }, "stream: GPT response");

    // 5. Persist AI message
    if (session.callDbId) {
      await db.insert(voiceMessages).values({ callId: session.callDbId, role: "assistant", content: aiText });
      supervisorEvents.emit("event", {
        type: "message", callId: session.callDbId, callSid: session.callSid,
        role: "assistant", content: aiText, timestamp: new Date().toISOString(),
      });
    }

    // 6. Clear any in-flight audio, then TTS
    sendClear(ws, session.streamSid);
    const voice = session.config?.voice ?? "nova";
    const ulawAudio = await textToUlaw(aiText, voice);
    sendMedia(ws, session.streamSid, ulawAudio);

    // 7. If transfer was requested, we just sent the hold message — Twilio will handle dial
    if (shouldTransfer) {
      session.done = true;
    }
  } catch (err) {
    log.error({ err }, "stream: utterance handler error");
    // Send a fallback apology
    try {
      const fallback = await textToUlaw("I'm sorry, I had trouble with that. Could you repeat?");
      sendMedia(ws, session.streamSid, fallback);
    } catch {}
  } finally {
    session.processing = false;
  }
}

// ── Call finalization ─────────────────────────────────────────────────────────

async function finalizeCall(session: Session) {
  if (!session.callDbId) return;
  try {
    const messages = await db.query.voiceMessages.findMany({
      where: eq(voiceMessages.callId, session.callDbId),
      orderBy: (m, { asc }) => [asc(m.createdAt)],
    });
    if (messages.length < 2) return;

    const transcript = messages.map((m) => `${m.role === "user" ? "Caller" : "Agent"}: ${m.content}`).join("\n");

    // Auto-summarize + outcome + quality score in one GPT call
    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 300,
      messages: [
        { role: "system", content: 'Analyze this phone call. Return JSON: {"summary":"one sentence","outcome":"appointment_booked|inquiry_handled|complaint|transfer_requested|wrong_number|callback_requested|resolved|no_answer","score":1-5,"notes":"brief quality note","flags":[]}' },
        { role: "user", content: transcript },
      ],
      response_format: { type: "json_object" },
    });

    const parsed = JSON.parse(resp.choices[0]?.message?.content ?? "{}");
    await db.update(voiceCalls).set({
      status: "completed",
      endedAt: new Date(),
      summary: parsed.summary ?? undefined,
      outcome: parsed.outcome ?? undefined,
      qualityScore: parsed.score ?? undefined,
      qualityNotes: parsed.notes ?? undefined,
      qualityFlags: parsed.flags?.length ? JSON.stringify(parsed.flags) : undefined,
    }).where(eq(voiceCalls.id, session.callDbId));

    supervisorEvents.emit("event", {
      type: "call_end", callId: session.callDbId, callSid: session.callSid, timestamp: new Date().toISOString(),
    });
  } catch (err) {
    rootLogger.error({ err }, "stream: finalization error");
  }
}

// ── WebSocket Server ──────────────────────────────────────────────────────────

export function createMediaStreamWss(): WebSocketServer {
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws: WsSocket, _req: IncomingMessage) => {
    let session: Session | null = null;
    const log = rootLogger.child({ wsConn: "media-stream" });

    ws.on("message", (raw: Buffer) => {
      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      } catch {
        return;
      }

      const event = msg["event"] as string;

      switch (event) {
        case "connected":
          log.info("stream: Twilio Media Stream connected");
          break;

        case "start": {
          const startData = msg["start"] as {
            callSid: string;
            streamSid: string;
            customParameters?: Record<string, string>;
          };
          log.info({ callSid: startData.callSid }, "stream: Media Stream start");
          initSession(startData.callSid, startData.streamSid, startData.customParameters ?? {})
            .then(async (s) => {
              session = s;

              // Register in live session map + emit call_start for supervisor
              const fromNum = startData.customParameters?.["From"] ?? "";
              const toNum = startData.customParameters?.["To"] ?? "";
              const sessionStartedAt = new Date().toISOString();
              liveSessionMap.set(startData.callSid, {
                callSid: startData.callSid,
                callDbId: s.callDbId,
                fromNumber: fromNum,
                toNumber: toNum,
                direction: "inbound",
                startedAt: sessionStartedAt,
                businessName: s.config?.businessName ?? "",
              });
              supervisorEvents.emit("event", {
                type: "call_start",
                callId: s.callDbId ?? startData.callSid,
                callSid: startData.callSid,
                fromNumber: fromNum,
                toNumber: toNum,
                direction: "inbound",
                timestamp: sessionStartedAt,
              });

              // Play the configured greeting as TTS
              if (s.config) {
                const greetingText = s.config.greeting
                  || `Thank you for calling ${s.config.businessName || "us"}. How can I help you today?`;
                try {
                  const audio = await textToUlaw(greetingText, s.config.voice ?? "nova");
                  sendMedia(ws, s.streamSid, audio);
                } catch (greetErr) {
                  log.error({ err: greetErr }, "stream: greeting TTS failed");
                }
              }
            })
            .catch((err) => log.error({ err }, "stream: initSession failed"));
          break;
        }

        case "media": {
          if (!session) break;
          const mediaPayload = (msg["media"] as { payload: string }).payload;
          const ulawBuf = Buffer.from(mediaPayload, "base64");
          const pcm = ulawToLinear(ulawBuf);
          const result = session.vad.addChunk(pcm);
          if (result.complete && result.samples) {
            const captured = result.samples;
            const capturedSession = session;
            // Handle async without blocking message loop
            handleUtterance(ws, capturedSession, captured).catch((err) =>
              log.error({ err }, "stream: handleUtterance uncaught")
            );
          }
          break;
        }

        case "stop":
          log.info("stream: Media Stream stop");
          if (session) {
            liveSessionMap.delete(session.callSid);
            finalizeCall(session).catch((err) => log.error({ err }, "stream: finalizeCall error"));
          }
          session = null;
          break;

        default:
          break;
      }
    });

    ws.on("error", (err) => log.error({ err }, "stream: WebSocket error"));

    ws.on("close", () => {
      if (session) {
        liveSessionMap.delete(session.callSid);
        finalizeCall(session).catch(() => {});
        session = null;
      }
    });
  });

  return wss;
}
