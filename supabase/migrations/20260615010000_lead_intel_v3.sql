-- ─────────────────────────────────────────────────────────────────────────
-- Lead Intelligence Engine v3 — momentum, richer advisory & cost tracking.
--
-- Builds on the v1/v2 schema (priority + enrichment columns, run audit, views).
-- This pass adds:
--   • priority MOMENTUM   — previous score, delta, and a trend label so the
--                           dashboard can show what's rising / falling.
--   • a stored "why this rank" explanation for fast reads (digest, views).
--   • richer AI advisory  — a single next_best_action + grounded talking_points.
--   • cost tracking       — token usage on the enrichment_runs audit row.
--
-- Every change is additive and guarded with IF NOT EXISTS / OR REPLACE, so it is
-- safe to run against an existing database and safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. Momentum + richer advisory columns on `leads` ─────────────────────
alter table public.leads add column if not exists priority_score_prev  numeric;     -- last run's composite score
alter table public.leads add column if not exists priority_delta       numeric;     -- new − previous (null on first score)
alter table public.leads add column if not exists priority_trend       text;        -- 'up' | 'down' | 'flat' | 'new'
alter table public.leads add column if not exists priority_explanation text;        -- short "top drivers" narrative
alter table public.leads add column if not exists next_best_action     text;        -- the single concrete next step
alter table public.leads add column if not exists talking_points       jsonb;       -- string[] of grounded outreach points
alter table public.leads add column if not exists last_scored_at       timestamptz; -- when priority was last recomputed

create index if not exists idx_leads_priority_trend on public.leads (priority_trend);
create index if not exists idx_leads_priority_delta on public.leads (priority_delta desc nulls last);

-- ── 2. Token / cost accounting on the run audit table ────────────────────
alter table public.enrichment_runs add column if not exists ai_tokens int not null default 0;

-- ── 3. Refresh the intelligence views to expose momentum + next action ───
-- CREATE OR REPLACE VIEW only allows APPENDING columns (same prefix, same
-- order), so the original column lists are reproduced verbatim before the new
-- momentum/advisory columns are added at the end.
create or replace view public.lead_priority_queue
  with (security_invoker = on) as
  select id, business_name, owner_name, contact_name, vertical, city, county,
         primary_crop, est_acreage, phone, email,
         lead_score, priority_score, priority_tier, composite_efb_risk,
         action_recommendation, loi_status, enrichment_status,
         enrichment_confidence, data_completeness, recommended_approach,
         best_contact_method, enriched_at,
         -- v3 additions:
         priority_trend, priority_delta, priority_explanation,
         next_best_action, last_scored_at
    from public.leads
   order by priority_score desc nulls last, lead_score desc nulls last;

create or replace view public.next_best_actions
  with (security_invoker = on) as
  select id, business_name, owner_name, city, primary_crop,
         priority_score, priority_tier, action_recommendation,
         loi_status, recommended_approach, best_contact_method, phone, email,
         -- v3 additions:
         priority_trend, priority_delta, next_best_action, talking_points
    from public.leads
   where loi_status in ('not_contacted', 'contacted')
     and priority_score is not null
   order by priority_score desc
   limit 25;

-- ── 4. "Movers" view — biggest priority swings since the last run ─────────
-- Powers the dashboard's momentum panel and the daily digest without each
-- consumer re-deriving the ranking in the browser.
create or replace view public.lead_priority_movers
  with (security_invoker = on) as
  select id, business_name, owner_name, city, primary_crop,
         priority_score, priority_score_prev, priority_delta, priority_trend,
         priority_tier, recommended_approach, next_best_action, last_scored_at
    from public.leads
   where priority_delta is not null
     and priority_trend in ('up', 'down')
   order by abs(priority_delta) desc
   limit 25;

-- ── 5. Grants (CREATE OR REPLACE preserves grants, but re-grant to be safe) ─
grant select on public.lead_priority_queue  to anon, authenticated;
grant select on public.next_best_actions    to anon, authenticated;
grant select on public.lead_priority_movers to anon, authenticated;
