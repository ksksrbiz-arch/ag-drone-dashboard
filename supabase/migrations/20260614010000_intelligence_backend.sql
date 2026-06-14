-- ─────────────────────────────────────────────────────────────────────────
-- Intelligence backend — triggers, functions & views.
--
-- Moves operational "thinking" into Supabase so the platform is more autonomous
-- and the dashboard can read pre-aggregated intelligence instead of computing
-- everything in the browser.
--
-- Idempotent and additive — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────

-- ── 1. Keep leads.updated_at fresh on every change ───────────────────────
create or replace function public.set_updated_at()
returns trigger language plpgsql
set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_leads_updated_at on public.leads;
create trigger trg_leads_updated_at
  before update on public.leads
  for each row execute function public.set_updated_at();

-- ── 2. Auto-enqueue brand-new leads into the research queue ───────────────
-- Any lead inserted without an enrichment_status is marked 'pending', so the
-- engine picks it up on the next run with zero manual steps.
create or replace function public.enqueue_new_lead()
returns trigger language plpgsql
set search_path = '' as $$
begin
  if new.enrichment_status is null then
    new.enrichment_status = 'pending';
  end if;
  return new;
end $$;

drop trigger if exists trg_leads_enqueue on public.leads;
create trigger trg_leads_enqueue
  before insert on public.leads
  for each row execute function public.enqueue_new_lead();

-- ── 3. Mark enriched leads stale after N days (engine / pg_cron callable) ──
create or replace function public.mark_stale_leads(p_days int default 7)
returns int language plpgsql
set search_path = '' as $$
declare n int;
begin
  update public.leads
     set enrichment_status = 'stale'
   where enrichment_status = 'enriched'
     and enriched_at is not null
     and enriched_at < now() - make_interval(days => p_days);
  get diagnostics n = row_count;
  return n;
end $$;

-- ── 4. One-call ops KPI payload for the dashboards ───────────────────────
create or replace function public.get_ops_kpis()
returns jsonb language sql stable
set search_path = '' as $$
  select jsonb_build_object(
    'total_leads',      (select count(*) from public.leads),
    'loi_signed',       (select count(*) from public.leads where loi_status = 'loi_signed'),
    'treat_now',        (select count(*) from public.leads where action_recommendation = 'TREAT_NOW'),
    'scout_now',        (select count(*) from public.leads where action_recommendation = 'SCOUT_NOW'),
    'contact_now',      (select count(*) from public.leads where action_recommendation = 'CONTACT_NOW'),
    'avg_efb_risk',     (select round(avg(composite_efb_risk)) from public.leads where composite_efb_risk is not null),
    'enriched',         (select count(*) from public.leads where enrichment_status = 'enriched'),
    'needs_enrichment', (select count(*) from public.leads where enrichment_status is null or enrichment_status in ('pending','stale','failed')),
    'avg_completeness', (select round(avg(data_completeness)) from public.leads where data_completeness is not null),
    'avg_confidence',   (select round(avg(enrichment_confidence) * 100) from public.leads where enrichment_confidence is not null),
    'priority_p1',      (select count(*) from public.leads where priority_tier = 'P1'),
    'priority_p2',      (select count(*) from public.leads where priority_tier = 'P2'),
    'priority_p3',      (select count(*) from public.leads where priority_tier = 'P3'),
    'priority_p4',      (select count(*) from public.leads where priority_tier = 'P4'),
    'active_jobs',      (select count(*) from public.jobs where status in ('scheduled','in_progress')),
    'paid_revenue',     (select coalesce(sum(paid_amount), 0) from public.jobs where status = 'paid')
  );
$$;

-- ── 5. Intelligence views (security_invoker → respect caller RLS) ─────────
create or replace view public.lead_priority_queue
  with (security_invoker = on) as
  select id, business_name, owner_name, contact_name, vertical, city, county,
         primary_crop, est_acreage, phone, email,
         lead_score, priority_score, priority_tier, composite_efb_risk,
         action_recommendation, loi_status, enrichment_status,
         enrichment_confidence, data_completeness, recommended_approach,
         best_contact_method, enriched_at
    from public.leads
   order by priority_score desc nulls last, lead_score desc nulls last;

-- "Who should we reach out to next" — outreach-ready leads, hottest first.
create or replace view public.next_best_actions
  with (security_invoker = on) as
  select id, business_name, owner_name, city, primary_crop,
         priority_score, priority_tier, action_recommendation,
         loi_status, recommended_approach, best_contact_method, phone, email
    from public.leads
   where loi_status in ('not_contacted', 'contacted')
     and priority_score is not null
   order by priority_score desc
   limit 25;

-- ── 6. Grants for the dashboard roles ────────────────────────────────────
grant select   on public.lead_priority_queue to anon, authenticated;
grant select   on public.next_best_actions   to anon, authenticated;
grant execute  on function public.get_ops_kpis()        to anon, authenticated;
grant execute  on function public.mark_stale_leads(int) to anon, authenticated, service_role;

-- ── 7. Optional: schedule the stale sweep with pg_cron ───────────────────
-- Requires the pg_cron extension (enable in Supabase → Database → Extensions).
-- Uncomment to run a daily stale sweep entirely inside Postgres:
--
--   select cron.schedule('mark-stale-leads', '0 7 * * *',
--                        $$ select public.mark_stale_leads(7); $$);
