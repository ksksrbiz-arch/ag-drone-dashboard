-- DB audit follow-up: a prior migration revoked these helpers from `anon`, but
-- they still carried the default PUBLIC execute grant, so anon could call them
-- via PostgREST RPC anyway (notably default_org_id, which leaks the sole org id).
-- Revoke from PUBLIC. auth_org_id keeps its direct `authenticated` grant (RLS
-- policies need it); default_org_id and set_org_id are only invoked by the
-- SECURITY DEFINER insert trigger, which runs as its owner — no caller grant
-- required. Verified post-change: the insert trigger still stamps org_id, and
-- authenticated can still execute auth_org_id while anon cannot.
revoke execute on function public.auth_org_id() from public;
revoke execute on function public.default_org_id() from public;
revoke execute on function public.set_org_id() from public;
