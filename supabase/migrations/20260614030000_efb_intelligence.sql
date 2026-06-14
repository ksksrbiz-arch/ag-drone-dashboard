-- ─────────────────────────────────────────────────────────────────────────
-- EFB Intelligence Engine — schema for the satellite risk-map overhaul.
--
-- Adds the explainable EFB assessment fields the recompute engine writes back
-- (factor breakdown, confidence, spray-window, risk trend), a run-history table
-- for the Automation page, a one-call KPI payload, and a server-side risk queue
-- view for the Intel Hub.
--
-- Additive and idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. EFB assessment columns on leads ───────────────────────────────────
alter table public.leads add column if not exists efb_factors        jsonb;
alter table public.leads add column if not exists efb_confidence     numeric;
alter table public.leads add column if not exists spray_window_status text;
alter table public.leads add column if not exists spray_window_score  int;
alter table public.leads add column if not exists risk_trend          text;
alter table public.leads add column if not exists efb_recomputed_at   timestamptz;

create index if not exists idx_leads_efb_risk
  on public.leads (composite_efb_risk desc nulls last)
  where vertical = 'ag_spray';

create index if not exists idx_leads_action_rec
  on public.leads (action_recommendation)
  where action_recommendation is not null;

-- ── 2. EFB recompute run history ─────────────────────────────────────────
create table if not exists public.efb_runs (
  id                uuid primary key default gen_random_uuid(),
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  status            text not null default 'running', -- running | completed | failed
  trigger           text,                             -- cron | manual
  parcels_processed int not null default 0,
  parcels_updated   int not null default 0,
  treat_now         int not null default 0,
  alerts_raised     int not null default 0,
  duration_ms       int,
  error             text
);

create index if not exists idx_efb_runs_started on public.efb_runs (started_at desc);

alter table public.efb_runs enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'efb_runs' and policyname = 'efb_runs_read') then
    create policy efb_runs_read   on public.efb_runs for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'efb_runs' and policyname = 'efb_runs_insert') then
    create policy efb_runs_insert on public.efb_runs for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'efb_runs' and policyname = 'efb_runs_update') then
    create policy efb_runs_update on public.efb_runs for update using (true);
  end if;
end $$;

grant select, insert, update on public.efb_runs to anon, authenticated, service_role;

-- ── 3. One-call EFB KPI payload for the Intel Hub ────────────────────────
create or replace function public.get_efb_kpis()
returns jsonb language sql stable
set search_path = '' as $$
  with ag as (
    select * from public.leads
     where vertical = 'ag_spray' and composite_efb_risk is not null
  )
  select jsonb_build_object(
    'parcels',        (select count(*) from ag),
    'avg_risk',       (select round(avg(composite_efb_risk)) from ag),
    'critical',       (select count(*) from ag where composite_efb_risk >= 75),
    'high',           (select count(*) from ag where composite_efb_risk >= 55 and composite_efb_risk < 75),
    'treat_now',      (select count(*) from ag where action_recommendation = 'TREAT_NOW'),
    'scout_now',      (select count(*) from ag where action_recommendation = 'SCOUT_NOW'),
    'rising',         (select count(*) from ag where risk_trend = 'rising'),
    'spray_optimal',  (select count(*) from ag where spray_window_status = 'optimal'),
    'avg_confidence', (select round(avg(efb_confidence) * 100) from ag where efb_confidence is not null),
    'acres_at_risk',  (select coalesce(round(sum(est_acreage)), 0) from ag where composite_efb_risk >= 55),
    'last_recompute', (select max(efb_recomputed_at) from ag)
  );
$$;

grant execute on function public.get_efb_kpis() to anon, authenticated, service_role;

-- ── 4. Server-side EFB risk queue (security_invoker → respect caller RLS) ─
create or replace view public.efb_risk_queue
  with (security_invoker = on) as
  select id, business_name, owner_name, city, county, primary_crop,
         lat, lon, est_acreage,
         composite_efb_risk, ml_efb_risk, ml_confidence, efb_confidence,
         action_recommendation, spray_window_status, spray_window_score,
         risk_trend, efb_recomputed_at
    from public.leads
   where vertical = 'ag_spray'
     and composite_efb_risk is not null
   order by composite_efb_risk desc nulls last;

grant select on public.efb_risk_queue to anon, authenticated;
