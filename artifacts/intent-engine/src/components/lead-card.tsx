import { useState } from "react";
import { format } from "date-fns";
import { Bookmark, BookmarkCheck, ExternalLink, Bot, Copy, Check } from "lucide-react";
import { SiReddit, SiX, SiGithub, SiHackerone, SiYcombinator } from "react-icons/si";
import { Lead } from "@workspace/api-client-react/src/generated/api.schemas";
import { useSaveLead, getGetSavedLeadsQueryKey, getGetLeadsQueryKey, useGenerateResponse } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

interface LeadCardProps {
  lead: Lead;
  statusSelector?: React.ReactNode;
}

export function LeadCard({ lead, statusSelector }: LeadCardProps) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const saveLead = useSaveLead();
  const generateResponse = useGenerateResponse();
  const [response, setResponse] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const isHigh = lead.intent_score >= 8;
  const isMedium = lead.intent_score >= 5 && lead.intent_score < 8;

  const handleCopy = async () => {
    if (!response) return;
    await navigator.clipboard.writeText(response);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
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
          toast({
            title: "Error",
            description: "Failed to update saved status.",
            variant: "destructive",
          });
        }
      }
    );
  };

  const handleGenerateResponse = () => {
    generateResponse.mutate(
      { id: lead.id },
      {
        onSuccess: (data) => {
          setResponse(data.message);
        },
        onError: () => {
          toast({
            title: "Generation Failed",
            description: "Could not generate AI response.",
            variant: "destructive",
          });
        }
      }
    );
  };

  const SourceIcon = () => {
    const s = lead.source.toLowerCase();
    if (s.includes('reddit')) return <SiReddit className="text-[#FF4500] h-4 w-4" />;
    if (s.includes('twitter') || s.includes('x')) return <SiX className="h-4 w-4 text-foreground" />;
    if (s.includes('github')) return <SiGithub className="h-4 w-4 text-foreground" />;
    if (s === 'hacker_news' || s.includes('hacker news') || s.includes('hackernews')) return <SiYcombinator className="text-[#FF6600] h-4 w-4" />;
    if (s.includes('hacker')) return <SiHackerone className="h-4 w-4 text-foreground" />;
    return <span className="text-xs uppercase text-muted-foreground">[{lead.source}]</span>;
  };

  return (
    <div className="border border-border bg-card rounded-md overflow-hidden flex flex-col relative group transition-colors hover:border-primary/50">
      <div className="absolute top-0 left-0 w-1 h-full" style={{ 
        backgroundColor: isHigh ? 'var(--chart-1)' : isMedium ? 'var(--chart-2)' : 'var(--chart-3)' 
      }} />
      
      <div className="p-5 pl-6 flex flex-col gap-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded bg-muted/50 border border-border">
              <SourceIcon />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-foreground">{lead.author || "Anonymous"}</span>
                {lead.subreddit && (
                  <span className="text-xs text-muted-foreground bg-muted px-1.5 py-0.5 rounded">r/{lead.subreddit}</span>
                )}
              </div>
              <div className="text-xs text-muted-foreground mt-1">
                {format(new Date(lead.created_at), "MMM d, yyyy • h:mm a")}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {statusSelector}
            <Badge variant="outline" className={cn(
              "font-mono rounded-sm px-2",
              isHigh ? "border-primary/50 text-primary bg-primary/10" :
              isMedium ? "border-amber-500/50 text-amber-500 bg-amber-500/10" :
              "border-muted-foreground/30 text-muted-foreground"
            )}>
              SCORE: {lead.intent_score}/10
            </Badge>
            <Button
              variant="ghost"
              size="icon"
              className={cn("h-8 w-8", lead.saved && "text-primary hover:text-primary/80")}
              onClick={handleSave}
              disabled={saveLead.isPending}
            >
              {lead.saved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
            </Button>
          </div>
        </div>

        <div className="text-sm leading-relaxed text-foreground/90 whitespace-pre-wrap font-sans">
          "{lead.text}"
        </div>

        <div className="flex items-center justify-between mt-2 pt-4 border-t border-border/50">
          <div className="flex items-center gap-2">
            {lead.url && (
              <Button variant="outline" size="sm" className="h-8 text-xs font-mono" asChild>
                <a href={lead.url} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-3 w-3 mr-2" />
                  OPEN_SOURCE
                </a>
              </Button>
            )}
          </div>
          <Button 
            variant="secondary" 
            size="sm" 
            className="h-8 text-xs font-mono"
            onClick={handleGenerateResponse}
            disabled={generateResponse.isPending || !!response}
          >
            {generateResponse.isPending ? (
              <span className="animate-pulse">GENERATING...</span>
            ) : (
              <>
                <Bot className="h-3 w-3 mr-2" />
                GENERATE_REPLY
              </>
            )}
          </Button>
        </div>

        {response && (
          <div className="mt-2 p-3 bg-muted/30 border border-primary/20 rounded-md relative">
            <div className="absolute -top-2.5 left-4 bg-background px-1 text-[10px] text-primary font-bold tracking-wider">
              AI_GENERATED_RESPONSE
            </div>
            <p className="text-sm font-sans text-foreground/90 mt-1">{response}</p>
            <div className="flex justify-end mt-3">
              <Button size="sm" className="h-7 text-xs bg-primary text-primary-foreground hover:bg-primary/90" onClick={handleCopy}>
                {copied ? <Check className="h-3 w-3 mr-2" /> : <Copy className="h-3 w-3 mr-2" />}
                {copied ? "COPIED" : "COPY"}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
