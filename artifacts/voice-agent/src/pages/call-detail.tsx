import { useRoute, Link } from "wouter";
import {
  useGetVoiceCall, getGetVoiceCallQueryKey,
  useSummarizeVoiceCall, useCreateOutboundCall
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, PhoneIncoming, PhoneOutgoing, Clock, MessageSquare,
  User, Bot, Sparkles, Phone, RefreshCw, Mic, Download, Play, Pause,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useRef, useState } from "react";

const API = "/api";

function formatDuration(s: number | null | undefined) {
  if (!s) return "—";
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}m ${sec}s` : `${sec}s`;
}

function formatDateFull(iso: string) {
  return new Date(iso).toLocaleString(undefined, {
    weekday: "short", month: "short", day: "numeric",
    year: "numeric", hour: "numeric", minute: "2-digit",
  });
}

function formatMsgTime(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function formatAudioTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const STATUS_COLORS: Record<string, string> = {
  completed: "bg-emerald-100 text-emerald-700",
  "in-progress": "bg-blue-100 text-blue-700",
  failed: "bg-red-100 text-red-700",
  "no-answer": "bg-amber-100 text-amber-700",
  busy: "bg-amber-100 text-amber-700",
};

const OUTCOME_DISPLAY: Record<string, { label: string; color: string }> = {
  appointment_booked: { label: "Appointment Booked", color: "text-emerald-700 bg-emerald-100 border-emerald-200" },
  inquiry_handled: { label: "Inquiry Handled", color: "text-blue-700 bg-blue-100 border-blue-200" },
  complaint: { label: "Complaint", color: "text-red-700 bg-red-100 border-red-200" },
  transfer_requested: { label: "Transfer Requested", color: "text-violet-700 bg-violet-100 border-violet-200" },
  wrong_number: { label: "Wrong Number", color: "text-gray-600 bg-gray-100 border-gray-200" },
  callback_requested: { label: "Callback Requested", color: "text-amber-700 bg-amber-100 border-amber-200" },
  resolved: { label: "Resolved", color: "text-teal-700 bg-teal-100 border-teal-200" },
  no_answer: { label: "No Answer", color: "text-gray-600 bg-gray-100 border-gray-200" },
};

// ── Audio Player ────────────────────────────────────────────────────────────
function AudioPlayer({ callId }: { callId: string }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const src = `${API}/voice/calls/${callId}/recording`;

  function togglePlay() {
    const audio = audioRef.current;
    if (!audio) return;
    if (playing) {
      audio.pause();
    } else {
      setLoading(true);
      audio.play().catch((e) => {
        setError("Playback failed — recording may still be processing.");
        setLoading(false);
      });
    }
  }

  function handleSeek(e: React.ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current;
    if (!audio) return;
    const t = parseFloat(e.target.value);
    audio.currentTime = t;
    setCurrentTime(t);
  }

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => { setPlaying(true); setLoading(false); setError(null); }}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setCurrentTime(0); }}
        onTimeUpdate={(e) => setCurrentTime((e.target as HTMLAudioElement).currentTime)}
        onLoadedMetadata={(e) => setDuration((e.target as HTMLAudioElement).duration)}
        onError={() => { setError("Recording unavailable or still processing."); setLoading(false); }}
        onWaiting={() => setLoading(true)}
        onCanPlay={() => setLoading(false)}
      />
      <button
        onClick={togglePlay}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
        disabled={!!error}
      >
        {loading
          ? <RefreshCw className="h-4 w-4 animate-spin" />
          : playing
            ? <Pause className="h-4 w-4" />
            : <Play className="h-4 w-4 ml-0.5" />
        }
      </button>

      <div className="flex-1 min-w-0 space-y-1">
        {error ? (
          <p className="text-xs text-red-500">{error}</p>
        ) : (
          <>
            <input
              type="range"
              min={0}
              max={duration || 100}
              value={currentTime}
              step={0.1}
              onChange={handleSeek}
              className="w-full h-1.5 appearance-none rounded-full cursor-pointer accent-primary"
              style={{
                background: `linear-gradient(to right, hsl(var(--primary)) ${pct}%, hsl(var(--muted)) ${pct}%)`,
              }}
            />
            <div className="flex justify-between text-[10px] text-muted-foreground">
              <span>{formatAudioTime(currentTime)}</span>
              <span>{duration > 0 ? formatAudioTime(duration) : "--:--"}</span>
            </div>
          </>
        )}
      </div>

      <a
        href={src}
        download={`call-recording-${callId}.mp3`}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
        title="Download recording"
      >
        <Download className="h-4 w-4" />
      </a>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function CallDetail() {
  const [, params] = useRoute("/calls/:id");
  const id = params?.id ?? "";
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data, isLoading, refetch } = useGetVoiceCall(id, {
    query: { enabled: !!id, queryKey: getGetVoiceCallQueryKey(id) },
  });

  const summarizeMutation = useSummarizeVoiceCall();
  const callbackMutation = useCreateOutboundCall();

  const call = data?.call as (typeof data)["call"] & { recordingUrl?: string | null; recordingSid?: string | null } | undefined;
  const messages = data?.messages ?? [];

  const handleSummarize = () => {
    summarizeMutation.mutate(
      { id },
      {
        onSuccess: () => {
          refetch();
          queryClient.invalidateQueries({ queryKey: ["getVoiceCalls"] });
          toast({ title: "Summary generated", description: "AI summary and outcome classification complete." });
        },
        onError: () => toast({ title: "Failed", description: "Could not generate summary.", variant: "destructive" }),
      }
    );
  };

  const handleCallback = () => {
    if (!call) return;
    const number = call.direction === "inbound" ? call.fromNumber : call.toNumber;
    callbackMutation.mutate(
      { toNumber: number, purpose: "Follow-up callback" },
      {
        onSuccess: () => toast({ title: "Call initiated", description: `Calling ${number}` }),
        onError: () => toast({ title: "Failed", description: "Check Twilio credentials in Settings.", variant: "destructive" }),
      }
    );
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-5">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-36 w-full" />
        <div className="space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className={cn("h-12", i % 2 === 0 ? "w-3/4" : "w-2/3 ml-auto")} />
          ))}
        </div>
      </div>
    );
  }

  if (!call) {
    return (
      <div className="p-6 max-w-4xl mx-auto">
        <Link href="/calls">
          <Button variant="ghost" size="sm" className="mb-4"><ArrowLeft className="h-4 w-4 mr-1.5" /> Back to calls</Button>
        </Link>
        <p className="text-muted-foreground">Call not found.</p>
      </div>
    );
  }

  const callNumber = call.direction === "inbound" ? call.fromNumber : call.toNumber;
  const outcomeInfo = call.outcome ? OUTCOME_DISPLAY[call.outcome] : null;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/calls">
            <Button variant="ghost" size="sm"><ArrowLeft className="h-4 w-4 mr-1.5" /> Back</Button>
          </Link>
          <h1 className="text-xl font-semibold">Call Detail</h1>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline" size="sm"
            onClick={handleCallback}
            disabled={callbackMutation.isPending}
            className="gap-1.5"
          >
            <Phone className="h-3.5 w-3.5" /> Call Back
          </Button>
          <Button
            variant="outline" size="sm"
            onClick={handleSummarize}
            disabled={summarizeMutation.isPending || !messages.length}
            className="gap-1.5"
          >
            {summarizeMutation.isPending
              ? <><RefreshCw className="h-3.5 w-3.5 animate-spin" /> Analyzing...</>
              : <><Sparkles className="h-3.5 w-3.5" /> {call.summary ? "Re-summarize" : "Summarize"}</>}
          </Button>
        </div>
      </div>

      {/* Call metadata */}
      <Card>
        <CardContent className="p-5">
          <div className="flex items-start gap-4 flex-wrap">
            <div className={cn("rounded-full p-3 shrink-0", call.direction === "inbound" ? "bg-blue-100 text-blue-600" : "bg-violet-100 text-violet-600")}>
              {call.direction === "inbound" ? <PhoneIncoming className="h-5 w-5" /> : <PhoneOutgoing className="h-5 w-5" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-lg font-semibold">{callNumber}</span>
                <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium", STATUS_COLORS[call.status] ?? "bg-muted text-muted-foreground")}>
                  {call.status}
                </span>
                {outcomeInfo && (
                  <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", outcomeInfo.color)}>
                    {outcomeInfo.label}
                  </span>
                )}
                {call.recordingUrl && (
                  <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium bg-violet-50 border-violet-200 text-violet-700">
                    <Mic className="h-2.5 w-2.5" /> Recorded
                  </span>
                )}
              </div>
              <p className="text-sm text-muted-foreground mt-0.5">{formatDateFull(call.startedAt)}</p>
            </div>
            <div className="flex gap-6 shrink-0 text-sm">
              <div className="text-center">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Clock className="h-3.5 w-3.5" />
                  <span className="text-xs uppercase tracking-wide font-medium">Duration</span>
                </div>
                <p className="font-semibold mt-0.5">{formatDuration(call.durationSeconds)}</p>
              </div>
              <div className="text-center">
                <div className="flex items-center gap-1 text-muted-foreground">
                  <MessageSquare className="h-3.5 w-3.5" />
                  <span className="text-xs uppercase tracking-wide font-medium">Turns</span>
                </div>
                <p className="font-semibold mt-0.5">{call.messageCount}</p>
              </div>
            </div>
          </div>

          {call.summary && (
            <div className="mt-4 pt-4 border-t border-border flex items-start gap-2">
              <Sparkles className="h-4 w-4 text-primary mt-0.5 shrink-0" />
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">AI Summary</p>
                <p className="text-sm text-foreground leading-relaxed">{call.summary}</p>
              </div>
            </div>
          )}

          {!call.summary && messages.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <button
                onClick={handleSummarize}
                disabled={summarizeMutation.isPending}
                className="flex items-center gap-2 text-sm text-primary hover:underline disabled:opacity-50"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {summarizeMutation.isPending ? "Generating summary..." : "Generate AI summary"}
              </button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recording player */}
      {call.recordingUrl && (
        <Card>
          <CardHeader className="pb-3 px-5 pt-4">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Mic className="h-4 w-4 text-violet-600" /> Call Recording
            </CardTitle>
          </CardHeader>
          <CardContent className="px-5 pb-5 pt-0">
            <AudioPlayer callId={call.id} />
          </CardContent>
        </Card>
      )}

      {/* Transcript */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            Transcript
            {messages.length > 0 && (
              <span className="text-xs font-normal text-muted-foreground">{messages.length} messages</span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {!messages.length ? (
            <p className="text-sm text-muted-foreground text-center py-8">No transcript available</p>
          ) : (
            <div className="space-y-4">
              {messages.map((msg) => {
                const isAssistant = msg.role === "assistant";
                return (
                  <div key={msg.id} className={cn("flex gap-3", isAssistant ? "flex-row" : "flex-row-reverse")}>
                    <div className={cn(
                      "h-7 w-7 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                      isAssistant ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    )}>
                      {isAssistant ? <Bot className="h-3.5 w-3.5" /> : <User className="h-3.5 w-3.5" />}
                    </div>
                    <div className={cn("max-w-[75%]", !isAssistant && "items-end flex flex-col")}>
                      <div className={cn(
                        "rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                        isAssistant ? "bg-muted text-foreground rounded-tl-sm" : "bg-primary text-primary-foreground rounded-tr-sm"
                      )}>
                        {msg.content}
                      </div>
                      <p className={cn("text-xs text-muted-foreground mt-1", isAssistant ? "text-left" : "text-right")}>
                        {isAssistant ? "AI Agent" : "Caller"} · {formatMsgTime(msg.createdAt)}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Technical details */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-semibold text-muted-foreground">Technical Details</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
            {[
              { label: "Call SID", value: call.callSid },
              { label: "Direction", value: call.direction },
              { label: "From", value: call.fromNumber },
              { label: "To", value: call.toNumber },
              { label: "Started", value: formatDateFull(call.startedAt) },
              call.endedAt ? { label: "Ended", value: formatDateFull(call.endedAt) } : null,
              call.recordingSid ? { label: "Recording SID", value: call.recordingSid } : null,
            ].filter(Boolean).map((item) => (
              <div key={item!.label}>
                <dt className="text-muted-foreground">{item!.label}</dt>
                <dd className="font-mono text-xs mt-0.5 text-foreground break-all">{item!.value}</dd>
              </div>
            ))}
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
