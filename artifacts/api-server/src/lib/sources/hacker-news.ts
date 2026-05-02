import { logger } from "../logger";
import { score, intentLabel } from "../scorer";
import { createHash } from "crypto";
import type { ScoredLead } from "../types";

const QUERIES = [
  "looking for tool recommendation",
  "alternatives to",
  "best software for",
  "need help choosing",
  "recommend a good",
  "struggling with workflow",
  "automate",
  "outreach tool",
  "what do you use for",
  "anyone using",
];

function makeId(text: string, url: string | null): string {
  return createHash("md5")
    .update(`hn:${text}${url ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}

interface HNHit {
  objectID: string;
  comment_text?: string;
  story_text?: string;
  title?: string;
  url?: string;
  story_url?: string;
  author?: string;
  created_at?: string;
  story_id?: number;
}

export async function fetchHackerNewsLeads(): Promise<ScoredLead[]> {
  const results: ScoredLead[] = [];
  const seen = new Set<string>();

  for (const query of QUERIES) {
    try {
      const apiUrl = `https://hn.algolia.com/api/v1/search?query=${encodeURIComponent(query)}&tags=(comment,story)&hitsPerPage=12`;
      const res = await fetch(apiUrl, {
        headers: { "User-Agent": "intent-engine/1.0" },
        signal: AbortSignal.timeout(5000),
      });

      if (!res.ok) {
        logger.warn({ status: res.status, query }, "HN fetch failed");
        continue;
      }

      const data = (await res.json()) as { hits: HNHit[] };

      for (const hit of data.hits) {
        const rawText = hit.comment_text
          ? hit.comment_text.replace(/<[^>]+>/g, " ").trim()
          : `${hit.title ?? ""} ${hit.story_text ?? ""}`.trim();

        if (!rawText || rawText.length < 20) continue;

        const storyId = hit.story_id ?? hit.objectID;
        const postUrl = hit.url ?? hit.story_url ?? `https://news.ycombinator.com/item?id=${storyId}`;

        const id = makeId(rawText, postUrl);
        if (seen.has(id)) continue;
        seen.add(id);

        const intentScore = score(rawText);
        results.push({
          id,
          source: "hacker_news",
          text: rawText.slice(0, 500),
          url: postUrl,
          contact: null,
          subreddit: null,
          author: hit.author ?? null,
          created_at: hit.created_at ?? new Date().toISOString(),
          intent_score: intentScore,
          intent_label: intentLabel(intentScore),
          saved: false,
        });
      }
    } catch (err) {
      logger.error({ err, query }, "Error fetching HN leads");
    }
  }

  return results.sort((a, b) => b.intent_score - a.intent_score);
}

export function getExampleHNLeads(): ScoredLead[] {
  const examples = [
    {
      text: "Ask HN: What tool do you use for automating cold outreach? Looking for something with better deliverability than what I'm using now.",
      url: "https://news.ycombinator.com/item?id=39000001",
      author: "indie_hacker_xyz",
    },
    {
      text: "We tried 5 alternatives to Salesforce and none of them worked well for a team under 10 people. Any recommendations for a lightweight CRM?",
      url: "https://news.ycombinator.com/item?id=39000002",
      author: "smallteam_founder",
    },
    {
      text: "Is there a good open-source tool for scraping and scoring leads based on intent signals? We're spending too much on commercial options.",
      url: "https://news.ycombinator.com/item?id=39000003",
      author: "bootstrapped_saas",
    },
  ];

  return examples.map((ex, i) => {
    const intentScore = score(ex.text);
    return {
      id: makeId(ex.text, ex.url),
      source: "hacker_news",
      text: ex.text,
      url: ex.url,
      contact: null,
      subreddit: null,
      author: ex.author,
      created_at: new Date(Date.now() - i * 7200000).toISOString(),
      intent_score: intentScore,
      intent_label: intentLabel(intentScore),
      saved: false,
    };
  });
}
