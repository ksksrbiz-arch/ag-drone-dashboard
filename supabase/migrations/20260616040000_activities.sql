-- Per-record activity timeline — the CRM backbone. Calls, notes, emails,
-- meetings, and system events logged against a lead, customer, or job, by the
-- team or by Ace. Gives every record a chronological history.

create table if not exists public.activities (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null check (entity_type in ('lead', 'customer', 'job')),
  entity_id    uuid not null,
  kind         text not null default 'note'
               check (kind in ('note', 'call', 'email', 'sms', 'meeting', 'stage', 'system')),
  body         text not null,
  actor_id     uuid,
  actor_email  text,
  created_at   timestamptz not null default now()
);

create index if not exists activities_entity_idx
  on public.activities (entity_type, entity_id, created_at desc);

alter table public.activities enable row level security;

-- Hardened RLS: anon none, authenticated read, staff write. Ace writes via the
-- service-role key (bypasses RLS) so logging never depends on the caller grants.
drop policy if exists activities_read on public.activities;
create policy activities_read on public.activities
  for select to authenticated using (true);

drop policy if exists activities_write on public.activities;
create policy activities_write on public.activities
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

grant select on public.activities to authenticated;
grant select, insert, update, delete on public.activities to service_role;
