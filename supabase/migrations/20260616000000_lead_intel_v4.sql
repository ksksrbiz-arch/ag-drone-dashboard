-- ─────────────────────────────────────────────────────────────────────────
-- Lead Intelligence Engine v4 — score history, sustained trends & follow-up SLAs.
--
-- Builds on v3 (priority momentum). v3 only compares a lead to its immediately
-- previous score; v4 makes that history durable and actionable:
--   • lead_score_history — one snapshot per lead per scoring run → a real
--     timeline the UI can sparkline and trend over.
--   • lead_heating_up    — leads whose score rose across the last 3 runs
--     (a sustained riser, not just a one-run blip).
--   • stage_changed_at + lead_followups — when a lead enters a pipeline stage
--     and then stalls past a per-stage SLA, it surfaces as a follow-up.
--
-- Additive and idempotent — safe to run against an existing database / re-run.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. Score history snapshots ───────────────────────────────────────────
create table if not exists public.lead_score_history (
  id          uuid primary key default gen_random_uuid(),
  lead_id     uuid not null references public.leads(id) on delete cascade,
  run_id      uuid,                                  -- enrichment_runs.id (nullable)
  score       numeric,
  tier        text,
  delta       numeric,                               -- change vs the prior snapshot
  captured_at timestamptz not null default now()
);

create index if not exists idx_lead_score_history_lead
  on public.lead_score_history (lead_id, captured_at desc);
create index if not exists idx_lead_score_history_captured
  on public.lead_score_history (captured_at desc);

alter table public.lead_score_history enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'lead_score_history' and policyname = 'lead_score_history_read') then
    create policy lead_score_history_read   on public.lead_score_history for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'lead_score_history' and policyname = 'lead_score_history_insert') then
    create policy lead_score_history_insert on public.lead_score_history for insert with check (true);
  end if;
end $$;

grant select, insert on public.lead_score_history to anon, authenticated, service_role;

-- ── 2. Pipeline-stage timestamp for follow-up SLAs ───────────────────────
alter table public.leads add column if not exists stage_changed_at timestamptz;

-- Backfill existing rows with the best available "entered this stage" proxy.
update public.leads
   set stage_changed_at = coalesce(loi_signed_at, loi_sent_at, created_at)
 where stage_changed_at is null;

-- Stamp stage_changed_at on insert, and whenever loi_status actually changes.
create or replace function public.track_lead_stage()
returns trigger language plpgsql
set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.stage_changed_at is null then new.stage_changed_at = now(); end if;
  elsif tg_op = 'UPDATE' then
    if new.loi_status is distinct from old.loi_status then new.stage_changed_at = now(); end if;
  end if;
  return new;
end $$;

drop trigger if exists trg_leads_stage_ins on public.leads;
create trigger trg_leads_stage_ins
  before insert on public.leads
  for each row execute function public.track_lead_stage();

drop trigger if exists trg_leads_stage_upd on public.leads;
create trigger trg_leads_stage_upd
  before update on public.leads
  for each row execute function public.track_lead_stage();

-- ── 3. Follow-ups view — active leads stalled past a per-stage SLA ────────
-- "We engaged them and then went quiet." SLAs are tighter the warmer the stage.
create or replace view public.lead_followups
  with (security_invoker = on) as
  select id, business_name, owner_name, city, primary_crop, phone, email,
         priority_score, priority_tier, loi_status, stage_changed_at,
         recommended_approach, next_best_action, best_contact_method,
         (extract(epoch from (now() - stage_changed_at)) / 86400)::int as days_in_stage
    from public.leads
   where stage_changed_at is not null
     and (
       (loi_status = 'contacted'         and stage_changed_at < now() - interval '5 days') or
       (loi_status = 'meeting_scheduled' and stage_changed_at < now() - interval '3 days') or
       (loi_status = 'loi_sent'          and stage_changed_at < now() - interval '7 days')
     )
   order by priority_score desc nulls last, stage_changed_at asc;

-- ── 4. "Heating up" view — sustained risers over the last 3 snapshots ─────
create or replace view public.lead_heating_up
  with (security_invoker = on) as
  with ranked as (
    select lead_id, score,
           row_number() over (partition by lead_id order by captured_at desc) as rn
      from public.lead_score_history
  ),
  last3 as (
    select lead_id,
           max(score) filter (where rn = 1) as s1,
           max(score) filter (where rn = 2) as s2,
           max(score) filter (where rn = 3) as s3,
           count(*) as n
      from ranked
     where rn <= 3
     group by lead_id
  )
  select l.id, l.business_name, l.owner_name, l.city, l.primary_crop,
         l.priority_score, l.priority_tier, l.recommended_approach, l.next_best_action,
         round(h.s1 - h.s3, 1) as rise_3
    from last3 h
    join public.leads l on l.id = h.lead_id
   where h.n >= 3 and h.s1 > h.s2 and h.s2 > h.s3
   order by rise_3 desc
   limit 25;

-- ── 5. Grants ─────────────────────────────────────────────────────────────
grant select on public.lead_followups  to anon, authenticated;
grant select on public.lead_heating_up to anon, authenticated;
