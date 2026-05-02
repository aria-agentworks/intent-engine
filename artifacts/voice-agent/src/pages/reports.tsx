import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { FileText, Send, PhoneCall, CalendarDays, Star, Clock, TrendingUp } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from "recharts";

interface WeeklyReport {
  businessName: string;
  period: { from: string; to: string };
  calls: {
    total: number;
    completed: number;
    avgDurationSeconds: number | null;
    avgQualityScore: number | null;
    escalated: number;
  };
  appointments: { booked: number };
  usage: { totalMinutes: number; costDollars: string };
  byOutcome: { outcome: string; count: number }[];
  dailyVolume: { date: string; calls: number }[];
}

const OUTCOME_LABELS: Record<string, string> = {
  appointment_booked: "Booked",
  inquiry_handled: "Inquiry",
  complaint: "Complaint",
  transfer_requested: "Transfer",
  wrong_number: "Wrong #",
  callback_requested: "Callback",
  resolved: "Resolved",
  no_answer: "No Answer",
};

const OUTCOME_COLORS: Record<string, string> = {
  appointment_booked: "#10b981",
  inquiry_handled: "#3b82f6",
  complaint: "#ef4444",
  transfer_requested: "#f59e0b",
  resolved: "#6366f1",
  no_answer: "#94a3b8",
};

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover p-2.5 shadow-sm text-xs">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((p, i) => <p key={i} className="text-muted-foreground">{p.value}</p>)}
    </div>
  );
};

export default function Reports() {
  const { toast } = useToast();

  const { data, isLoading } = useQuery<WeeklyReport>({
    queryKey: ["report", "weekly"],
    queryFn: async () => {
      const r = await fetch("/api/voice/reports/weekly");
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  const sendMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/voice/reports/send", { method: "POST" });
      if (!r.ok) throw new Error((await r.json()).error);
      return r.json();
    },
    onSuccess: () => toast({ title: "Report sent via SMS to supervisor" }),
    onError: (e: Error) => toast({ title: "Send failed", description: e.message, variant: "destructive" }),
  });

  function fmtDate(s: string) {
    return new Date(s).toLocaleDateString([], { month: "short", day: "numeric" });
  }

  function fmtDur(s: number | null) {
    if (!s) return "—";
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${m}:${String(sec).padStart(2, "0")}`;
  }

  const chartData = (data?.dailyVolume ?? []).map((d) => ({
    date: fmtDate(d.date),
    calls: d.calls,
  }));

  const outcomeData = (data?.byOutcome ?? [])
    .filter((o) => o.count > 0)
    .sort((a, b) => b.count - a.count);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <FileText className="h-6 w-6 text-primary" />
            Reports
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            Weekly performance summary for {isLoading ? "…" : (data?.businessName ?? "your business")}
          </p>
        </div>
        <Button
          size="sm"
          onClick={() => sendMutation.mutate()}
          disabled={sendMutation.isPending}
        >
          <Send className="h-3.5 w-3.5 mr-1.5" />
          {sendMutation.isPending ? "Sending…" : "Send via SMS"}
        </Button>
      </div>

      {/* Period banner */}
      {data && (
        <div className="rounded-lg border bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground">
          Period: <span className="font-medium text-foreground">{fmtDate(data.period.from)}</span> → <span className="font-medium text-foreground">{fmtDate(data.period.to)}</span>
        </div>
      )}

      {/* KPIs */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardContent className="pt-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Total Calls</p>
                  <p className="text-2xl font-bold mt-1">{data?.calls.total ?? 0}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{data?.calls.completed ?? 0} completed</p>
                </div>
                <PhoneCall className="h-5 w-5 text-primary mt-0.5" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Appointments</p>
                  <p className="text-2xl font-bold mt-1 text-emerald-600">{data?.appointments.booked ?? 0}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">booked this week</p>
                </div>
                <CalendarDays className="h-5 w-5 text-emerald-600 mt-0.5" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">Avg Quality</p>
                  <p className="text-2xl font-bold mt-1 text-amber-600">
                    {data?.calls.avgQualityScore ? `${data.calls.avgQualityScore}/5` : "—"}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">AI-scored calls</p>
                </div>
                <Star className="h-5 w-5 text-amber-500 mt-0.5" />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-5">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">AI Cost</p>
                  <p className="text-2xl font-bold mt-1 text-violet-600">${data?.usage.costDollars ?? "0.00"}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{data?.usage.totalMinutes ?? 0} min total</p>
                </div>
                <TrendingUp className="h-5 w-5 text-violet-600 mt-0.5" />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Daily Call Volume</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-48" />
            ) : chartData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No calls this week</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="calls" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Call Outcomes</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-48" />
            ) : outcomeData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No outcomes data</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={outcomeData.map((o) => ({ name: OUTCOME_LABELS[o.outcome] ?? o.outcome, count: o.count, outcome: o.outcome }))} layout="vertical" margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={64} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="count" radius={[0, 3, 3, 0]}>
                    {outcomeData.map((o, i) => (
                      <Cell key={i} fill={OUTCOME_COLORS[o.outcome] ?? "#6366f1"} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Details */}
      {data && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-sm">Summary Details</CardTitle></CardHeader>
          <CardContent>
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              {[
                ["Avg Call Duration", fmtDur(data.calls.avgDurationSeconds)],
                ["Escalated to Human", String(data.calls.escalated)],
                ["Total AI Minutes", String(data.usage.totalMinutes)],
                ["Estimated Cost", `$${data.usage.costDollars}`],
              ].map(([label, value]) => (
                <div key={label} className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-2">
                  <span className="text-muted-foreground text-xs">{label}</span>
                  <span className="font-semibold text-xs">{value}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
