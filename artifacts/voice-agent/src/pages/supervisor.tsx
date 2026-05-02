import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Monitor, Phone, User, Bot, Activity, AlertTriangle } from "lucide-react";
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

export default function Supervisor() {
  const [liveCalls, setLiveCalls] = useState<Map<string, ActiveCall>>(new Map());
  const [connectionStatus, setConnectionStatus] = useState<"connecting" | "connected" | "error">("connecting");
  const [eventLog, setEventLog] = useState<SSEEvent[]>([]);
  const esRef = useRef<EventSource | null>(null);

  // Load snapshot of active calls
  const { data: snapshot } = useQuery<ActiveCall[]>({
    queryKey: ["supervisor", "active-calls"],
    queryFn: async () => {
      const r = await fetch("/api/voice/supervisor/active-calls");
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    refetchInterval: 30000,
  });

  useEffect(() => {
    if (snapshot) {
      setLiveCalls((prev) => {
        const map = new Map(prev);
        for (const call of snapshot) {
          map.set(call.id, call);
        }
        return map;
      });
    }
  }, [snapshot]);

  // SSE connection
  useEffect(() => {
    const es = new EventSource("/api/voice/supervisor/live");
    esRef.current = es;

    es.onopen = () => setConnectionStatus("connected");
    es.onerror = () => setConnectionStatus("error");

    es.onmessage = (e) => {
      try {
        const event: SSEEvent = JSON.parse(e.data);
        setEventLog((prev) => [event, ...prev].slice(0, 100));

        setLiveCalls((prev) => {
          const map = new Map(prev);

          if (event.type === "call_start") {
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
                ].slice(-50),
              });
            }
          } else if (event.type === "escalation") {
            const call = map.get(event.callId);
            if (call) {
              map.set(event.callId, { ...call, escalatedAt: event.timestamp });
            }
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

  const calls = Array.from(liveCalls.values());

  function formatTime(ts: string) {
    return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  }

  function formatPhone(p: string) {
    return p.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3") || p;
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <Monitor className="h-6 w-6 text-primary" />
            Live Monitor
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">Real-time supervision of active AI calls</p>
        </div>
        <div className="flex items-center gap-2">
          <span className={cn(
            "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium",
            connectionStatus === "connected" && "bg-emerald-50 text-emerald-700 border border-emerald-200",
            connectionStatus === "connecting" && "bg-amber-50 text-amber-700 border border-amber-200",
            connectionStatus === "error" && "bg-red-50 text-red-700 border border-red-200",
          )}>
            <span className={cn(
              "h-1.5 w-1.5 rounded-full",
              connectionStatus === "connected" && "bg-emerald-500 animate-pulse",
              connectionStatus === "connecting" && "bg-amber-500",
              connectionStatus === "error" && "bg-red-500",
            )} />
            {connectionStatus === "connected" ? "Live" : connectionStatus === "connecting" ? "Connecting…" : "Disconnected"}
          </span>
          <Badge variant="outline" className="text-xs">
            {calls.length} active {calls.length === 1 ? "call" : "calls"}
          </Badge>
        </div>
      </div>

      {/* Active calls */}
      {calls.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3 text-center">
            <Activity className="h-10 w-10 text-muted-foreground/40" />
            <p className="text-muted-foreground font-medium">No active calls right now</p>
            <p className="text-xs text-muted-foreground/70">When calls come in, live transcripts will appear here</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {calls.map((call) => (
            <Card key={call.id} className={cn(call.escalatedAt && "border-amber-400")}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    <CardTitle className="text-sm font-semibold">
                      {call.direction === "inbound" ? "Inbound from" : "Outbound to"}{" "}
                      <span className="font-mono">{formatPhone(call.fromNumber)}</span>
                    </CardTitle>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {call.escalatedAt && (
                      <Badge variant="outline" className="border-amber-400 text-amber-700 text-[10px] gap-1">
                        <AlertTriangle className="h-3 w-3" /> Escalated
                      </Badge>
                    )}
                    <Badge variant="outline" className="text-[10px] uppercase">{call.language}</Badge>
                    <Badge variant="secondary" className="text-[10px]">{call.direction}</Badge>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Started {formatTime(call.startedAt)}</p>
              </CardHeader>
              <CardContent className="pt-0">
                <ScrollArea className="h-52 rounded-md border bg-muted/30 p-3">
                  {call.messages.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">Waiting for speech…</p>
                  ) : (
                    <div className="space-y-2">
                      {call.messages.map((m, i) => (
                        <div key={i} className={cn("flex gap-2 text-xs", m.role === "assistant" && "flex-row-reverse")}>
                          <div className={cn(
                            "flex h-5 w-5 shrink-0 items-center justify-center rounded-full",
                            m.role === "user" ? "bg-blue-100 text-blue-700" : "bg-violet-100 text-violet-700",
                          )}>
                            {m.role === "user" ? <User className="h-3 w-3" /> : <Bot className="h-3 w-3" />}
                          </div>
                          <div className={cn(
                            "max-w-[85%] rounded-lg px-2.5 py-1.5 leading-snug",
                            m.role === "user" ? "bg-white border text-slate-700" : "bg-violet-50 text-violet-900",
                          )}>
                            {m.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Event log */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Event Log</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-40">
            {eventLog.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">No events yet</p>
            ) : (
              <div className="space-y-1">
                {eventLog.map((e, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="font-mono shrink-0">{formatTime(e.timestamp)}</span>
                    <Badge variant="outline" className="text-[10px] shrink-0">{e.type}</Badge>
                    <span className="truncate">
                      {e.type === "message" ? `${e.role}: ${e.content?.slice(0, 60)}…` : `call ${e.callSid?.slice(-6)}`}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
