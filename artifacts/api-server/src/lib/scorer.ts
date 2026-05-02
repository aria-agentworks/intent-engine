import { db, keywordsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { DEFAULT_KEYWORDS } from "./default-keywords";

let cachedKeywords: Array<{ phrase: string; score: number }> | null = null;
let cacheExpiry = 0;

async function getActiveKeywords(): Promise<Array<{ phrase: string; score: number }>> {
  const now = Date.now();
  if (cachedKeywords && now < cacheExpiry) return cachedKeywords;

  try {
    const rows = await db
      .select()
      .from(keywordsTable)
      .where(eq(keywordsTable.enabled, true));

    if (rows.length > 0) {
      cachedKeywords = rows
        .map((r) => ({ phrase: r.phrase, score: r.score }))
        .sort((a, b) => b.score - a.score);
      cacheExpiry = now + 60_000; // refresh every 60s
      return cachedKeywords;
    }
  } catch {
    // DB not ready yet — fall through to defaults
  }

  return DEFAULT_KEYWORDS
    .filter((k) => k.score >= 5)
    .map((k) => ({ phrase: k.phrase, score: k.score }))
    .sort((a, b) => b.score - a.score);
}

export async function scoreAsync(text: string): Promise<number> {
  const keywords = await getActiveKeywords();
  const t = text.toLowerCase();

  for (const kw of keywords) {
    if (t.includes(kw.phrase)) return kw.score;
  }

  return 3;
}

export interface MatchedKeyword {
  phrase: string;
  score: number;
  is_primary: boolean;
}

export async function scoreBreakdown(text: string): Promise<{
  final_score: number;
  matched: MatchedKeyword[];
  unmatched_count: number;
  total_keywords: number;
  fallback: boolean;
}> {
  const keywords = await getActiveKeywords();
  const t = text.toLowerCase();

  const matched: MatchedKeyword[] = [];
  let primaryFound = false;

  for (const kw of keywords) {
    if (t.includes(kw.phrase)) {
      matched.push({ phrase: kw.phrase, score: kw.score, is_primary: !primaryFound });
      primaryFound = true;
    }
  }

  const final_score = matched.length > 0 ? matched[0].score : 3;
  const unmatched_count = keywords.length - matched.length;

  return {
    final_score,
    matched,
    unmatched_count,
    total_keywords: keywords.length,
    fallback: matched.length === 0,
  };
}

// Sync fallback for callers that can't await (used during cold start)
export function score(text: string): number {
  const t = text.toLowerCase();
  const defaults = DEFAULT_KEYWORDS.sort((a, b) => b.score - a.score);

  for (const kw of defaults) {
    if (t.includes(kw.phrase)) return kw.score;
  }

  return 3;
}

export function invalidateScorerCache() {
  cachedKeywords = null;
  cacheExpiry = 0;
}

export function intentLabel(score: number): string {
  if (score >= 8) return "High Intent";
  if (score >= 5) return "Medium Intent";
  return "Low Intent";
}
