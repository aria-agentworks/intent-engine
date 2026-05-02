import { useState, useCallback } from "react";
import { Layout } from "@/components/layout";
import { LeadCard } from "@/components/lead-card";
import { useGetLeads, useGetSources, useSaveLead, getGetLeadsQueryKey, getGetSavedLeadsQueryKey } from "@workspace/api-client-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Filter, SlidersHorizontal, Download, LayoutList, X, Bookmark, CheckSquare } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { downloadLeadsCsv } from "@/lib/csv";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Lead } from "@workspace/api-client-react/src/generated/api.schemas";
import { cn } from "@/lib/utils";

export default function LeadsExplorer() {
  const [minScore, setMinScore] = useState<number | undefined>(undefined);
  const [source, setSource] = useState<string | undefined>(undefined);
  const [subredditFilter, setSubredditFilter] = useState("");
  const [textSearch, setTextSearch] = useState("");
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const saveLead = useSaveLead();

  const { data: leadsData, isLoading } = useGetLeads({
    min_score: minScore,
    source: source === "all" ? undefined : source
  });

  const { data: sourcesData } = useGetSources();

  const filteredLeads = leadsData?.leads?.filter(lead => {
    if (subredditFilter && !lead.subreddit?.toLowerCase().includes(subredditFilter.toLowerCase())) return false;
    if (textSearch && !lead.text.toLowerCase().includes(textSearch.toLowerCase()) &&
        !lead.author?.toLowerCase().includes(textSearch.toLowerCase())) return false;
    return true;
  });

  const selectedLeads = filteredLeads?.filter(l => selectedIds.has(l.id)) ?? [];
  const allSelected = !!filteredLeads?.length && selectedIds.size === filteredLeads.length;

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredLeads?.map(l => l.id) ?? []));
    }
  };

  const exitSelectMode = () => {
    setSelectMode(false);
    setSelectedIds(new Set());
  };

  const handleSaveSelected = async () => {
    const unsaved = selectedLeads.filter(l => !l.saved);
    if (!unsaved.length) {
      toast({ title: "Already saved", description: "All selected leads are already bookmarked." });
      return;
    }
    let saved = 0;
    for (const lead of unsaved) {
      await new Promise<void>((resolve) => {
        saveLead.mutate({ id: lead.id }, {
          onSuccess: () => { saved++; resolve(); },
          onError: () => resolve(),
        });
      });
    }
    queryClient.invalidateQueries({ queryKey: getGetLeadsQueryKey() });
    queryClient.invalidateQueries({ queryKey: getGetSavedLeadsQueryKey() });
    toast({ title: "Saved", description: `${saved} lead${saved !== 1 ? "s" : ""} added to bookmarks.` });
    exitSelectMode();
  };

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
            <div className="relative w-full sm:w-56">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="search posts, authors..."
                value={textSearch}
                onChange={(e) => setTextSearch(e.target.value)}
                className="font-mono text-xs h-9 pl-8"
              />
            </div>
            <div className="w-full sm:w-44">
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

          <div className="flex items-center gap-2 ml-auto mt-4 sm:mt-0 flex-wrap justify-end">
            <div className="flex items-center font-mono text-xs text-muted-foreground bg-muted px-3 py-1 rounded">
              <SlidersHorizontal className="h-3 w-3 mr-2" />
              {filteredLeads?.length || 0} MATCHES
            </div>
            <Button
              variant={selectMode ? "secondary" : "outline"}
              size="sm"
              className="h-7 text-xs font-mono"
              onClick={() => selectMode ? exitSelectMode() : setSelectMode(true)}
              disabled={!filteredLeads?.length}
            >
              <LayoutList className="h-3 w-3 mr-1.5" />
              {selectMode ? "CANCEL_SELECT" : "SELECT"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs font-mono"
              disabled={!filteredLeads || filteredLeads.length === 0}
              onClick={() => downloadLeadsCsv(filteredLeads!, `leads_${new Date().toISOString().slice(0, 10)}.csv`)}
            >
              <Download className="h-3 w-3 mr-1.5" />
              EXPORT_CSV
            </Button>
          </div>
        </div>

        {/* select-mode sub-bar */}
        {selectMode && (
          <div className="flex items-center gap-3 px-4 py-2.5 bg-primary/10 border border-primary/30 rounded-md text-xs font-mono">
            <button
              onClick={toggleSelectAll}
              className="flex items-center gap-1.5 text-primary hover:text-primary/80 transition-colors"
            >
              <CheckSquare className="h-3.5 w-3.5" />
              {allSelected ? "DESELECT_ALL" : "SELECT_ALL"}
            </button>
            <span className="text-muted-foreground">·</span>
            <span className="text-foreground">{selectedIds.size} SELECTED</span>
            <span className="text-muted-foreground ml-auto text-[10px]">click cards to toggle</span>
          </div>
        )}

        <div className="space-y-4">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-48 w-full bg-muted/50 rounded-md border border-border" />
            ))
          ) : filteredLeads && filteredLeads.length > 0 ? (
            filteredLeads.map(lead => (
              <LeadCard
                key={lead.id}
                lead={lead}
                selected={selectMode ? selectedIds.has(lead.id) : undefined}
                onSelect={selectMode ? () => toggleSelect(lead.id) : undefined}
              />
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

      {/* floating action bar */}
      {selectMode && selectedIds.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-card border border-border shadow-2xl rounded-full px-5 py-3 font-mono text-xs animate-in slide-in-from-bottom-4 duration-200">
          <span className="text-primary font-bold">{selectedIds.size}</span>
          <span className="text-muted-foreground">lead{selectedIds.size !== 1 ? "s" : ""} selected</span>
          <div className="w-px h-4 bg-border mx-1" />
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs font-mono rounded-full"
            onClick={() => downloadLeadsCsv(selectedLeads, `selected_leads_${new Date().toISOString().slice(0, 10)}.csv`)}
          >
            <Download className="h-3 w-3 mr-1.5" />
            EXPORT_CSV
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 text-xs font-mono rounded-full"
            onClick={handleSaveSelected}
            disabled={saveLead.isPending}
          >
            <Bookmark className="h-3 w-3 mr-1.5" />
            SAVE_ALL
          </Button>
          <button
            onClick={exitSelectMode}
            className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      )}
    </Layout>
  );
}
