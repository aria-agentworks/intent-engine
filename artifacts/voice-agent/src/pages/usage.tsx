import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { BarChart3, Clock, DollarSign, PhoneCall } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";

type Period = "day" | "week" | "month";

interface DailyUsage {
  date: string;
  minutes: number;
  costCents: number;
  calls: number;
}

interface UsageData {
  period: Period;
  since: string;
  totalMinutes: number;
  totalTokens: number;
  totalCostCents: number;
  totalCostDollars: string;
  totalCalls: number;
  daily: DailyUsage[];
  estimatedMonthly: string | null;
}

function StatCard({
  icon: Icon, label, value, sub, color = "text-primary",
}: {
  icon: React.ElementType;
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm text-muted-foreground">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
            {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
          </div>
          <div className={`h-9 w-9 rounded-lg flex items-center justify-center bg-primary/10`}>
            <Icon className={`h-4.5 w-4.5 ${color}`} />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border bg-popover p-2.5 shadow-sm text-xs space-y-1">
      <p className="font-medium">{label}</p>
      {payload.map((p, i) => (
        <p key={i} className="text-muted-foreground">{p.name}: <span className="font-semibold text-foreground">{p.value}</span></p>
      ))}
    </div>
  );
};

export default function UsageMetrics() {
  const [period, setPeriod] = useState<Period>("month");

  const { data, isLoading } = useQuery<UsageData>({
    queryKey: ["usage", period],
    queryFn: async () => {
      const r = await fetch(`/api/voice/usage?period=${period}`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
    refetchInterval: 60000,
  });

  const chartData = (data?.daily ?? []).map((d) => ({
    date: new Date(d.date).toLocaleDateString([], { month: "short", day: "numeric" }),
    Minutes: d.minutes,
    Calls: d.calls,
    Cost: +(d.costCents / 100).toFixed(2),
  }));

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <BarChart3 className="h-6 w-6 text-primary" />
            Usage & Cost
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">AI minutes, tokens, and estimated billing</p>
        </div>
        <div className="flex rounded-lg border overflow-hidden">
          {(["day", "week", "month"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                period === p ? "bg-primary text-primary-foreground" : "hover:bg-muted text-muted-foreground"
              }`}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* Stats grid */}
      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-28" />)}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={PhoneCall} label="Total Calls" value={String(data?.totalCalls ?? 0)} />
          <StatCard icon={Clock} label="Total Minutes" value={String(data?.totalMinutes ?? 0)} sub="AI call time" color="text-blue-600" />
          <StatCard icon={BarChart3} label="AI Tokens" value={Number(data?.totalTokens ?? 0).toLocaleString()} color="text-violet-600" />
          <StatCard
            icon={DollarSign}
            label="Estimated Cost"
            value={`$${data?.totalCostDollars ?? "0.00"}`}
            sub={data?.estimatedMonthly ? `~$${data.estimatedMonthly}/mo` : undefined}
            color="text-emerald-600"
          />
        </div>
      )}

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Call Volume</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-48" />
            ) : chartData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="Calls" fill="hsl(var(--primary))" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Estimated Cost ($)</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <Skeleton className="h-48" />
            ) : chartData.length === 0 ? (
              <div className="h-48 flex items-center justify-center text-muted-foreground text-sm">No data</div>
            ) : (
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={chartData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="Cost" fill="#10b981" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Cost breakdown */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Cost Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-xs text-muted-foreground space-y-1.5">
            <div className="flex justify-between">
              <span>Twilio (voice minutes)</span>
              <span className="font-mono">~$0.0085/min per leg</span>
            </div>
            <div className="flex justify-between">
              <span>OpenAI GPT-4o-mini</span>
              <span className="font-mono">~$0.015/1K tokens</span>
            </div>
            <div className="flex justify-between">
              <span>OpenAI Whisper (STT)</span>
              <span className="font-mono">~$0.006/min</span>
            </div>
            <div className="flex justify-between">
              <span>OpenAI TTS</span>
              <span className="font-mono">~$0.015/1K chars</span>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
