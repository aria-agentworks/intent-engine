import { useGetLeadsStats, useGetLeads, useHealthCheck, useRefreshLeads, getGetLeadsQueryKey, getGetLeadsStatsQueryKey, useGetSources } from "@workspace/api-client-react";
import { LeadCard } from "@/components/lead-card";
import { Layout } from "@/components/layout";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, AlertCircle, Database, Target, TrendingUp, Users, RefreshCw } from "lucide-react";
import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

function getRelativeTime(dateString: string) {
  const date = new Date(dateString);
  const now = new Date();
  const diffInSeconds = Math.floor((now.getTime() - date.getTime()) / 1000);
  
  if (diffInSeconds < 5) return "just now";
  if (diffInSeconds < 60) return `${diffInSeconds}s ago`;
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  return `${Math.floor(diffInSeconds / 86400)}d ago`;
}

export default function Dashboard() {
  const queryClient = useQueryClient();
  
  const [refreshInterval, setRefreshInterval] = useState<number>(() => {
    const saved = localStorage.getItem("ie_refresh_interval");
    return saved ? parseInt(saved, 10) : 0;
  });

  useEffect(() => {
    localStorage.setItem("ie_refresh_interval", refreshInterval.toString());
  }, [refreshInterval]);

  const { data: stats, isLoading: statsLoading } = useGetLeadsStats({
    query: { refetchInterval: refreshInterval > 0 ? refreshInterval : false, queryKey: getGetLeadsStatsQueryKey() }
  });
  
  const { data: leadsData, isLoading: leadsLoading } = useGetLeads(
    { min_score: 8, limit: 5 },
    { query: { refetchInterval: refreshInterval > 0 ? refreshInterval : false, queryKey: getGetLeadsQueryKey({min_score:8,limit:5}) } }
  );
  
  const { data: health } = useHealthCheck();
  const { data: sourcesData, isLoading: sourcesLoading } = useGetSources();

  const refreshMutation = useRefreshLeads();

  const handleRefresh = () => {
    refreshMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetLeadsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetLeadsStatsQueryKey() });
      }
    });
  };

  const [lastUpdated, setLastUpdated] = useState<string>("NEVER_FETCHED");

  useEffect(() => {
    const updateTime = () => {
      if (leadsData?.fetched_at) {
        setLastUpdated(`UPDATED ${getRelativeTime(leadsData.fetched_at)}`);
      } else {
        setLastUpdated("NEVER_FETCHED");
      }
    };

    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, [leadsData?.fetched_at]);

  return (
    <Layout>
      <div className="flex flex-col gap-8">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight">SIGNAL_DASHBOARD</h1>
            <p className="text-muted-foreground mt-1 text-sm">Real-time intent monitoring and analytics.</p>
            <p className="text-xs font-mono text-muted-foreground mt-0.5">{lastUpdated}</p>
          </div>
          
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Select 
                value={refreshInterval.toString()} 
                onValueChange={(val) => setRefreshInterval(parseInt(val, 10))}
              >
                <SelectTrigger className="w-[100px] h-8 text-xs font-mono" data-testid="select-refresh-interval">
                  <SelectValue placeholder="Refresh" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">OFF</SelectItem>
                  <SelectItem value="900000">15m</SelectItem>
                  <SelectItem value="1800000">30m</SelectItem>
                  <SelectItem value="3600000">1h</SelectItem>
                </SelectContent>
              </Select>
              
              <Button 
                variant="outline" 
                size="icon" 
                className="h-8 w-8" 
                onClick={handleRefresh}
                disabled={refreshMutation.isPending}
                data-testid="button-refresh-now"
              >
                <RefreshCw className={cn("h-4 w-4", refreshMutation.isPending && "animate-spin")} />
              </Button>
            </div>

            <div className="flex items-center gap-2 text-xs font-mono">
              <div className={`h-2 w-2 rounded-full ${health?.status === 'ok' ? 'bg-primary animate-pulse' : 'bg-destructive'}`} />
              <span className="text-muted-foreground">SYSTEM_STATUS: {health?.status === 'ok' ? 'ONLINE' : 'OFFLINE'}</span>
            </div>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard 
            title="TOTAL_SIGNALS" 
            value={stats?.total_leads} 
            loading={statsLoading} 
            icon={<Database className="h-4 w-4 text-muted-foreground" />} 
          />
          <StatCard 
            title="HIGH_INTENT" 
            value={stats?.high_intent} 
            loading={statsLoading} 
            icon={<Target className="h-4 w-4 text-primary" />} 
            valueColor="text-primary"
          />
          <StatCard 
            title="MEDIUM_INTENT" 
            value={stats?.medium_intent} 
            loading={statsLoading} 
            icon={<Activity className="h-4 w-4 text-amber-500" />} 
            valueColor="text-amber-500"
          />
          <StatCard 
            title="AVG_SCORE" 
            value={stats?.avg_score ? stats.avg_score.toFixed(1) : 0} 
            loading={statsLoading} 
            icon={<TrendingUp className="h-4 w-4 text-muted-foreground" />} 
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Recent High Intent Leads */}
          <div className="lg:col-span-2 space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h2 className="text-xl font-bold tracking-tight">CRITICAL_SIGNALS</h2>
              <span className="text-xs text-primary font-mono bg-primary/10 px-2 py-1 rounded">{"SCORE >= 8"}</span>
            </div>
            
            <div className="space-y-4">
              {leadsLoading ? (
                Array.from({ length: 3 }).map((_, i) => (
                  <Skeleton key={i} className="h-48 w-full bg-muted/50 rounded-md border border-border" />
                ))
              ) : leadsData?.leads && leadsData.leads.length > 0 ? (
                leadsData.leads.map(lead => (
                  <LeadCard key={lead.id} lead={lead} />
                ))
              ) : (
                <div className="p-8 border border-dashed border-border rounded-md flex flex-col items-center justify-center text-center">
                  <AlertCircle className="h-8 w-8 text-muted-foreground mb-3" />
                  <p className="text-foreground font-medium">NO_CRITICAL_SIGNALS</p>
                  <p className="text-sm text-muted-foreground mt-1">Scanner has not detected high intent leads recently.</p>
                </div>
              )}
            </div>
          </div>

          {/* Sources Breakdown */}
          <div className="space-y-4">
            <div className="border-b border-border pb-2">
              <h2 className="text-xl font-bold tracking-tight">SOURCES</h2>
            </div>
            
            <div className="border border-border bg-card rounded-md p-4">
              {statsLoading || sourcesLoading ? (
                <div className="space-y-3">
                  <Skeleton className="h-8 w-full bg-muted/50" />
                  <Skeleton className="h-8 w-full bg-muted/50" />
                  <Skeleton className="h-8 w-full bg-muted/50" />
                </div>
              ) : sourcesData?.sources && sourcesData.sources.length > 0 ? (
                <div className="space-y-4">
                  {sourcesData.sources.map(source => (
                    <div key={source.id} className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 text-sm font-medium">
                          <Users className="h-3 w-3 text-muted-foreground" />
                          {source.name}
                        </div>
                        <div className="flex items-center gap-2">
                          {source.active ? (
                            <Badge variant="outline" className="text-[10px] h-5 border-green-500/30 text-green-500 bg-green-500/10">ACTIVE</Badge>
                          ) : (
                            <Badge variant="outline" className="text-[10px] h-5 border-muted-foreground/30 text-muted-foreground bg-muted/50">INACTIVE</Badge>
                          )}
                          <div className="text-sm font-mono bg-muted px-2 py-0.5 rounded text-muted-foreground">
                            {source.count}
                          </div>
                        </div>
                      </div>
                      {!source.active && (
                        <p className="text-xs text-muted-foreground ml-5">Add API key to activate</p>
                      )}
                    </div>
                  ))}
                </div>
              ) : stats?.by_source && stats.by_source.length > 0 ? (
                <div className="space-y-3">
                  {stats.by_source.map(source => (
                    <div key={source.source} className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-sm font-medium">
                        <Users className="h-3 w-3 text-muted-foreground" />
                        {source.source}
                      </div>
                      <div className="text-sm font-mono bg-muted px-2 py-0.5 rounded text-muted-foreground">
                        {source.count}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-4">No sources active.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </Layout>
  );
}

function StatCard({ title, value, loading, icon, valueColor = "text-foreground" }: { title: string, value: any, loading: boolean, icon: React.ReactNode, valueColor?: string }) {
  return (
    <div className="border border-border bg-card p-5 rounded-md flex flex-col gap-2 relative overflow-hidden">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        {icon}
      </div>
      {loading ? (
        <Skeleton className="h-8 w-16 bg-muted/50 mt-1" />
      ) : (
        <div className={`text-3xl font-bold font-mono tracking-tighter ${valueColor}`}>
          {value || 0}
        </div>
      )}
    </div>
  );
}
