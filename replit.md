# Intent Engine — Workspace

## Overview

pnpm workspace monorepo using TypeScript. Full-stack lead generation tool that scrapes multiple platforms for buying-intent signals, scores them with configurable keywords, and generates outreach responses.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec → `lib/api-spec/openapi.yaml`)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + wouter + TanStack Query + shadcn/ui

## Artifacts

| Path | Kind | Description |
|------|------|-------------|
| `artifacts/api-server` | api | Express 5 REST API, port 8080, path `/api` |
| `artifacts/intent-engine` | web | React+Vite frontend, path `/` |

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec (run after any spec change)
- `pnpm --filter @workspace/db run push-force` — push DB schema changes (dev)
- `pnpm --filter @workspace/api-server run build` — build API server

## Lead Sources

Sources are aggregated in `artifacts/api-server/src/lib/sources/index.ts`:

| Source | File | Status | Notes |
|--------|------|--------|-------|
| Reddit | `lib/sources/../reddit.ts` | Active (fallback to examples when 403) | Searches r/entrepreneur, r/startups, etc. |
| Hacker News | `lib/sources/hacker-news.ts` | Active (live via Algolia API) | No auth required |
| X / Twitter | `lib/sources/twitter.ts` | Inactive until `TWITTER_BEARER_TOKEN` env var is set | Twitter API v2 |

## Database Schema

Tables in `lib/db/src/schema/`:
- `saved_leads` — bookmarked leads with `status` (new/contacted/following_up/closed)
- `keywords` — intent keywords with phrase, score (1-10), category, enabled flag

## Important Patterns

- **Route registration order matters** — in `routes/index.ts`, specific routes (`/keywords/test`) must be registered before parameterized ones (`/keywords/:id`)
- **Codegen naming** — request body schemas use `CreateXInput` naming in OpenAPI; Orval generates mutation body Zod schema as `CreateXBody` (operationId-based)
- **Scorer cache** — `lib/scorer.ts` caches active keywords for 60s; call `invalidateScorerCache()` after keyword changes
- **Lead cache** — `routes/leads.ts` caches all-source results for 5 min; `POST /leads/refresh` force-invalidates

## Features

- Dashboard with live stats (total signals, high/medium/low intent, avg score)
- Auto-refresh scheduler (15m/30m/1h) with live "last updated" timestamp
- Lead Explorer with score, source, and subreddit filters
- Keyword bank (48 defaults, 3 tiers) with live phrase tester
- Saved leads with outreach pipeline status (New→Contacted→Following Up→Closed)
- Generate AI outreach reply per lead with one-click copy to clipboard
- Multi-source aggregation: Reddit + Hacker News (live) + Twitter/X (optional key)
