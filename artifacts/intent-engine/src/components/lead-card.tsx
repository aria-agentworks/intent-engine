import { useState } from "react";
import { format } from "date-fns";
import { Bookmark, BookmarkCheck, ExternalLink, Bot, Copy, Check, Square, CheckSquare, Sparkles, Mail, Phone, Globe, Building2, User, ChevronDown, ChevronUp, Star } from "lucide-react";
import { SiReddit, SiX, SiGithub, SiHackerone, SiYcombinator } from "react-icons/si";
import { Lead, ReplyVariant } from "@workspace/api-client-react/src/generated/api.schemas";
import { useSaveLead, getGetSavedLeadsQueryKey, getGetLeadsQueryKey, useGenerateResponse, useEnrichLead } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface LeadCardProps {
  lead: Lead;
  statusSelector?: React.ReactNode;
  selected?: boolean;
  onSelect?: () => void;
}

export function LeadCard({ lead, statusSelector, selected, onSelect }: LeadCardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const saveLead = useSaveLead();
  const generateResponse = useGenerateResponse();
  const [variants, setVariants] = useState<ReplyVariant[] | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [enrichOpen, setEnrichOpen] = useState(false);

  const isHigh = lead.intent_score >= 8;
  const isMedium = lead.intent_score >= 5 && lead.intent_score < 8;
  const selectMode = onSelect !== undefined;

  const { data: enrichData, isFetching: enrichLoading, refetch: fetchEnrich, isSuccess: enriched } = useEnrichLead(
    lead.id,
    { query: { enabled: false } }
  );

  const handleEnrich = async () => {
    if (enriched) {
      setEnrichOpen((o) => !o);
      return;
    }
    const result = await fetchEnrich();
    if (result.data) setEnrichOpen(true);
  };

  const handleCopy = async (text: string, index: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleSave = () => {
    saveLead.mutate(
      { id: lead.id },
      {
        onSuccess: (data) => {
          toast({
            title: data.saved ? "Lead Saved" : "Lead Removed",
            description: data.saved ? "Added to your saved leads." : "Removed from saved leads.",
          });
          queryClient.invalidateQueries({ queryKey: getGetLeadsQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetSavedLeadsQueryKey() });
        },
        onError: () => {
          toast({ title: "Error", description: "Failed to update saved status.", variant: "destructive" });
        }
      }
    );
  };

  const handleGenerateResponse = () => {
    generateResponse.mutate(
      { id: lead.id },
      {
        onSuccess: (data) => { setVariants(data.variants ?? null); setActiveTab(0); },
        onError: () => {
          toast({ title: "Generation Failed", description: "Could not generate outreach variants.", variant: "destructive" });
        }
      }
    );
  };

  const SourceIcon = () => {
    const s = lead.source.toLowerCase();
    if (s.includes("reddit")) return <SiReddit className="text-[#FF4500] h-4 w-4" />;
    if (s.includes("twitter") || s === "twitter") return <SiX className="h-4 w-4 text-foreground" />;
    if (s.includes("github")) return <SiGithub className="h-4 w-4 text-foreground" />;
    if (s === "hacker_news" || s.includes("hacker news")) return <SiYcombinator className="text-[#FF6600] h-4 w-4" />;
    if (s.includes("hacker")) return <SiHackerone className="h-4 w-4 text-foreground" />;
    return <span className="text-xs uppercase text-muted-foreground">[{lead.source}]</span>;
  };

  const activeVariant = variants?.[activeTab];
  const hasEnrichData = enriched && enrichData && (
    enrichData.emails.length > 0 ||
    enrichData.phones.length > 0 ||
    enrichData.urls.length > 0 ||
    enrichData.company ||
    enrichData.source_profile
  );

  return (
    <div
      className={cn(
        "border bg-card rounded-md overflow-hidden flex flex-col relative group transition-colors",
        selected ? "border-primary bg-primary/5" : "border-border hover:border-primary/50",
        selectMode && "cursor-pointer"
      )}
      onClick={selectMode ? onSelect : undefined}
    >
      <div className="absolute top-0 left-0 w-1 h-full" style={{
        backgroundColor: isHigh ? "var(--chart-1)" : isMedium ? "var(--chart-2)" : "var(--chart-3)"
      }} />

      <div className="p-5 pl-6 flex flex-col gap-4">
        {/* header */}
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {selectMode && (
              <div className={cn(
                "flex items-center justify-center w-5 h-5 rounded border transition-colors shrink-0",
                selected ? "border-primary text-primary" : "border-muted-foreground/40 text-muted-foreground"
              )}>
                {selected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground/40" />}
              </div>
            )}
            <div className="flex items-center justify-center w-8 h-8 rounded bg-muted/50 border border-border">
              <SourceIcon />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">{lead.author || "Anonymous"}</span>
                {lead.subreddit && (
                  <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">r/{lead.subreddit}</span>
                )}
                {hasEnrichData && enrichData?.company && (
                  <span className="text-xs text-emerald-400/80 bg-emerald-400/10 border border-emerald-400/20 px-1.5 py-0.5 rounded font-mono">
                    {enrichData.company}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {format(new Date(lead.created_at), "MMM d, yyyy • h:mm a")}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2" onClick={(e) => selectMode && e.stopPropagation()}>
            {statusSelector}
            <Badge variant="outline" className={cn(
              "font-mono rounded-sm px-2",
              isHigh ? "border-primary/50 text-primary bg-primary/10" :
              isMedium ? "border-amber-500/50 text-amber-500 bg-amber-500/10" :
              "border-muted-foreground/30 text-muted-foreground"
            )}>
              SCORE: {lead.intent_score}/10
            </Badge>
            {!selectMode && (
              <Button
                variant="ghost" size="icon"
                className={cn("h-8 w-8", lead.saved && "text-primary hover:text-primary/80")}
                onClick={handleSave}
                disabled={saveLead.isPending}
              >
                {lead.saved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
              </Button>
            )}
          </div>
        </div>

        {/* post text */}
        <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap font-sans">
          "{lead.text}"
        </div>

        {!selectMode && (
          <>
            {/* action row */}
            <div className="flex items-center justify-between mt-2 pt-4 border-t border-border/50" onClick={(e) => e.stopPropagation()}>
              <div className="flex items-center gap-2">
                {lead.url && (
                  <Button variant="outline" size="sm" className="h-8 text-xs font-mono" asChild>
                    <a href={lead.url} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-3 w-3 mr-2" />OPEN_SOURCE
                    </a>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className={cn(
                    "h-8 text-xs font-mono",
                    hasEnrichData && "border-emerald-500/40 text-emerald-400 hover:border-emerald-500/70"
                  )}
                  onClick={handleEnrich}
                  disabled={enrichLoading}
                >
                  {enrichLoading ? (
                    <span className="animate-pulse">ENRICHING...</span>
                  ) : (
                    <>
                      <Sparkles className="h-3 w-3 mr-2" />
                      {hasEnrichData ? (enrichOpen ? "HIDE_INTEL" : "SHOW_INTEL") : "ENRICH"}
                    </>
                  )}
                </Button>
              </div>
              {!variants && (
                <Button
                  variant="secondary" size="sm"
                  className="h-8 text-xs font-mono"
                  onClick={handleGenerateResponse}
                  disabled={generateResponse.isPending}
                >
                  {generateResponse.isPending
                    ? <span className="animate-pulse">GENERATING...</span>
                    : <><Bot className="h-3 w-3 mr-2" />GENERATE_REPLY</>
                  }
                </Button>
              )}
            </div>

            {/* enrichment panel */}
            {enrichOpen && enrichData && (
              <div className="border border-emerald-500/20 rounded-md bg-emerald-950/10 overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-2 px-4 py-2 border-b border-emerald-500/15 bg-emerald-500/5">
                  <Sparkles className="h-3 w-3 text-emerald-400" />
                  <span className="text-[10px] font-mono font-bold text-emerald-400 tracking-wider">LEAD_INTEL</span>
                  {enrichData.source_profile && (
                    <span className="ml-auto text-[10px] font-mono text-muted-foreground flex items-center gap-1">
                      <Star className="h-2.5 w-2.5" />
                      {enrichData.source_profile.karma?.toLocaleString()} karma
                      {enrichData.source_profile.account_age_days !== null && (
                        <> · {Math.floor(enrichData.source_profile.account_age_days / 365)}y account</>
                      )}
                    </span>
                  )}
                </div>

                <div className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {enrichData.company && (
                    <EnrichRow icon={<Building2 className="h-3 w-3" />} label="COMPANY" value={enrichData.company} />
                  )}
                  {enrichData.emails.length > 0 && enrichData.emails.map((e, i) => (
                    <EnrichRow key={i} icon={<Mail className="h-3 w-3" />} label="EMAIL" value={e} copyable />
                  ))}
                  {enrichData.phones.length > 0 && enrichData.phones.map((p, i) => (
                    <EnrichRow key={i} icon={<Phone className="h-3 w-3" />} label="PHONE" value={p} copyable />
                  ))}
                  {enrichData.source_profile?.website && (
                    <EnrichRow icon={<Globe className="h-3 w-3" />} label="WEBSITE" value={enrichData.source_profile.website} href={enrichData.source_profile.website} />
                  )}
                  {enrichData.urls.slice(0, 3).map((u, i) => (
                    <EnrichRow key={i} icon={<Globe className="h-3 w-3" />} label="URL" value={new URL(u).hostname.replace("www.", "")} href={u} />
                  ))}
                  {enrichData.source_profile?.profile_url && (
                    <EnrichRow icon={<User className="h-3 w-3" />} label="PROFILE" value={enrichData.source_profile.profile_url} href={enrichData.source_profile.profile_url} />
                  )}
                </div>

                {enrichData.source_profile?.bio && (
                  <div className="px-4 pb-4">
                    <div className="text-[10px] font-mono text-muted-foreground mb-1">BIO</div>
                    <p className="text-xs text-foreground/80 leading-relaxed line-clamp-3">
                      {enrichData.source_profile.bio}
                    </p>
                  </div>
                )}

                {!enrichData.company && enrichData.emails.length === 0 && enrichData.phones.length === 0 && !enrichData.source_profile?.website && (
                  <p className="px-4 pb-4 text-xs text-muted-foreground font-mono">
                    No contact info found in post or public profile.
                  </p>
                )}
              </div>
            )}

            {/* variant reply tabs */}
            {variants && variants.length > 0 && (
              <div className="mt-1 border border-primary/20 rounded-md overflow-hidden" onClick={(e) => e.stopPropagation()}>
                <div className="flex border-b border-border/60 bg-muted/20">
                  {variants.map((v, i) => (
                    <button key={v.label} onClick={() => setActiveTab(i)} className={cn(
                      "flex-1 px-3 py-2 text-[10px] font-mono font-bold tracking-wider transition-colors",
                      activeTab === i
                        ? "bg-primary/10 text-primary border-b-2 border-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                    )}>
                      {v.label}
                    </button>
                  ))}
                  <button onClick={() => setVariants(null)} className="px-3 py-2 text-[10px] font-mono text-muted-foreground hover:text-foreground transition-colors" title="Close">✕</button>
                </div>

                {activeVariant && (
                  <div className="p-4 bg-muted/10">
                    <p className="text-[10px] text-muted-foreground font-mono mb-3 italic">{activeVariant.style}</p>
                    <p className="text-sm font-sans text-foreground/90 leading-relaxed">{activeVariant.message}</p>
                    <div className="flex items-center justify-between mt-4">
                      <Button variant="ghost" size="sm" className="h-7 text-xs font-mono text-muted-foreground" onClick={handleGenerateResponse} disabled={generateResponse.isPending}>
                        {generateResponse.isPending ? "REGENERATING..." : "REGENERATE"}
                      </Button>
                      <Button size="sm" className="h-7 text-xs font-mono bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => handleCopy(activeVariant.message, activeTab)}>
                        {copiedIndex === activeTab ? <><Check className="h-3 w-3 mr-1.5" />COPIED</> : <><Copy className="h-3 w-3 mr-1.5" />COPY</>}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

interface EnrichRowProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  copyable?: boolean;
  href?: string;
}

function EnrichRow({ icon, label, value, copyable, href }: EnrichRowProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.preventDefault();
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-start gap-2 min-w-0">
      <div className="text-emerald-400/60 mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[9px] font-mono text-muted-foreground/60 tracking-widest mb-0.5">{label}</div>
        {href ? (
          <a href={href} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline truncate block font-mono">
            {value}
          </a>
        ) : (
          <span className="text-xs text-foreground font-mono truncate block">{value}</span>
        )}
      </div>
      {copyable && (
        <button onClick={handleCopy} className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5">
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
        </button>
      )}
    </div>
  );
}
