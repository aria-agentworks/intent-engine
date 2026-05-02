import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, savedLeadsTable } from "@workspace/db";
import {
  GetLeadsQueryParams,
  GetLeadsResponse,
  GetLeadsStatsResponse,
  GetSavedLeadsResponse,
  SaveLeadParams,
  SaveLeadResponse,
  GenerateResponseParams,
  GenerateResponseResponse,
  GetSourcesResponse,
  UpdateLeadStatusParams,
  UpdateLeadStatusBody,
  UpdateLeadStatusResponse,
} from "@workspace/api-zod";
import { fetchAllLeads } from "../lib/sources/index";
import type { SourceMeta } from "../lib/sources/index";
import { generateResponse, generateVariants } from "../lib/responder";
import type { ScoredLead } from "../lib/types";

const router: IRouter = Router();

let cachedLeads: ScoredLead[] = [];
let cachedSourceMeta: SourceMeta[] = [];
let lastFetchedAt: Date | null = null;

async function getLeads(): Promise<ScoredLead[]> {
  const now = new Date();
  const stale = !lastFetchedAt || now.getTime() - lastFetchedAt.getTime() > 5 * 60 * 1000;

  if (stale) {
    const { leads, sourceMeta } = await fetchAllLeads();
    cachedLeads = leads;
    cachedSourceMeta = sourceMeta;
    lastFetchedAt = now;
  }

  const savedIds = new Set<string>();
  try {
    const saved = await db.select({ id: savedLeadsTable.id }).from(savedLeadsTable);
    saved.forEach((s) => savedIds.add(s.id));
  } catch {
    // DB might not be ready yet
  }

  return cachedLeads.map((l) => ({ ...l, saved: savedIds.has(l.id) }));
}

router.get("/leads", async (req, res): Promise<void> => {
  const query = GetLeadsQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const { min_score = 0, source, subreddit, limit = 50 } = query.data;
  let leads = await getLeads();

  if (min_score > 0) {
    leads = leads.filter((l) => l.intent_score >= min_score);
  }
  if (source) {
    leads = leads.filter((l) => l.source === source);
  }
  if (subreddit) {
    leads = leads.filter((l) => l.subreddit?.toLowerCase().includes(subreddit.toLowerCase()));
  }

  leads = leads.slice(0, limit);

  res.json(
    GetLeadsResponse.parse({
      leads,
      total: leads.length,
      fetched_at: lastFetchedAt?.toISOString() ?? new Date().toISOString(),
    })
  );
});

router.post("/leads/refresh", async (_req, res): Promise<void> => {
  lastFetchedAt = null;
  const leads = await getLeads();

  res.json(
    GetLeadsResponse.parse({
      leads,
      total: leads.length,
      fetched_at: lastFetchedAt?.toISOString() ?? new Date().toISOString(),
    })
  );
});

router.get("/leads/stats", async (_req, res): Promise<void> => {
  const leads = await getLeads();

  const high = leads.filter((l) => l.intent_score >= 8).length;
  const medium = leads.filter((l) => l.intent_score >= 5 && l.intent_score < 8).length;
  const low = leads.filter((l) => l.intent_score < 5).length;

  const bySourceMap = new Map<string, number>();
  for (const l of leads) {
    bySourceMap.set(l.source, (bySourceMap.get(l.source) ?? 0) + 1);
  }

  const savedRows = await db.select().from(savedLeadsTable);
  const avgScore = leads.length > 0
    ? leads.reduce((acc, l) => acc + l.intent_score, 0) / leads.length
    : 0;

  res.json(
    GetLeadsStatsResponse.parse({
      total_leads: leads.length,
      high_intent: high,
      medium_intent: medium,
      low_intent: low,
      saved_count: savedRows.length,
      by_source: Array.from(bySourceMap.entries()).map(([source, count]) => ({ source, count })),
      avg_score: Math.round(avgScore * 10) / 10,
      last_run: lastFetchedAt?.toISOString() ?? null,
    })
  );
});

router.get("/leads/saved", async (_req, res): Promise<void> => {
  const savedRows = await db.select().from(savedLeadsTable);

  const leads = savedRows.map((row) => ({
    id: row.id,
    source: row.source,
    text: row.text,
    url: row.url ?? null,
    contact: row.contact ?? null,
    intent_score: parseInt(row.intentScore, 10),
    intent_label: row.intentLabel,
    subreddit: row.subreddit ?? null,
    author: row.author ?? null,
    created_at: row.createdAt.toISOString(),
    saved: true,
    status: row.status ?? "new",
  }));

  res.json(
    GetSavedLeadsResponse.parse({
      leads,
      total: leads.length,
      fetched_at: new Date().toISOString(),
    })
  );
});

router.patch("/leads/:id/status", async (req, res): Promise<void> => {
  const params = UpdateLeadStatusParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateLeadStatusBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const { id } = params.data;
  const { status } = body.data;

  const existing = await db.select().from(savedLeadsTable).where(eq(savedLeadsTable.id, id));
  if (existing.length === 0) {
    res.status(404).json({ error: "Saved lead not found" });
    return;
  }

  await db.update(savedLeadsTable).set({ status }).where(eq(savedLeadsTable.id, id));
  res.json(UpdateLeadStatusResponse.parse({ id, status }));
});

router.post("/leads/:id/save", async (req, res): Promise<void> => {
  const params = SaveLeadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { id } = params.data;
  const existing = await db
    .select()
    .from(savedLeadsTable)
    .where(eq(savedLeadsTable.id, id));

  if (existing.length > 0) {
    await db.delete(savedLeadsTable).where(eq(savedLeadsTable.id, id));
    res.json(SaveLeadResponse.parse({ saved: false, lead_id: id }));
    return;
  }

  const lead = cachedLeads.find((l) => l.id === id);
  if (!lead) {
    res.status(404).json({ error: "Lead not found" });
    return;
  }

  await db.insert(savedLeadsTable).values({
    id: lead.id,
    source: lead.source,
    text: lead.text,
    url: lead.url ?? null,
    contact: lead.contact ?? null,
    intentScore: String(lead.intent_score),
    intentLabel: lead.intent_label,
    subreddit: lead.subreddit ?? null,
    author: lead.author ?? null,
    saved: true,
    createdAt: new Date(lead.created_at),
  });

  res.json(SaveLeadResponse.parse({ saved: true, lead_id: id }));
});

router.post("/leads/:id/respond", async (req, res): Promise<void> => {
  const params = GenerateResponseParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const { id } = params.data;
  const lead = cachedLeads.find((l) => l.id === id);

  if (!lead) {
    const [saved] = await db.select().from(savedLeadsTable).where(eq(savedLeadsTable.id, id));
    if (!saved) {
      res.status(404).json({ error: "Lead not found" });
      return;
    }
    const variants = generateVariants(saved.text, saved.source);
    res.json(GenerateResponseResponse.parse({ message: variants[0].message, variants, lead_id: id }));
    return;
  }

  const variants = generateVariants(lead.text, lead.source);
  res.json(GenerateResponseResponse.parse({ message: variants[0].message, variants, lead_id: id }));
});

router.get("/sources", async (_req, res): Promise<void> => {
  // Ensure we have fresh source meta by calling getLeads if not yet cached
  if (cachedSourceMeta.length === 0) {
    await getLeads();
  }
  res.json(GetSourcesResponse.parse({ sources: cachedSourceMeta }));
});

export default router;
