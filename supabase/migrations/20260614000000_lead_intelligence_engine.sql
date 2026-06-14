-- ─────────────────────────────────────────────────────────────────────────
-- Lead Intelligence Engine — schema additions
--
-- Adds the columns the automated research + prioritization pipeline writes,
-- plus an `enrichment_runs` audit table the Automation dashboard reads.
--
-- Safe to run against an existing database: every change is additive and
-- guarded with IF NOT EXISTS. The live dashboard pages use `select('*')`, so
-- they keep working before and after this migration is applied.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. New columns on `leads` ────────────────────────────────────────────
alter table public.leads add column if not exists priority_score        numeric;        -- 0..100 (algorithmic composite)
alter table public.leads add column if not exists priority_tier         text;           -- 'P1' | 'P2' | 'P3' | 'P4'
alter table public.leads add column if not exists priority_factors      jsonb;          -- transparent factor breakdown
alter table public.leads add column if not exists data_completeness     numeric;        -- 0..100 (% of key fields populated)
alter table public.leads add column if not exists enrichment_status     text;           -- pending | researching | enriched | failed | stale
alter table public.leads add column if not exists enriched_at           timestamptz;    -- last successful enrichment
alter table public.leads add column if not exists enrichment_confidence numeric;        -- 0..1 (AI research confidence)
alter table public.leads add column if not exists research_summary      text;           -- AI narrative summary
alter table public.leads add column if not exists recommended_approach  text;           -- "best options for us specifically"
alter table public.leads add column if not exists best_contact_method   text;           -- e.g. 'phone' | 'email' | 'in_person'
alter table public.leads add column if not exists enrichment_sources    jsonb;          -- per-field provenance + crop_types + prior values

-- Helpful indexes for the dashboard's priority / queue views
create index if not exists idx_leads_priority_score     on public.leads (priority_score desc nulls last);
create index if not exists idx_leads_enrichment_status  on public.leads (enrichment_status);
create index if not exists idx_leads_enriched_at        on public.leads (enriched_at desc nulls last);

-- ── 2. Enrichment run audit log ──────────────────────────────────────────
create table if not exists public.enrichment_runs (
  id              uuid primary key default gen_random_uuid(),
  started_at      timestamptz not null default now(),
  finished_at     timestamptz,
  status          text not null default 'running',  -- running | completed | failed
  trigger         text,                              -- cron | manual | single
  leads_processed int  not null default 0,
  leads_enriched  int  not null default 0,
  leads_failed    int  not null default 0,
  ai_calls        int  not null default 0,
  ai_enabled      boolean,
  model_version   text,
  duration_ms     int,
  error           text,
  summary         jsonb
);

create index if not exists idx_enrichment_runs_started_at on public.enrichment_runs (started_at desc);

-- ── 3. Row-level security ────────────────────────────────────────────────
-- Mirror the permissive posture already used by the dashboard (anon client
-- both reads and advances LOI stage). Tighten these once real auth is added.
alter table public.enrichment_runs enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'enrichment_runs'
      and policyname = 'enrichment_runs_read'
  ) then
    create policy enrichment_runs_read   on public.enrichment_runs for select using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'enrichment_runs'
      and policyname = 'enrichment_runs_insert'
  ) then
    create policy enrichment_runs_insert on public.enrichment_runs for insert with check (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'enrichment_runs'
      and policyname = 'enrichment_runs_update'
  ) then
    create policy enrichment_runs_update on public.enrichment_runs for update using (true);
  end if;
end $$;
