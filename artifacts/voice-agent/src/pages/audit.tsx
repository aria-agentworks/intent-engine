import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck, RefreshCw } from "lucide-react";

interface AuditLog {
  id: string;
  clerkUserId?: string | null;
  userEmail?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  details?: string | null;
  ipAddress?: string | null;
  createdAt: string;
}

interface AuditResponse {
  logs: AuditLog[];
  page: number;
  total: number;
}

const ACTION_COLORS: Record<string, string> = {
  "call.view": "bg-blue-50 text-blue-700 border-blue-200",
  "recording.play": "bg-purple-50 text-purple-700 border-purple-200",
  "config.update": "bg-amber-50 text-amber-700 border-amber-200",
  "call.export": "bg-green-50 text-green-700 border-green-200",
  "dnc.add": "bg-red-50 text-red-700 border-red-200",
  "dnc.delete": "bg-red-50 text-red-700 border-red-200",
  "user.role_change": "bg-orange-50 text-orange-700 border-orange-200",
};

function ActionBadge({ action }: { action: string }) {
  const cls = ACTION_COLORS[action] ?? "bg-slate-50 text-slate-700 border-slate-200";
  return (
    <span className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[10px] font-medium ${cls}`}>
      {action}
    </span>
  );
}

export default function AuditLogs() {
  const [since, setSince] = useState("");
  const [until, setUntil] = useState("");
  const [page, setPage] = useState(1);

  const { data, isLoading, refetch } = useQuery<AuditResponse>({
    queryKey: ["audit-logs", since, until, page],
    queryFn: async () => {
      const params = new URLSearchParams({ page: String(page), limit: "50" });
      if (since) params.set("since", new Date(since).toISOString());
      if (until) params.set("until", new Date(until).toISOString());
      const r = await fetch(`/api/voice/audit-logs?${params}`);
      if (!r.ok) throw new Error("Failed");
      return r.json();
    },
  });

  function formatTs(ts: string) {
    return new Date(ts).toLocaleString([], {
      month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit",
    });
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            Audit Logs
          </h1>
          <p className="text-muted-foreground text-sm mt-0.5">HIPAA-compliant activity audit trail</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()}>
          <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Refresh
        </Button>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-4 items-end">
            <div className="space-y-1">
              <Label className="text-xs">From</Label>
              <Input type="datetime-local" value={since} onChange={(e) => { setSince(e.target.value); setPage(1); }} className="text-xs h-8 w-48" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">To</Label>
              <Input type="datetime-local" value={until} onChange={(e) => { setUntil(e.target.value); setPage(1); }} className="text-xs h-8 w-48" />
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setSince(""); setUntil(""); setPage(1); }} className="h-8 text-xs">Clear</Button>
          </div>
        </CardContent>
      </Card>

      {/* Log table */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">{data ? `${data.total} entries` : "Audit Trail"}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-4 space-y-3">
              {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : !data?.logs.length ? (
            <div className="flex flex-col items-center py-12 gap-2 text-center">
              <ShieldCheck className="h-8 w-8 text-muted-foreground/40" />
              <p className="text-muted-foreground text-sm">No audit entries found</p>
            </div>
          ) : (
            <>
              <div className="divide-y text-sm">
                {data.logs.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors">
                    <span className="text-xs text-muted-foreground font-mono shrink-0 pt-0.5 w-36">
                      {formatTs(log.createdAt)}
                    </span>
                    <ActionBadge action={log.action} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground truncate">
                        {log.userEmail ?? log.clerkUserId ?? "System"}
                        {log.resourceType && ` · ${log.resourceType}`}
                        {log.resourceId && ` #${log.resourceId.slice(0, 8)}`}
                      </p>
                      {log.details && (
                        <p className="text-xs text-muted-foreground/70 truncate mt-0.5">
                          {(() => { try { return JSON.stringify(JSON.parse(log.details)); } catch { return log.details; } })()}
                        </p>
                      )}
                    </div>
                    {log.ipAddress && (
                      <span className="text-xs text-muted-foreground/60 font-mono shrink-0">{log.ipAddress}</span>
                    )}
                  </div>
                ))}
              </div>
              {/* Pagination */}
              <div className="flex items-center justify-between px-4 py-3 border-t">
                <p className="text-xs text-muted-foreground">Page {page}</p>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1}>Previous</Button>
                  <Button variant="outline" size="sm" onClick={() => setPage((p) => p + 1)} disabled={data.logs.length < 50}>Next</Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
