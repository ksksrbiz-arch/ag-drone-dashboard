-- ─────────────────────────────────────────────────────────────────────────
-- Multi-tenancy foundation. Introduces organizations (tenants) and scopes
-- every domain table to an org via row-level security, so one Sortie database
-- can serve many drone operators with hard data isolation.
--
-- Today there is a single tenant; this migration seeds one org, backfills all
-- existing rows into it, and makes the current user its owner. Functionally a
-- no-op for the live app, but from here on every row is org-scoped.
--
-- Roles stay on profiles (app_role: owner | partner | affiliate). is_staff()
-- (owner/partner) keeps write access; org membership is a separate, additive
-- predicate. The org owner is the app_role 'owner'; 'partner' is the
-- high-permission "admin" seat (everything short of owner-only controls).
--
-- Ordering note: org_id columns are added BEFORE the helper functions, because
-- SQL-language functions are validated against the schema at creation time.
-- ─────────────────────────────────────────────────────────────────────────

-- 1. Organizations (tenants) ------------------------------------------------
create table if not exists public.organizations (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text unique,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

insert into public.organizations (name, slug)
select '1COMMERCE Drone Ops', '1commerce-drone-ops'
where not exists (select 1 from public.organizations);

-- 2. Add org_id to every domain table, backfill, constrain, index -----------
do $$
declare
  t text;
  tbls text[] := array[
    'leads','customers','jobs','contracts','fields','activities','alerts',
    'knowledge_documents','efb_runs','enrichment_runs','lead_score_history',
    'mission_feedback','outreach_drafts','assistant_actions','profiles'
  ];
  seed uuid := (select id from public.organizations order by created_at limit 1);
begin
  foreach t in array tbls loop
    execute format('alter table public.%I add column if not exists org_id uuid', t);
    execute format('update public.%I set org_id = %L where org_id is null', t, seed);
    execute format('alter table public.%I alter column org_id set not null', t);
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_org_fk');
    execute format('alter table public.%I add constraint %I foreign key (org_id) references public.organizations(id) on delete cascade', t, t || '_org_fk');
    execute format('create index if not exists %I on public.%I (org_id)', t || '_org_idx', t);
  end loop;
end $$;

-- 3. Helper functions (now that profiles.org_id exists) ---------------------
create or replace function public.auth_org_id()
returns uuid language sql stable security definer set search_path to '' as $$
  select org_id from public.profiles where id = auth.uid();
$$;

-- Org to stamp on a new row: the caller's org when authenticated; otherwise
-- (service-role/background jobs, where auth.uid() is null) the sole org while
-- exactly one exists. Returns null once multiple orgs exist with no auth
-- context — a loud NOT NULL failure that forces background writers to set
-- org_id explicitly rather than silently writing cross-tenant.
create or replace function public.default_org_id()
returns uuid language sql stable security definer set search_path to '' as $$
  select coalesce(
    (select org_id from public.profiles where id = auth.uid()),
    (case when (select count(*) from public.organizations) = 1
          then (select id from public.organizations) end)
  );
$$;

create or replace function public.set_org_id()
returns trigger language plpgsql security definer set search_path to '' as $$
begin
  if new.org_id is null then
    new.org_id := public.default_org_id();
  end if;
  return new;
end;
$$;

-- 4. Auto-stamp trigger on every org-scoped table ---------------------------
do $$
declare
  t text;
  tbls text[] := array[
    'leads','customers','jobs','contracts','fields','activities','alerts',
    'knowledge_documents','efb_runs','enrichment_runs','lead_score_history',
    'mission_feedback','outreach_drafts','assistant_actions','profiles'
  ];
begin
  foreach t in array tbls loop
    execute format('drop trigger if exists set_org_id on public.%I', t);
    execute format('create trigger set_org_id before insert on public.%I for each row execute function public.set_org_id()', t);
  end loop;
end $$;

-- 5. RLS: organizations -----------------------------------------------------
alter table public.organizations enable row level security;
drop policy if exists organizations_select on public.organizations;
create policy organizations_select on public.organizations
  for select to authenticated using (id = public.auth_org_id());
drop policy if exists organizations_update_owner on public.organizations;
create policy organizations_update_owner on public.organizations
  for update to authenticated
  using (public.is_owner() and id = public.auth_org_id())
  with check (public.is_owner() and id = public.auth_org_id());
grant select, update on public.organizations to authenticated;
grant all on public.organizations to service_role;

-- 6. RLS: standard staff-write tables (read = org member, write = staff+org) -
do $$
declare
  t text;
  tbls text[] := array[
    'alerts','contracts','customers','efb_runs','enrichment_runs',
    'fields','jobs','leads','mission_feedback'
  ];
begin
  foreach t in array tbls loop
    execute format('drop policy if exists %I on public.%I', t || '_select_auth', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_org', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_staff', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_staff', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_staff', t);
    execute format('create policy %I on public.%I for select to authenticated using (org_id = public.auth_org_id())', t || '_select_org', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_staff() and org_id = public.auth_org_id())', t || '_insert_staff', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_staff() and org_id = public.auth_org_id()) with check (public.is_staff() and org_id = public.auth_org_id())', t || '_update_staff', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_staff() and org_id = public.auth_org_id())', t || '_delete_staff', t);
  end loop;
end $$;

-- 7. RLS: read-all + staff-write tables --------------------------------------
do $$
declare
  t text;
  tbls text[] := array['activities','assistant_actions','knowledge_documents'];
begin
  foreach t in array tbls loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for select to authenticated using (org_id = public.auth_org_id())', t || '_read', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_staff() and org_id = public.auth_org_id()) with check (public.is_staff() and org_id = public.auth_org_id())', t || '_write', t);
  end loop;
end $$;

-- 8. RLS: previously-permissive tables → org-scoped authenticated ------------
-- lead_score_history and outreach_drafts were open to the public role. Tighten
-- to org members; service-role background writers bypass RLS and are stamped by
-- the trigger.
drop policy if exists lead_score_history_insert on public.lead_score_history;
drop policy if exists lead_score_history_read on public.lead_score_history;
create policy lead_score_history_read on public.lead_score_history
  for select to authenticated using (org_id = public.auth_org_id());
create policy lead_score_history_insert on public.lead_score_history
  for insert to authenticated with check (org_id = public.auth_org_id());

drop policy if exists outreach_drafts_insert on public.outreach_drafts;
drop policy if exists outreach_drafts_read on public.outreach_drafts;
drop policy if exists outreach_drafts_update on public.outreach_drafts;
create policy outreach_drafts_read on public.outreach_drafts
  for select to authenticated using (org_id = public.auth_org_id());
create policy outreach_drafts_insert on public.outreach_drafts
  for insert to authenticated with check (org_id = public.auth_org_id());
create policy outreach_drafts_update on public.outreach_drafts
  for update to authenticated using (org_id = public.auth_org_id()) with check (org_id = public.auth_org_id());

-- 9. RLS: profiles — self always; owner sees/manages their org's profiles ----
drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = auth.uid() or (public.is_owner() and org_id = public.auth_org_id()));
drop policy if exists profiles_update_owner on public.profiles;
create policy profiles_update_owner on public.profiles
  for update to authenticated
  using (public.is_owner() and org_id = public.auth_org_id())
  with check (public.is_owner() and org_id = public.auth_org_id());
-- profiles_update_self_name (self, role-locked) is left intact.
