import { useState } from "react";
import { format } from "date-fns";
import {
  Bookmark, BookmarkCheck, ExternalLink, Bot, Copy, Check, Square, CheckSquare, Sparkles, Mail, Phone, Globe, Building2,
  User, Star, Brain, Send, AlertTriangle, Zap, Target, BarChart2
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
  const [nurtureLoading, setNurtureLoading] = useState(false);
  const [nurtureSequence, setNurtureSequence] = useState<{ subject: string; emails: { step: number; subject: string; message: string }[] } | null>(null);

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
    useEnrichLead(lead.id, { query: { enabled: false } as any });

  const { data: analysisData, isFetching: analyzeLoading, refetch: fetchAnalysis, isSuccess: analyzed } =
    useAnalyzeLead(lead.id, { query: { enabled: false } as any }) as any;

  const { data: breakdownData, isFetching: breakdownLoading, refetch: fetchBreakdown, isSuccess: brokenDown } =
    useGetLeadScoreBreakdown(lead.id, { query: { enabled: false } as any });

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

  const handleNurture = async () => {
    setNurtureLoading(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}/nurture`);
      const data = await res.json();
      setNurtureSequence(data.sequence);
      toast({ title: "Nurture sequence ready", description: "Generated a 3-step follow-up sequence." });
    } finally {
      setNurtureLoading(false);
    }
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

        <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap font-sans">
          "{lead.text}"
        </div>

        {!selectMode && (
          <>
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
                <Button variant="outline" size="sm" className="h-8 text-xs font-mono border-fuchsia-500/40 text-fuchsia-400 hover:border-fuchsia-500/70" onClick={handleNurture} disabled={nurtureLoading}>{nurtureLoading ? "BUILDING_SEQUENCE..." : "NURTURE_SEQUENCE"}</Button>
              </div>
              <div className="flex items-center gap-2">{mailtoHref && <Button size="sm" variant="outline" className="h-8 text-xs font-mono border-emerald-500/40 text-emerald-400 hover:border-emerald-500/70" asChild><a href={mailtoHref}><Send className="h-3 w-3 mr-2" />SEND_EMAIL</a></Button>} {!variants && <Button variant="secondary" size="sm" className="h-8 text-xs font-mono" onClick={handleGenerateResponse} disabled={generateResponse.isPending}>{generateResponse.isPending ? <span className="animate-pulse">GENERATING...</span> : <><Bot className="h-3 w-3 mr-2" />GENERATE_REPLY</>}</Button>}</div>
            </div>

            {nurtureSequence && (
              <div className="border border-fuchsia-500/20 rounded-md bg-fuchsia-950/10 p-4 space-y-3" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                  <div className="text-[10px] font-mono font-bold tracking-wider text-fuchsia-400">NURTURE_SEQUENCE</div>
                  <Button variant="ghost" size="sm" className="h-7 text-xs font-mono text-muted-foreground" onClick={() => setNurtureSequence(null)}>CLOSE</Button>
                </div>
                {nurtureSequence.emails.map((email) => (
                  <div key={email.step} className="border border-border/60 rounded p-3 bg-background/40">
                    <div className="text-[10px] font-mono text-muted-foreground mb-1">STEP {email.step} · {email.subject}</div>
                    <p className="text-sm text-foreground/90 whitespace-pre-wrap">{email.message}</p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return <Button variant="ghost" size="icon" className="h-6 w-6" onClick={async () => { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1400); }}>{copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}</Button>;
}

function EnrichRow({ icon, label, value, href, copyable }: { icon: React.ReactNode; label: string; value: string; href?: string; copyable?: boolean }) {
  return <div className="flex items-start gap-2 text-xs"><div className="text-muted-foreground mt-0.5">{icon}</div><div className="min-w-0 flex-1"><div className="text-[9px] font-mono text-muted-foreground/60 mb-0.5">{label}</div>{href ? <a href={href} target="_blank" rel="noreferrer" className="text-foreground/90 hover:underline break-all">{value}</a> : <div className="flex items-center gap-2"><span className="text-foreground/90 break-all">{value}</span>{copyable && <CopyButton text={value} />}</div>}</div></div>;
}

function ScoreBar({ phrase, score, isPrimary }: { phrase: string; score: number; isPrimary: boolean }) {
  return <div className="flex items-center gap-3"><span className="text-xs text-foreground/90 min-w-0 flex-1">{phrase}</span><div className="w-24 h-1.5 rounded-full bg-muted overflow-hidden"><div className={cn("h-full rounded-full", isPrimary ? "bg-cyan-400" : "bg-cyan-500/60")} style={{ width: `${Math.min(100, score * 10)}%` }} /></div><span className="text-[10px] font-mono text-muted-foreground w-7 text-right">{score}</span></div>;
}
