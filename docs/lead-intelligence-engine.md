# Lead Intelligence Engine — Team Update

**Date:** 2026-06-14 · **Status:** Live on `main`, deployed to Vercel, API keys configured
**App:** 1COMMERCE Drone Ops Dashboard · **Owner:** Field Ops

---

## TL;DR

We expanded the dashboard's automation. Leads are now **researched and ranked by
priority automatically** — combining a transparent algorithmic score with an AI
agent that scrapes the web to verify names, crop types, and contact info, and to
recommend the best way for us to approach each grower. Everything writes straight
back into the dashboard, so the lead data stays current without manual entry.

There's nothing to install on your end — just open the **Automation** tab.

---

## What it does (three layers)

1. **Algorithmic prioritization** — every lead gets a transparent **0–100 score**
   and a **P1–P4 tier**, computed from:
   - proximity to Canby, treatable acreage, crop-value fit (hazelnuts/orchards rank highest),
   - EFB / action urgency, revenue potential, pipeline warmth, and how reachable the lead is.
   - You can see the per-factor breakdown on each lead — nothing is a black box.

2. **AI web research + reasoning** — an AI agent searches the web to confirm and
   fill in:
   - business name, owner & primary contact, **crop types**, phone / email / website, acreage,
   - a **"recommended approach for us specifically"** — what service to lead with, timing,
     and the single best way to make contact.
   - It never makes things up: unverifiable fields stay blank, and every value carries a
     confidence score and a source.

3. **Auto-sync** — results write back to the database, so the **Leads**, **Pipeline**,
   **Overview**, and **Automation** pages all reflect the latest intel automatically.

---

## Where to see it

| Page | What's new |
| --- | --- |
| **Automation** (new tab 🤖) | Engine health, coverage stats, priority distribution, top priority leads, run history, and a **Run automation now** button. |
| **Leads** | New **Priority** column + sort, an **Intelligence** panel (recommended approach, completeness, AI confidence), and a **Refresh intel** button per lead. |

---

## How it runs

- **Automatically:** once a day (overnight), the engine picks up the leads that need
  attention — never-researched first, then anything that's gone stale — and refreshes them.
- **On demand:** click **Run automation now** on the Automation page to process a batch
  immediately, or **Refresh intel** on a single lead to re-research just that one.

---

## How to use it day-to-day

- **Work the P1s first.** The Automation page surfaces top-priority leads live; P1 = hottest fit.
- **Read the "recommended approach"** on a lead before reaching out — it's tailored to our
  drone spray / scouting services and this grower.
- **Trust but verify high-value contacts.** Each enriched field shows a confidence %; for a
  big account, sanity-check the phone/email before a cold call.
- **Hit "Refresh intel"** on a lead that feels out of date — it re-runs the research on the spot.

---

## Status & what's left

- ✅ Code merged to `main` (PR #2) and deployed to Vercel
- ✅ Daily schedule active (Vercel Cron)
- ✅ API keys configured (Anthropic + Supabase service role)
- ⏳ **One-time database migration** — if not already applied, run
  `supabase/migrations/20260614000000_lead_intelligence_engine.sql` in
  Supabase → SQL Editor. It's additive and safe; it adds the priority/enrichment
  columns and the run-history table the Automation page reads. *Until this runs, the
  engine still scores leads but can't store the new fields.*

---

## Under the hood (for the technically curious)

- **Engine:** `src/lib/enrichment/` — `priority.ts` (scoring), `research.ts` (AI + web search),
  `apollo.ts` (optional contact booster), `engine.ts` (orchestrator).
- **Endpoints:** `POST /api/enrich/run` (cron + manual), `POST /api/enrich/lead/[id]` (single),
  `GET /api/enrich/status` (health).
- **Schedule:** `vercel.json` → `0 8 * * *` (daily 08:00 UTC). Vercel Hobby allows one run/day;
  on Pro we can bump the frequency.
- **Tuning (optional env vars):** `ENRICHMENT_BATCH_SIZE`, `ENRICHMENT_CONCURRENCY`,
  `ENRICHMENT_STALE_DAYS`, `ENRICHMENT_EFFORT`, `ENRICHMENT_MODEL`.
- **Optional add-on:** set `APOLLO_API_KEY` to layer in Apollo.io contact data.

---

## Cost note

AI research runs per lead, batched daily. Cost scales with how many leads are processed
each run (`ENRICHMENT_BATCH_SIZE`, default 6/run) and the reasoning effort
(`ENRICHMENT_EFFORT`, default `medium`). Start conservative and raise the batch size once
we're comfortable with the spend.

---

*Questions or want a field added to the research output? Ping Field Ops.*
