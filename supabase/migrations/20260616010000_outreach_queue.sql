-- ─────────────────────────────────────────────────────────────────────────
-- Outreach queue — the action layer on top of the Lead Intelligence engine.
--
-- The engine decides WHO to contact and WHAT to say (priority, next_best_action,
-- talking_points, follow-up SLAs). This table stores REVIEW-FIRST drafts the
-- operator can edit, approve, mark sent, or dismiss. Nothing is ever sent
-- automatically — a draft is just text waiting for a human to act on it.
--
-- Additive and idempotent.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.outreach_drafts (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads(id) on delete cascade,
  channel       text not null default 'email',   -- 'email' | 'sms'
  subject       text,                             -- email subject (null for sms)
  body          text not null,
  status        text not null default 'draft',    -- 'draft' | 'approved' | 'sent' | 'dismissed'
  reason        text,                             -- why queued: 'new_p1' | 'followup' | 'priority' | 'manual'
  priority_tier text,                             -- snapshot of the lead's tier when queued
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_outreach_drafts_status on public.outreach_drafts (status, created_at desc);
create index if not exists idx_outreach_drafts_lead   on public.outreach_drafts (lead_id);

-- Keep updated_at fresh (reuses the generic trigger fn from the intelligence_backend migration).
drop trigger if exists trg_outreach_drafts_updated on public.outreach_drafts;
create trigger trg_outreach_drafts_updated
  before update on public.outreach_drafts
  for each row execute function public.set_updated_at();

alter table public.outreach_drafts enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'outreach_drafts' and policyname = 'outreach_drafts_read') then
    create policy outreach_drafts_read   on public.outreach_drafts for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'outreach_drafts' and policyname = 'outreach_drafts_insert') then
    create policy outreach_drafts_insert on public.outreach_drafts for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'outreach_drafts' and policyname = 'outreach_drafts_update') then
    create policy outreach_drafts_update on public.outreach_drafts for update using (true);
  end if;
end $$;

grant select, insert, update on public.outreach_drafts to anon, authenticated, service_role;
