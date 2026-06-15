-- Audit log of write actions the Sidekick assistant takes on the user's behalf
-- (advance a lead, create a job, save a knowledge note, etc.). Gives an
-- accountable trail and lets the assistant answer "what did you change today?".

create table if not exists public.assistant_actions (
  id           uuid primary key default gen_random_uuid(),
  actor_id     uuid,
  actor_email  text,
  tool         text not null,
  summary      text not null,
  detail       jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists assistant_actions_created_idx
  on public.assistant_actions (created_at desc);

alter table public.assistant_actions enable row level security;

-- Hardened RLS: anon none, authenticated read, staff write. The server logs
-- via the service-role key (bypasses RLS) so logging never depends on the
-- caller's grants.
drop policy if exists assistant_actions_read on public.assistant_actions;
create policy assistant_actions_read on public.assistant_actions
  for select to authenticated using (true);

drop policy if exists assistant_actions_write on public.assistant_actions;
create policy assistant_actions_write on public.assistant_actions
  for all to authenticated using (public.is_staff()) with check (public.is_staff());

grant select on public.assistant_actions to authenticated;
grant select, insert, update, delete on public.assistant_actions to service_role;
