import { logger } from "../logger";
import { score, intentLabel } from "../scorer";
import { createHash } from "crypto";
import type { ScoredLead } from "../types";

const BEARER_TOKEN = process.env.TWITTER_BEARER_TOKEN;

export function isTwitterActive(): boolean {
  return Boolean(BEARER_TOKEN);
}

const QUERIES = [
  "looking for tool recommendation -is:retweet lang:en",
  "alternatives to software -is:retweet lang:en",
  "best app for workflow -is:retweet lang:en",
  "anyone recommend CRM -is:retweet lang:en",
  "struggling with outreach tool -is:retweet lang:en",
];

function makeId(text: string, tweetId: string): string {
  return createHash("md5")
    .update(`twitter:${tweetId}${text}`)
    .digest("hex")
    .slice(0, 16);
}

interface Tweet {
  id: string;
  text: string;
  created_at?: string;
  author_id?: string;
}

interface TwitterResponse {
  data?: Tweet[];
  errors?: Array<{ message: string }>;
}

export async function fetchTwitterLeads(): Promise<ScoredLead[]> {
  if (!BEARER_TOKEN) return [];

  const results: ScoredLead[] = [];
  const seen = new Set<string>();

  for (const q of QUERIES) {
    try {
      const params = new URLSearchParams({
        query: q,
        max_results: "10",
        "tweet.fields": "created_at,author_id,text",
      });
      const res = await fetch(`https://api.twitter.com/2/tweets/search/recent?${params}`, {
        headers: {
          Authorization: `Bearer ${BEARER_TOKEN}`,
          "User-Agent": "intent-engine/1.0",
        },
        signal: AbortSignal.timeout(8000),
      });

      if (!res.ok) {
        logger.warn({ status: res.status, q }, "Twitter fetch failed");
        continue;
      }

      const data = (await res.json()) as TwitterResponse;
      if (!data.data) continue;

      for (const tweet of data.data) {
        if (!tweet.text || tweet.text.length < 20) continue;

        const id = makeId(tweet.text, tweet.id);
        if (seen.has(id)) continue;
        seen.add(id);

        const intentScore = score(tweet.text);
        results.push({
          id,
          source: "twitter",
          text: tweet.text.slice(0, 500),
          url: `https://twitter.com/i/web/status/${tweet.id}`,
          contact: tweet.author_id ? `@user_${tweet.author_id}` : null,
          subreddit: null,
          author: tweet.author_id ?? null,
          created_at: tweet.created_at ?? new Date().toISOString(),
          intent_score: intentScore,
          intent_label: intentLabel(intentScore),
          saved: false,
        });
      }
    } catch (err) {
      logger.error({ err, q }, "Error fetching Twitter leads");
    }
  }

  return results.sort((a, b) => b.intent_score - a.intent_score);
}
