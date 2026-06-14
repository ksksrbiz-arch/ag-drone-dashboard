-- ─────────────────────────────────────────────────────────────────────────
-- Alerts — operational notifications surfaced in-app and in the daily digest.
--
-- A trigger raises an alert whenever the enrichment engine flips a lead into an
-- urgent state (TREAT_NOW, or a new P1 priority), so nothing slips by.
--
-- Additive and idempotent.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.alerts (
  id          uuid primary key default gen_random_uuid(),
  created_at  timestamptz not null default now(),
  type        text not null,                 -- 'treat_now' | 'new_p1' | 'system'
  severity    text not null default 'info',  -- 'info' | 'warning' | 'critical'
  lead_id     uuid references public.leads(id) on delete cascade,
  title       text not null,
  body        text,
  read        boolean not null default false
);

create index if not exists idx_alerts_created_at on public.alerts (created_at desc);
create index if not exists idx_alerts_unread on public.alerts (read) where read = false;

alter table public.alerts enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'alerts' and policyname = 'alerts_read') then
    create policy alerts_read   on public.alerts for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'alerts' and policyname = 'alerts_insert') then
    create policy alerts_insert on public.alerts for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'alerts' and policyname = 'alerts_update') then
    create policy alerts_update on public.alerts for update using (true);
  end if;
end $$;

grant select, insert, update on public.alerts to anon, authenticated, service_role;

-- Raise alerts on urgent state transitions.
create or replace function public.raise_lead_alerts()
returns trigger language plpgsql
set search_path = '' as $$
begin
  if new.action_recommendation = 'TREAT_NOW'
     and new.action_recommendation is distinct from old.action_recommendation then
    insert into public.alerts (type, severity, lead_id, title, body)
    values ('treat_now', 'critical', new.id,
            coalesce(new.business_name, new.owner_name, 'Lead') || ' — treat now',
            concat_ws(' · ', new.primary_crop, 'EFB risk ' || coalesce(new.composite_efb_risk::text, '?')));
  end if;

  if new.priority_tier = 'P1'
     and new.priority_tier is distinct from old.priority_tier then
    insert into public.alerts (type, severity, lead_id, title, body)
    values ('new_p1', 'warning', new.id,
            'New P1 priority — ' || coalesce(new.business_name, new.owner_name, 'Lead'),
            concat_ws(' · ', 'Score ' || coalesce(new.priority_score::text, '?'), new.recommended_approach));
  end if;

  return new;
end $$;

drop trigger if exists trg_lead_alerts on public.leads;
create trigger trg_lead_alerts
  after update on public.leads
  for each row execute function public.raise_lead_alerts();
