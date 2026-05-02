import { useState } from "react";
import { Layout } from "@/components/layout";
import { LeadCard } from "@/components/lead-card";
import { useGetLeads, useGetSources } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Filter, SlidersHorizontal } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";

export default function LeadsExplorer() {
  const [minScore, setMinScore] = useState<number | undefined>(undefined);
  const [source, setSource] = useState<string | undefined>(undefined);
  const [subredditFilter, setSubredditFilter] = useState("");

  const { data: leadsData, isLoading } = useGetLeads({ 
    min_score: minScore, 
    source: source === "all" ? undefined : source 
  });
  
  const { data: sourcesData } = useGetSources();

  const filteredLeads = leadsData?.leads?.filter(lead => {
    if (!subredditFilter) return true;
    return lead.subreddit?.toLowerCase().includes(subredditFilter.toLowerCase());
  });

  return (
    <Layout>
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">LEAD_EXPLORER</h1>
          <p className="text-muted-foreground mt-1 text-sm">Filter and analyze captured intent signals.</p>
        </div>

        <div className="flex flex-col md:flex-row gap-4 border border-border bg-card p-4 rounded-md">
          <div className="flex items-center gap-2 border-r border-border pr-4 mr-2">
            <Filter className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-semibold">FILTERS</span>
          </div>

          <div className="flex flex-1 flex-col sm:flex-row gap-4">
            <div className="w-full sm:w-48">
              <Input 
                placeholder="filter by subreddit..." 
                value={subredditFilter} 
                onChange={(e) => setSubredditFilter(e.target.value)} 
                className="font-mono text-xs h-9"
                data-testid="input-subreddit-filter"
              />
            </div>

            <div className="w-full sm:w-48">
              <Select value={minScore?.toString() || "0"} onValueChange={(v) => setMinScore(Number(v))}>
                <SelectTrigger className="font-mono text-xs h-9">
                  <SelectValue placeholder="INTENT_SCORE" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">ALL_SCORES (0+)</SelectItem>
                  <SelectItem value="5">MEDIUM+ (5+)</SelectItem>
                  <SelectItem value="8">HIGH_ONLY (8+)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="w-full sm:w-48">
              <Select value={source || "all"} onValueChange={(v) => setSource(v)}>
                <SelectTrigger className="font-mono text-xs h-9">
                  <SelectValue placeholder="SOURCE" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ALL_SOURCES</SelectItem>
                  {sourcesData?.sources.map((s) => (
                    <SelectItem key={s.id} value={s.id}>{s.name.toUpperCase()} ({s.count})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          
          <div className="flex items-center ml-auto font-mono text-xs text-muted-foreground bg-muted px-3 py-1 rounded mt-4 sm:mt-0">
            <SlidersHorizontal className="h-3 w-3 mr-2" />
            {filteredLeads?.length || 0} MATCHES
          </div>
        </div>

        <div className="space-y-4">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-48 w-full bg-muted/50 rounded-md border border-border" />
            ))
          ) : filteredLeads && filteredLeads.length > 0 ? (
            filteredLeads.map(lead => (
              <LeadCard key={lead.id} lead={lead} />
            ))
          ) : (
            <div className="p-12 border border-dashed border-border rounded-md flex flex-col items-center justify-center text-center">
              <Search className="h-10 w-10 text-muted-foreground mb-4" />
              <p className="text-foreground font-medium text-lg">NO_RESULTS_FOUND</p>
              <p className="text-sm text-muted-foreground mt-2 max-w-md">
                No signals match your current filter parameters. Try lowering the intent score threshold or broadening your source selection.
              </p>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
