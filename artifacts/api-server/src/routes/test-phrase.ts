import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, keywordsTable } from "@workspace/db";
import { intentLabel } from "../lib/scorer";

const router: IRouter = Router();

router.post("/keywords/test", async (req, res): Promise<void> => {
  const { phrase } = req.body as { phrase?: string };

  if (!phrase || typeof phrase !== "string") {
    res.status(400).json({ error: "phrase is required" });
    return;
  }

  const t = phrase.toLowerCase();

  const activeKeywords = await db
    .select()
    .from(keywordsTable)
    .where(eq(keywordsTable.enabled, true));

  // Sort by score descending so we match the highest-scoring keyword first
  const sorted = activeKeywords.sort((a, b) => b.score - a.score);

  const allMatches: Array<{ id: string; phrase: string; score: number }> = [];
  let topScore = 3;
  let matchedKeyword: string | null = null;
  let matchedKeywordId: string | null = null;

  for (const kw of sorted) {
    if (t.includes(kw.phrase)) {
      allMatches.push({ id: kw.id, phrase: kw.phrase, score: kw.score });
      if (allMatches.length === 1) {
        topScore = kw.score;
        matchedKeyword = kw.phrase;
        matchedKeywordId = kw.id;
      }
    }
  }

  res.json({
    phrase,
    score: topScore,
    intent_label: intentLabel(topScore),
    matched_keyword: matchedKeyword,
    matched_keyword_id: matchedKeywordId,
    all_matches: allMatches,
  });
});

export default router;
