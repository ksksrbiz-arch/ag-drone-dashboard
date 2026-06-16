# Lead Intelligence Engine — Team Update

**Status:** Live on `main`, deployed to Vercel · **App:** 1COMMERCE Drone Ops Dashboard · **Owner:** Field Ops
**Engine version:** `lead-intel-v4`

---

## TL;DR

Every lead is **researched, scored, and ranked automatically**. A transparent
algorithmic score decides *who to work first*, an AI pass writes *how to approach
them* (grounded strictly in the data we already hold — it never makes facts up),
and everything writes straight back into the dashboard. **v3** adds priority
**momentum** (what's rising/falling), sharper signals, a concrete **next best
action** per lead, duplicate detection, and run-level cost tracking.

Nothing to install — open the **Automation** tab.

---

## What it does (three layers)

1. **Algorithmic prioritization** — every lead gets a transparent **0–100 score**,
   a **P1–P4 tier**, a per-factor breakdown, and a one-line *"why this rank"*
   explanation. Signals (ag-spray weighting shown; non-ag verticals reweight to
   scale/reachability automatically):
   - proximity to HQ, treatable acreage, crop-value fit (hazelnuts/orchards rank highest),
   - **EFB / action urgency** — now folds in the spray-window score and the EFB
     **risk trend** (rising pulls a lead forward),
   - **seasonal timing** — is it the treatment season for this crop *right now*?
   - **existing relationship** — repeat/paying customers (from the jobs table) outrank cold names,
   - revenue potential, pipeline warmth, reachability, **engagement recency**, and base lead score.

2. **AI analysis + reasoning (SSOT-grounded)** — the structured lead record is the
   **single source of truth**. The model has **no web access** and must not invent
   facts; it only normalizes values already present and produces advisory output:
   - **recommended_approach** — what to lead with for this grower & vertical,
   - **next_best_action** — the single concrete next step (e.g. *"Call the owner to
     schedule a spring EFB scouting flight"*),
   - **talking_points** — 2–4 grounded points to raise in outreach,
   - **best_contact_method** and a short **research_summary**, each carrying a calibrated confidence.
   - Real contact gaps (phone/email) are filled by the optional **Apollo** booster — an
     actual data source — never hallucinated.

3. **Auto-sync** — results write back to Supabase, so **Leads**, **Pipeline**,
   **Overview**, and **Automation** all reflect the latest intel automatically.

---

## Priority momentum (new in v3)

Each scoring run records the previous score, computes a **delta**, and labels a
**trend** — `up` / `down` / `flat` / `new`. The Automation page surfaces a
**Priority Movers** panel (biggest swings since the last run) and flags leads that
**rose into P1**; the daily digest calls out the biggest gainers too.

---

## History, trends & follow-ups (new in v4)

v3's momentum only compares a lead to its *immediately previous* score. v4 makes
that history durable and turns it into action:

- **Score history** — every scoring run appends a snapshot per lead to
  `lead_score_history` (score, tier, delta, timestamp). The **Leads** detail panel
  draws a **sparkline** of a lead's priority over time.
- **"Heating up"** — the `lead_heating_up` view flags leads whose score rose across
  the **last 3 runs** (a sustained riser, not a one-run blip). Shown on the
  Automation page and counted in the digest. *Needs ~3 runs of history to populate.*
- **Follow-up SLAs** — a `stage_changed_at` timestamp (set by trigger when a lead's
  pipeline stage changes) powers `lead_followups`: engaged leads that have stalled
  past a per-stage SLA (`contacted` 5d · `meeting_scheduled` 3d · `loi_sent` 7d).
  Surfaced as a **Follow-ups Due** panel and a digest section so warm leads don't
  go cold.

---

## Analytics

The **Analytics** tab (`/analytics`, served by `GET /api/analytics`) aggregates
the data the system now captures into one operator view: **engine throughput &
AI-cost trends** per run (from `enrichment_runs`), the **pipeline funnel** with
sign-rate, **priority distribution**, **top crops** by volume + average priority,
and **jobs/revenue**. Read-only — no migration required.

---

## Outreach queue — the action layer

The engine decides *who* to contact and *what* to say; the **Outreach** tab turns
that into **review-first drafts**. Hit **Generate drafts** and it picks the top
outreach-ready leads (not yet past initial contact, hottest first, reachable on
the chosen channel), drafts a personalized email or SMS grounded in each lead's
`recommended_approach` / `next_best_action` / `talking_points`, and queues them.
The operator edits, **Approve**s, **Mark sent**s, or **Dismiss**es — **nothing is
ever sent automatically**. Each lead is queued at most once while a draft is open.

---

## Reliability & ops (new in v3)

- **Per-lead retries with backoff** on transient research failures (`ENRICHMENT_RETRIES`, default 2).
- **Resilient writes** — if a newer column isn't migrated yet, the write degrades
  gracefully (drops the new columns and still lands a score) instead of failing the batch.
- **Cost tracking** — token usage is summed per run and shown in the run history (`ai_tokens`).
- **Richer run summary** — tier mix, fields updated, new-P1 count, top movers, and per-lead errors.
- **Duplicate detection** — leads are clustered by phone / email / name+city. The
  **Merge** action is *non-destructive*: it backfills the strongest record and tags
  the rest `duplicate` (it never deletes — hard deletes stay a manual call because of
  cascading job/customer/field references).

---

## Where to see it

| Page | What's new |
| --- | --- |
| **Automation** 🤖 | Engine health, coverage KPIs, priority distribution, top leads **with trend + next action**, **Priority Movers**, **Follow-ups Due**, **Heating Up**, Next Best Actions, **Duplicate Leads**, AI tagging, and run history **with token cost**. |
| **Leads** | Priority column + sort, the Intelligence panel (recommended approach, next best action, talking points, completeness, confidence, **priority sparkline**), and **Refresh intel** per lead. |

---

## How it runs

- **Automatically:** once a day (overnight) the engine picks up never-researched
  leads first, then anything that's gone stale, and refreshes them. The same cron
  recomputes EFB satellite risk, backfills geocodes/boundaries, and posts the digest.
- **On demand:** **Run automation now** on the Automation page processes a batch
  immediately; **Refresh intel** re-runs a single lead.

---

## Under the hood

- **Engine:** `src/lib/enrichment/` — `priority.ts` (scoring + explanation),
  `seasonality.ts` (spray-season timing), `completeness.ts` (weighted), `research.ts`
  (SSOT AI analysis), `apollo.ts` (contact booster), `dedupe.ts` (duplicate detection +
  merge), `engine.ts` (orchestrator: retries, momentum, cost, summaries).
- **Endpoints:** `POST /api/enrich/run` (cron + manual), `POST /api/enrich/lead/[id]`
  (single), `GET /api/enrich/status` (health), `GET|POST /api/leads/dedupe` (duplicates),
  `GET|POST|PATCH /api/outreach/queue` (outreach drafts).
- **Outreach:** `src/lib/outreach/` — `draft.ts` (shared drafting, reused by the
  per-lead action) + `queue.ts` (batch generation); the `/outreach` page works the queue.
- **Schema:** `supabase/migrations/20260614000000_lead_intelligence_engine.sql`
  (base columns + run audit), `20260615010000_lead_intel_v3.sql` (momentum,
  advisory, token columns, refreshed views + `lead_priority_movers`), and
  `20260616000000_lead_intel_v4.sql` (`lead_score_history`, `stage_changed_at` +
  trigger, and the `lead_followups` / `lead_heating_up` views), and
  `20260616010000_outreach_queue.sql` (the `outreach_drafts` table). All additive
  and safe to re-run.
- **Tuning (env):** `ENRICHMENT_BATCH_SIZE`, `ENRICHMENT_CONCURRENCY`,
  `ENRICHMENT_STALE_DAYS`, `ENRICHMENT_RETRIES`, `ENRICHMENT_AUTOTAG`,
  `ENRICHMENT_MODEL` (display/compat). Optional `APOLLO_API_KEY` for contact data.

---

## Cost note

AI analysis runs per lead, batched daily, on the **free** Groq / OpenRouter models
by default (no Anthropic credits required — Anthropic is an optional fallback).
Token usage is now tracked per run on the Automation page so spend stays visible.
Start conservative with `ENRICHMENT_BATCH_SIZE` (default 6/run) and raise it once
you're comfortable.

---

*Want a field added to the analysis output, or a new scoring signal? Ping Field Ops.*
