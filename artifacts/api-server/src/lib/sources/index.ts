import { fetchRedditLeads, getExampleLeads } from "../reddit";
import { fetchHackerNewsLeads, getExampleHNLeads } from "./hacker-news";
import { fetchTwitterLeads, isTwitterActive } from "./twitter";
import { logger } from "../logger";
import type { ScoredLead } from "../types";

export interface SourceMeta {
  id: string;
  name: string;
  active: boolean;
  description: string;
  count: number;
}

export async function fetchAllLeads(): Promise<{ leads: ScoredLead[]; sourceMeta: SourceMeta[] }> {
  const [redditLeads, hnLeads, twitterLeads] = await Promise.allSettled([
    fetchRedditLeads(),
    fetchHackerNewsLeads(),
    isTwitterActive() ? fetchTwitterLeads() : Promise.resolve([]),
  ]);

  const reddit = redditLeads.status === "fulfilled" ? redditLeads.value : [];
  const hn = hnLeads.status === "fulfilled" ? hnLeads.value : [];
  const twitter = twitterLeads.status === "fulfilled" ? twitterLeads.value : [];

  if (redditLeads.status === "rejected") {
    logger.error({ err: redditLeads.reason }, "Reddit source failed");
  }
  if (hnLeads.status === "rejected") {
    logger.error({ err: hnLeads.reason }, "HN source failed");
  }
  if (twitterLeads.status === "rejected") {
    logger.error({ err: twitterLeads.reason }, "Twitter source failed");
  }

  // Fallback to examples if live fetch produced nothing
  const liveReddit = reddit.length > 0 ? reddit : getExampleLeads();
  const liveHN = hn.length > 0 ? hn : getExampleHNLeads();

  const allLeads = deduplicateByText([...liveReddit, ...liveHN, ...twitter]);
  const sorted = allLeads.sort((a, b) => b.intent_score - a.intent_score);

  const sourceMeta: SourceMeta[] = [
    {
      id: "reddit",
      name: "Reddit",
      active: true,
      description: "Subreddit posts and threads with buying intent signals",
      count: sorted.filter((l) => l.source === "reddit").length,
    },
    {
      id: "hacker_news",
      name: "Hacker News",
      active: true,
      description: "HN posts and comments from founders and developers",
      count: sorted.filter((l) => l.source === "hacker_news").length,
    },
    {
      id: "twitter",
      name: "X / Twitter",
      active: isTwitterActive(),
      description: "Tweets mentioning tools and recommendations (requires API key)",
      count: sorted.filter((l) => l.source === "twitter").length,
    },
  ];

  return { leads: sorted, sourceMeta };
}

function deduplicateByText(leads: ScoredLead[]): ScoredLead[] {
  const seen = new Set<string>();
  return leads.filter((l) => {
    const key = l.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
