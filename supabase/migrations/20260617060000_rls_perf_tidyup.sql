-- RLS performance tidy-up (Supabase linter follow-ups), no behavior change.
--
-- 1. profiles policies called auth.uid() per row (auth_rls_initplan). Wrap in
--    (select auth.uid()) so it's evaluated once per query.
-- 2. activities/assistant_actions/knowledge_documents had a read (SELECT) policy
--    plus a write (FOR ALL) policy — the ALL overlapped SELECT, giving two
--    permissive SELECT policies (multiple_permissive_policies). Split the write
--    side into explicit INSERT/UPDATE/DELETE so only the read policy covers
--    SELECT. Same effective permissions (staff write, org members read).

drop policy if exists profiles_select_self on public.profiles;
create policy profiles_select_self on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or (public.is_owner() and org_id = public.auth_org_id()));

drop policy if exists profiles_update_self_name on public.profiles;
create policy profiles_update_self_name on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and role = (select p.role from public.profiles p where p.id = (select auth.uid()))
  );

do $$
declare
  t text;
  tbls text[] := array['activities','assistant_actions','knowledge_documents'];
begin
  foreach t in array tbls loop
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (public.is_staff() and org_id = public.auth_org_id())', t || '_insert', t);
    execute format('create policy %I on public.%I for update to authenticated using (public.is_staff() and org_id = public.auth_org_id()) with check (public.is_staff() and org_id = public.auth_org_id())', t || '_update', t);
    execute format('create policy %I on public.%I for delete to authenticated using (public.is_staff() and org_id = public.auth_org_id())', t || '_delete', t);
  end loop;
end $$;
