import { useState } from "react";
import { format } from "date-fns";
import {
  Bookmark, BookmarkCheck, ExternalLink, Bot, Copy, Check,
  Square, CheckSquare, Sparkles, Mail, Phone, Globe, Building2,
  User, Star, Brain, ChevronDown, ChevronUp, Send, AlertTriangle, Zap, Target,
  BarChart2, Hash
} from "lucide-react";
import { SiReddit, SiX, SiGithub, SiHackerone, SiYcombinator } from "react-icons/si";
import { Lead, ReplyVariant } from "@workspace/api-client-react/src/generated/api.schemas";
import {
  useSaveLead, getGetSavedLeadsQueryKey, getGetLeadsQueryKey,
  useGenerateResponse, useEnrichLead, useAnalyzeLead, useGetLeadScoreBreakdown,
} from "@workspace/api-client-react";
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

const PAIN_COLOR: Record<string, string> = {
  CRITICAL: "border-red-500/60 text-red-400 bg-red-500/10",
  HIGH: "border-orange-500/60 text-orange-400 bg-orange-500/10",
  MEDIUM: "border-amber-500/60 text-amber-400 bg-amber-500/10",
  LOW: "border-muted-foreground/30 text-muted-foreground",
};

const URGENCY_COLOR: Record<string, string> = {
  HIGH: "text-red-400",
  MEDIUM: "text-amber-400",
  LOW: "text-muted-foreground",
};

const CHANNEL_LABEL: Record<string, string> = {
  POST_REPLY: "Reply to post",
  EMAIL: "Send email",
  DM: "Direct message",
};

export function LeadCard({ lead, statusSelector, selected, onSelect }: LeadCardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const saveLead = useSaveLead();
  const generateResponse = useGenerateResponse();

  const [variants, setVariants] = useState<ReplyVariant[] | null>(null);
  const [activeTab, setActiveTab] = useState(0);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [enrichOpen, setEnrichOpen] = useState(false);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [breakdownOpen, setBreakdownOpen] = useState(false);

  const isHigh = lead.intent_score >= 8;
  const isMedium = lead.intent_score >= 5 && lead.intent_score < 8;
  const selectMode = onSelect !== undefined;

  const { data: enrichData, isFetching: enrichLoading, refetch: fetchEnrich, isSuccess: enriched } =
    useEnrichLead(lead.id, { query: { enabled: false } });

  const { data: analysisData, isFetching: analyzeLoading, refetch: fetchAnalysis, isSuccess: analyzed } =
    useAnalyzeLead(lead.id, { query: { enabled: false } });

  const { data: breakdownData, isFetching: breakdownLoading, refetch: fetchBreakdown, isSuccess: brokenDown } =
    useGetLeadScoreBreakdown(lead.id, { query: { enabled: false } });

  const handleEnrich = async () => {
    if (enriched) { setEnrichOpen(o => !o); return; }
    const result = await fetchEnrich();
    if (result.data) setEnrichOpen(true);
  };

  const handleAnalyze = async () => {
    if (analyzed) { setAnalysisOpen(o => !o); return; }
    const result = await fetchAnalysis();
    if (result.data) setAnalysisOpen(true);
  };

  const handleBreakdown = async () => {
    if (brokenDown) { setBreakdownOpen(o => !o); return; }
    const result = await fetchBreakdown();
    if (result.data) setBreakdownOpen(true);
  };

  const handleCopy = async (text: string, index: number) => {
    await navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const handleSave = () => {
    saveLead.mutate({ id: lead.id }, {
      onSuccess: (data) => {
        toast({
          title: data.saved ? "Lead Saved" : "Lead Removed",
          description: data.saved ? "Added to your saved leads." : "Removed from saved leads.",
        });
        queryClient.invalidateQueries({ queryKey: getGetLeadsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetSavedLeadsQueryKey() });
      },
      onError: () => toast({ title: "Error", description: "Failed to update saved status.", variant: "destructive" }),
    });
  };

  const handleGenerateResponse = () => {
    generateResponse.mutate({ id: lead.id }, {
      onSuccess: (data) => { setVariants(data.variants ?? null); setActiveTab(0); },
      onError: () => toast({ title: "Generation Failed", description: "Could not generate outreach variants.", variant: "destructive" }),
    });
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
    enrichData.emails.length > 0 || enrichData.phones.length > 0 ||
    enrichData.urls.length > 0 || enrichData.company || enrichData.source_profile
  );

  // mailto deeplink: only available when we have both an email and a generated reply
  const emailTarget = enrichData?.emails?.[0];
  const mailtoHref = emailTarget && activeVariant
    ? `mailto:${emailTarget}?subject=${encodeURIComponent(`Re: your post`)}&body=${encodeURIComponent(activeVariant.message)}`
    : null;

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
                selected ? "border-primary" : "border-muted-foreground/40"
              )}>
                {selected ? <CheckSquare className="h-4 w-4 text-primary" /> : <Square className="h-4 w-4 text-muted-foreground/40" />}
              </div>
            )}
            <div className="flex items-center justify-center w-8 h-8 rounded bg-muted/50 border border-border">
              <SourceIcon />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-semibold text-foreground">{lead.author || "Anonymous"}</span>
                {lead.subreddit && (
                  <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">r/{lead.subreddit}</span>
                )}
                {hasEnrichData && enrichData?.company && (
                  <span className="text-xs text-emerald-400/80 bg-emerald-400/10 border border-emerald-400/20 px-1.5 py-0.5 rounded font-mono">
                    {enrichData.company}
                  </span>
                )}
                {analyzed && analysisData && (
                  <span className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded border", PAIN_COLOR[analysisData.pain_level])}>
                    {analysisData.pain_level}
                  </span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {format(new Date(lead.created_at), "MMM d, yyyy • h:mm a")}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2" onClick={e => selectMode && e.stopPropagation()}>
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
              <Button variant="ghost" size="icon" className={cn("h-8 w-8", lead.saved && "text-primary hover:text-primary/80")} onClick={handleSave} disabled={saveLead.isPending}>
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
            <div className="flex items-center justify-between mt-2 pt-4 border-t border-border/50 flex-wrap gap-2" onClick={e => e.stopPropagation()}>
              <div className="flex items-center gap-2 flex-wrap">
                {lead.url && (
                  <Button variant="outline" size="sm" className="h-8 text-xs font-mono" asChild>
                    <a href={lead.url} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-3 w-3 mr-2" />OPEN_SOURCE
                    </a>
                  </Button>
                )}
                <Button
                  variant="outline" size="sm"
                  className={cn("h-8 text-xs font-mono", hasEnrichData && "border-emerald-500/40 text-emerald-400 hover:border-emerald-500/70")}
                  onClick={handleEnrich} disabled={enrichLoading}
                >
                  {enrichLoading ? <span className="animate-pulse">ENRICHING...</span> : (
                    <><Sparkles className="h-3 w-3 mr-2" />{hasEnrichData ? (enrichOpen ? "HIDE_INTEL" : "SHOW_INTEL") : "ENRICH"}</>
                  )}
                </Button>
                <Button
                  variant="outline" size="sm"
                  className={cn("h-8 text-xs font-mono", analyzed && "border-violet-500/40 text-violet-400 hover:border-violet-500/70")}
                  onClick={handleAnalyze} disabled={analyzeLoading}
                >
                  {analyzeLoading ? <span className="animate-pulse">ANALYZING...</span> : (
                    <><Brain className="h-3 w-3 mr-2" />{analyzed ? (analysisOpen ? "HIDE_BRAIN" : "SHOW_BRAIN") : "ANALYZE"}</>
                  )}
                </Button>
                <Button
                  variant="outline" size="sm"
                  className={cn("h-8 text-xs font-mono", brokenDown && "border-cyan-500/40 text-cyan-400 hover:border-cyan-500/70")}
                  onClick={handleBreakdown} disabled={breakdownLoading}
                >
                  {breakdownLoading ? <span className="animate-pulse">LOADING...</span> : (
                    <><BarChart2 className="h-3 w-3 mr-2" />{brokenDown ? (breakdownOpen ? "HIDE_SCORE" : "SCORE_WHY") : "SCORE_WHY"}</>
                  )}
                </Button>
              </div>
              <div className="flex items-center gap-2">
                {mailtoHref && (
                  <Button size="sm" variant="outline" className="h-8 text-xs font-mono border-emerald-500/40 text-emerald-400 hover:border-emerald-500/70" asChild>
                    <a href={mailtoHref}>
                      <Send className="h-3 w-3 mr-2" />SEND_EMAIL
                    </a>
                  </Button>
                )}
                {!variants && (
                  <Button variant="secondary" size="sm" className="h-8 text-xs font-mono" onClick={handleGenerateResponse} disabled={generateResponse.isPending}>
                    {generateResponse.isPending ? <span className="animate-pulse">GENERATING...</span> : <><Bot className="h-3 w-3 mr-2" />GENERATE_REPLY</>}
                  </Button>
                )}
              </div>
            </div>

            {/* score breakdown panel */}
            {breakdownOpen && breakdownData && (
              <div className="border border-cyan-500/20 rounded-md bg-cyan-950/10 overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-cyan-500/15 bg-cyan-500/5">
                  <BarChart2 className="h-3 w-3 text-cyan-400" />
                  <span className="text-[10px] font-mono font-bold text-cyan-400 tracking-wider">SCORE_BREAKDOWN</span>
                  <div className="ml-auto flex items-center gap-3">
                    <span className="text-[10px] font-mono text-muted-foreground">
                      {breakdownData.matched.length}/{breakdownData.total_keywords} keywords matched
                    </span>
                    {breakdownData.fallback && (
                      <span className="text-[10px] font-mono text-amber-500/80 bg-amber-500/10 border border-amber-500/20 px-1.5 py-0.5 rounded">
                        DEFAULT SCORE
                      </span>
                    )}
                  </div>
                </div>

                <div className="p-4 space-y-3">
                  {breakdownData.fallback ? (
                    <div className="flex items-start gap-2 text-xs text-muted-foreground">
                      <AlertTriangle className="h-3.5 w-3.5 text-amber-500/60 mt-0.5 shrink-0" />
                      <p>No keywords matched this post. The score of <span className="text-foreground font-mono">3</span> is the default fallback. Add more keywords in the Keywords page to capture signals like this.</p>
                    </div>
                  ) : (
                    <>
                      <div className="text-[10px] font-mono text-muted-foreground/60 tracking-widest mb-1">MATCHED KEYWORDS</div>
                      <div className="space-y-2">
                        {breakdownData.matched.map((kw, i) => (
                          <ScoreBar
                            key={i}
                            phrase={kw.phrase}
                            score={kw.score}
                            isPrimary={kw.is_primary}
                          />
                        ))}
                      </div>
                      {breakdownData.unmatched_count > 0 && (
                        <p className="text-[10px] font-mono text-muted-foreground/50 pt-1">
                          + {breakdownData.unmatched_count} other keyword{breakdownData.unmatched_count !== 1 ? "s" : ""} active but not matched in this post
                        </p>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}

            {/* AI analysis panel */}
            {analysisOpen && analysisData && (
              <div className="border border-violet-500/20 rounded-md bg-violet-950/10 overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-2 px-4 py-2.5 border-b border-violet-500/15 bg-violet-500/5">
                  <Brain className="h-3 w-3 text-violet-400" />
                  <span className="text-[10px] font-mono font-bold text-violet-400 tracking-wider">OUTREACH_BRAIN</span>
                  <div className="ml-auto flex items-center gap-2">
                    <span className={cn("text-[10px] font-mono flex items-center gap-1", URGENCY_COLOR[analysisData.urgency])}>
                      <Zap className="h-2.5 w-2.5" />
                      {analysisData.urgency} URGENCY
                    </span>
                    <span className="text-[10px] font-mono text-muted-foreground">{analysisData.tech_level.replace("_", " ")}</span>
                  </div>
                </div>

                <div className="p-4 space-y-4">
                  {/* summary */}
                  <div>
                    <div className="text-[10px] font-mono text-muted-foreground/60 mb-1 tracking-widest">WHAT_THEY_NEED</div>
                    <p className="text-sm text-foreground/90 leading-relaxed">{analysisData.summary}</p>
                  </div>

                  {/* recommended approach */}
                  <div className="grid grid-cols-2 gap-3">
                    <div className="bg-muted/30 rounded px-3 py-2">
                      <div className="text-[9px] font-mono text-muted-foreground/60 mb-1 tracking-widest">CHANNEL</div>
                      <div className="text-xs font-mono text-foreground font-semibold">{CHANNEL_LABEL[analysisData.recommended_channel]}</div>
                    </div>
                    <div className="bg-muted/30 rounded px-3 py-2">
                      <div className="text-[9px] font-mono text-muted-foreground/60 mb-1 tracking-widest">STYLE</div>
                      <div className="text-xs font-mono text-violet-400 font-semibold">{analysisData.recommended_style}</div>
                    </div>
                  </div>

                  {/* reasoning */}
                  <div>
                    <div className="text-[10px] font-mono text-muted-foreground/60 mb-1 tracking-widest">REASONING</div>
                    <p className="text-xs text-foreground/80 leading-relaxed">{analysisData.reasoning}</p>
                  </div>

                  {/* opening hook + copy */}
                  <div className="border border-violet-500/20 rounded px-3 py-2.5 bg-violet-500/5">
                    <div className="flex items-center justify-between mb-1.5">
                      <div className="text-[9px] font-mono text-violet-400/80 tracking-widest">OPENING_HOOK</div>
                      <CopyButton text={analysisData.opening_hook} />
                    </div>
                    <p className="text-sm text-foreground/90 italic">"{analysisData.opening_hook}"</p>
                  </div>

                  {/* key angles */}
                  <div>
                    <div className="text-[10px] font-mono text-muted-foreground/60 mb-2 tracking-widest">KEY_ANGLES</div>
                    <ul className="space-y-1.5">
                      {analysisData.key_angles.map((angle, i) => (
                        <li key={i} className="flex items-start gap-2 text-xs text-foreground/80">
                          <Target className="h-3 w-3 text-violet-400 mt-0.5 shrink-0" />
                          {angle}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* avoid */}
                  {analysisData.avoid.length > 0 && (
                    <div>
                      <div className="text-[10px] font-mono text-muted-foreground/60 mb-2 tracking-widest">AVOID</div>
                      <ul className="space-y-1.5">
                        {analysisData.avoid.map((item, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-muted-foreground">
                            <AlertTriangle className="h-3 w-3 text-amber-500/60 mt-0.5 shrink-0" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* enrichment panel */}
            {enrichOpen && enrichData && (
              <div className="border border-emerald-500/20 rounded-md bg-emerald-950/10 overflow-hidden" onClick={e => e.stopPropagation()}>
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
                  {enrichData.company && <EnrichRow icon={<Building2 className="h-3 w-3" />} label="COMPANY" value={enrichData.company} />}
                  {enrichData.emails.map((e, i) => <EnrichRow key={i} icon={<Mail className="h-3 w-3" />} label="EMAIL" value={e} copyable />)}
                  {enrichData.phones.map((p, i) => <EnrichRow key={i} icon={<Phone className="h-3 w-3" />} label="PHONE" value={p} copyable />)}
                  {enrichData.source_profile?.website && <EnrichRow icon={<Globe className="h-3 w-3" />} label="WEBSITE" value={enrichData.source_profile.website} href={enrichData.source_profile.website} />}
                  {enrichData.urls.slice(0, 3).map((u, i) => {
                    try {
                      return <EnrichRow key={i} icon={<Globe className="h-3 w-3" />} label="URL" value={new URL(u).hostname.replace("www.", "")} href={u} />;
                    } catch { return null; }
                  })}
                  {enrichData.source_profile?.profile_url && <EnrichRow icon={<User className="h-3 w-3" />} label="PROFILE" value={enrichData.source_profile.profile_url} href={enrichData.source_profile.profile_url} />}
                </div>
                {enrichData.source_profile?.bio && (
                  <div className="px-4 pb-4">
                    <div className="text-[10px] font-mono text-muted-foreground mb-1">BIO</div>
                    <p className="text-xs text-foreground/80 leading-relaxed line-clamp-3">{enrichData.source_profile.bio}</p>
                  </div>
                )}
                {!enrichData.company && enrichData.emails.length === 0 && enrichData.phones.length === 0 && !enrichData.source_profile?.website && (
                  <p className="px-4 pb-4 text-xs text-muted-foreground font-mono">No contact info found in post or public profile.</p>
                )}
              </div>
            )}

            {/* variant reply tabs */}
            {variants && variants.length > 0 && (
              <div className="mt-1 border border-primary/20 rounded-md overflow-hidden" onClick={e => e.stopPropagation()}>
                <div className="flex border-b border-border/60 bg-muted/20">
                  {variants.map((v, i) => (
                    <button key={v.label} onClick={() => setActiveTab(i)} className={cn(
                      "flex-1 px-3 py-2 text-[10px] font-mono font-bold tracking-wider transition-colors",
                      activeTab === i ? "bg-primary/10 text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
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
                      <div className="flex items-center gap-2">
                        {mailtoHref && (
                          <Button size="sm" variant="outline" className="h-7 text-xs font-mono border-emerald-500/40 text-emerald-400" asChild>
                            <a href={mailtoHref}><Send className="h-3 w-3 mr-1.5" />SEND_EMAIL</a>
                          </Button>
                        )}
                        <Button size="sm" className="h-7 text-xs font-mono bg-primary text-primary-foreground hover:bg-primary/90" onClick={() => handleCopy(activeVariant.message, activeTab)}>
                          {copiedIndex === activeTab ? <><Check className="h-3 w-3 mr-1.5" />COPIED</> : <><Copy className="h-3 w-3 mr-1.5" />COPY</>}
                        </Button>
                      </div>
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

interface ScoreBarProps {
  phrase: string;
  score: number;
  isPrimary: boolean;
}

function ScoreBar({ phrase, score, isPrimary }: ScoreBarProps) {
  const pct = Math.round((score / 10) * 100);
  const barColor = score >= 8 ? "bg-primary" : score >= 5 ? "bg-amber-500" : "bg-muted-foreground/40";
  return (
    <div className={cn(
      "rounded px-3 py-2 border",
      isPrimary ? "border-cyan-500/30 bg-cyan-500/5" : "border-border/40 bg-muted/10"
    )}>
      <div className="flex items-center justify-between mb-1.5 gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Hash className="h-2.5 w-2.5 text-cyan-400/60 shrink-0" />
          <span className="text-xs font-mono text-foreground/90 truncate">{phrase}</span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isPrimary && (
            <span className="text-[9px] font-mono text-cyan-400 bg-cyan-400/10 border border-cyan-400/20 px-1.5 py-0.5 rounded tracking-wider">
              WINNER
            </span>
          )}
          <span className={cn(
            "text-xs font-mono font-bold",
            score >= 8 ? "text-primary" : score >= 5 ? "text-amber-500" : "text-muted-foreground"
          )}>
            {score}/10
          </span>
        </div>
      </div>
      <div className="h-1 rounded-full bg-muted/40 overflow-hidden">
        <div className={cn("h-full rounded-full transition-all", barColor)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }}
      className="text-muted-foreground hover:text-foreground transition-colors"
    >
      {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
    </button>
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
  return (
    <div className="flex items-start gap-2 min-w-0">
      <div className="text-emerald-400/60 mt-0.5 shrink-0">{icon}</div>
      <div className="min-w-0 flex-1">
        <div className="text-[9px] font-mono text-muted-foreground/60 tracking-widest mb-0.5">{label}</div>
        {href
          ? <a href={href} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline truncate block font-mono">{value}</a>
          : <span className="text-xs text-foreground font-mono truncate block">{value}</span>
        }
      </div>
      {copyable && (
        <button
          onClick={async e => {
            e.preventDefault();
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          }}
          className="shrink-0 text-muted-foreground hover:text-foreground transition-colors mt-0.5"
        >
          {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
        </button>
      )}
    </div>
  );
}
