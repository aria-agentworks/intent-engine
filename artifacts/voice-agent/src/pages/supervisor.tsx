import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Monitor, User, Bot, Activity, AlertTriangle, Clock, Phone, Wifi, WifiOff } from "lucide-react";
import { cn } from "@/lib/utils";

interface LiveMessage {
  role: "user" | "assistant";
  content: string;
  timestamp: string;
}

interface ActiveCall {
  id: string;
  callSid: string;
  fromNumber: string;
  toNumber: string;
  direction: string;
  startedAt: string;
  language: string;
  escalatedAt?: string | null;
  messages: LiveMessage[];
}

interface SSEEvent {
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

function useLiveDuration(startedAt: string): string {
  const [elapsed, setElapsed] = useState(() =>
    Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)
  );
  useEffect(() => {
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [startedAt]);
  const m = Math.floor(elapsed / 60);
  const s = elapsed % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function CallDuration({ startedAt }: { startedAt: string }) {
  const dur = useLiveDuration(startedAt);
  return (
    <span className="inline-flex items-center gap-1 font-mono text-xs tabular-nums text-muted-foreground">
      <Clock className="h-3 w-3" />
      {dur}
    </span>
  );
}

function formatPhone(p: string) {
  return p.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3") || p || "Unknown";
}

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString([], {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function CallCard({ call }: { call: ActiveCall }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  const isEscalated = !!call.escalatedAt;

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [call.messages.length]);

  return (
    <Card className={cn(
      "transition-colors",
      isEscalated ? "border-amber-400 bg-amber-50/30" : "border-border",
    )}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold truncate flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                {call.direction === "inbound" ? "From" : "To"}{" "}
                <span className="font-mono">{formatPhone(call.fromNumber)}</span>
              </p>
              {call.toNumber && (
                <p className="text-xs text-muted-foreground font-mono truncate pl-5">
                  → {formatPhone(call.toNumber)}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            {isEscalated && (
              <Badge variant="outline" className="border-amber-400 text-amber-700 text-[10px] gap-1">
                <AlertTriangle className="h-3 w-3" /> Escalated
              </Badge>
            )}
            <Badge variant="secondary" className="text-[10px] uppercase">{call.direction}</Badge>
          </div>
        </div>
        <div className="flex items-center gap-3 pl-5 mt-0.5">
          <CallDuration startedAt={call.startedAt} />
          <span className="text-xs text-muted-foreground">
            Started {formatTime(call.startedAt)}
          </span>
          <span className="text-xs text-muted-foreground">
            {call.messages.length} turns
          </span>
        </div>
      </CardHeader>

      <CardContent className="pt-0">
        <ScrollArea className="h-56 rounded-md border bg-slate-50/60">
          <div className="p-3 space-y-2.5">
            {call.messages.length === 0 ? (
              <p className="text-xs text-muted-foreground italic text-center py-4">
                Waiting for speech…
              </p>
            ) : (
              call.messages.map((m, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex gap-2 text-xs",
                    m.role === "assistant" && "flex-row-reverse",
                  )}
                >
                  <div className={cn(
                    "flex h-5 w-5 shrink-0 items-center justify-center rounded-full mt-0.5",
                    m.role === "user"
                      ? "bg-blue-100 text-blue-700"
                      : "bg-violet-100 text-violet-700",
                  )}>
                    {m.role === "user"
                      ? <User className="h-3 w-3" />
                      : <Bot className="h-3 w-3" />}
                  </div>
                  <div className="flex flex-col gap-0.5 max-w-[82%]">
                    <div className={cn(
                      "rounded-lg px-2.5 py-1.5 leading-snug",
                      m.role === "user"
                        ? "bg-white border border-slate-200 text-slate-700"
                        : "bg-violet-50 border border-violet-100 text-violet-900",
                    )}>
                      {m.content}
                    </div>
                    <span className={cn(
                      "text-[10px] text-muted-foreground/70 px-1",
                      m.role === "assistant" && "text-right",
                    )}>
                      {formatTime(m.timestamp)}
                    </span>
                  </div>
                </div>
              ))
            )}
            <div ref={bottomRef} />
          </div>
        </ScrollArea>
      </CardContent>
    </Card>
  );
}

export default function Supervisor() {
  const [liveCalls, setLiveCalls] = useState<Map<string, ActiveCall>>(new Map());
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [eventLog, setEventLog] = useState<SSEEvent[]>([]);
  const esRef = useRef<EventSource | null>(null);

  const { data: snapshot } = useQuery<ActiveCall[]>({
    queryKey: ["supervisor", "active-calls"],
    queryFn: async () => {
      const r = await fetch("/api/voice/supervisor/active-calls");
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (snapshot) {
      setLiveCalls((prev) => {
        const map = new Map(prev);
        for (const call of snapshot) {
          const existing = map.get(call.id);
          map.set(call.id, {
            ...call,
            // Preserve SSE-pushed messages if we have more of them
            messages: (existing?.messages.length ?? 0) > (call.messages?.length ?? 0)
              ? existing!.messages
              : (call.messages ?? []),
          });
        }
        // Remove stale calls that disappeared from snapshot (not in SSE either)
        return map;
      });
    }
  }, [snapshot]);

  useEffect(() => {
    const es = new EventSource("/api/voice/supervisor/live");
    esRef.current = es;

    es.onopen = () => setConnectionStatus("connected");
    es.onerror = () => setConnectionStatus("error");

    es.onmessage = (e) => {
      try {
        const event: SSEEvent = JSON.parse(e.data as string);
        setEventLog((prev) => [event, ...prev].slice(0, 150));

        setLiveCalls((prev) => {
          const map = new Map(prev);

          if (event.type === "call_start") {
            if (!map.has(event.callId)) {
              map.set(event.callId, {
                id: event.callId,
                callSid: event.callSid,
                fromNumber: event.fromNumber ?? "",
                toNumber: event.toNumber ?? "",
                direction: event.direction ?? "inbound",
                startedAt: event.timestamp,
                language: "en-US",
                messages: [],
              });
            }
          } else if (event.type === "call_end") {
            map.delete(event.callId);
          } else if (event.type === "message") {
            const call = map.get(event.callId);
            if (call) {
              map.set(event.callId, {
                ...call,
                messages: [
                  ...call.messages,
                  { role: event.role!, content: event.content!, timestamp: event.timestamp },
                ].slice(-60),
              });
            }
          } else if (event.type === "escalation") {
            const call = map.get(event.callId);
            if (call) map.set(event.callId, { ...call, escalatedAt: event.timestamp });
          }

          return map;
        });
      } catch {}
    };

    return () => {
      es.close();
      esRef.current = null;
    };
  }, []);

  const calls = Array.from(liveCalls.values()).sort(
    (a, b) => new Date(a.startedAt).getTime() - new Date(b.startedAt).getTime()
  );
  const escalatedCount = calls.filter((c) => c.escalatedAt).length;

  return (
    <div className="p-6 space-y-5 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <Monitor className="h-5 w-5 text-primary" />
            Live Call Monitor
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Real-time transcripts of active AI calls
          </p>
        </div>

        <div className="flex items-center gap-2">
          {escalatedCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 border border-amber-200 px-2.5 py-1 text-xs font-medium text-amber-700">
              <AlertTriangle className="h-3 w-3" />
              {escalatedCount} escalated
            </span>
          )}
          <span className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium border",
            connectionStatus === "connected" && "bg-emerald-50 text-emerald-700 border-emerald-200",
            connectionStatus === "connecting" && "bg-amber-50 text-amber-700 border-amber-200",
            connectionStatus === "error" && "bg-red-50 text-red-700 border-red-200",
          )}>
            {connectionStatus === "connected"
              ? <Wifi className="h-3 w-3" />
              : <WifiOff className="h-3 w-3" />}
            {connectionStatus === "connected" ? "Live" : connectionStatus === "connecting" ? "Connecting…" : "Disconnected"}
          </span>
          <Badge variant="outline" className="text-xs">
            {calls.length} active {calls.length === 1 ? "call" : "calls"}
          </Badge>
        </div>
      </div>

      {/* Active call cards */}
      {calls.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <Activity className="h-6 w-6 text-muted-foreground/50" />
            </div>
            <div>
              <p className="font-medium text-muted-foreground">No active calls</p>
              <p className="text-xs text-muted-foreground/70 mt-1 max-w-xs">
                When calls arrive, live transcripts will appear here in real time
              </p>
            </div>
            {connectionStatus === "error" && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-3 py-1.5">
                SSE connection lost — refresh to reconnect
              </p>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className={cn(
          "grid gap-4",
          calls.length === 1 ? "grid-cols-1 max-w-2xl" : "grid-cols-1 md:grid-cols-2",
        )}>
          {calls.map((call) => (
            <CallCard key={call.id} call={call} />
          ))}
        </div>
      )}

      {/* Event log */}
      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Event Log</CardTitle>
            {eventLog.length > 0 && (
              <span className="text-xs text-muted-foreground">{eventLog.length} events</span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-44 rounded-md border bg-slate-50/50">
            <div className="p-2 space-y-0.5">
              {eventLog.length === 0 ? (
                <p className="text-xs text-muted-foreground italic p-2">No events yet</p>
              ) : (
                eventLog.map((e, i) => (
                  <div
                    key={i}
                    className={cn(
                      "flex items-start gap-2 text-xs px-2 py-1 rounded",
                      e.type === "escalation" && "bg-amber-50",
                      e.type === "call_start" && "bg-emerald-50",
                      e.type === "call_end" && "bg-slate-100",
                    )}
                  >
                    <span className="font-mono shrink-0 text-muted-foreground tabular-nums">
                      {formatTime(e.timestamp)}
                    </span>
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-[10px] shrink-0 px-1.5",
                        e.type === "call_start" && "border-emerald-300 text-emerald-700",
                        e.type === "call_end" && "border-slate-300 text-slate-600",
                        e.type === "escalation" && "border-amber-300 text-amber-700",
                        e.type === "message" && "border-violet-200 text-violet-600",
                      )}
                    >
                      {e.type}
                    </Badge>
                    <span className="truncate text-muted-foreground">
                      {e.type === "message"
                        ? `${e.role === "user" ? "Caller" : "Agent"}: ${e.content?.slice(0, 80)}${(e.content?.length ?? 0) > 80 ? "…" : ""}`
                        : e.type === "call_start"
                          ? `Call started — ${e.fromNumber ? formatPhone(e.fromNumber) : e.callSid.slice(-6)}`
                          : e.type === "escalation"
                            ? `Escalated — call ${e.callSid.slice(-6)}`
                            : `Call ended — ${e.callSid.slice(-6)}`}
                    </span>
                  </div>
                ))
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
