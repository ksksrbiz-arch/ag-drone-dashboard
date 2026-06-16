-- Tighten EXECUTE on the tenancy helper functions (flagged by the Supabase
-- security linter). They only ever run inside RLS policies and the insert
-- trigger, never as a public RPC:
--   * auth_org_id() is referenced by authenticated-only policies → keep it
--     executable by `authenticated`, but revoke from `anon`.
--   * default_org_id() and set_org_id() are only invoked by the SECURITY DEFINER
--     trigger (which runs as its owner), so no end-user role needs EXECUTE.
-- This stops anon from reading the sole org's id via /rpc/default_org_id.
revoke execute on function public.auth_org_id() from anon;
revoke execute on function public.default_org_id() from anon, authenticated;
revoke execute on function public.set_org_id() from anon, authenticated;
