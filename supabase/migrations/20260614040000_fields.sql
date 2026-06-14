-- ─────────────────────────────────────────────────────────────────────────
-- Fields — mappable field boundaries with acreage & treatment linkage.
--
-- Each field stores a GeoJSON polygon boundary, a computed acreage, a centroid
-- for quick centering, and optional links to a customer / lead. Powers the
-- Fields map and per-field history.
--
-- Additive and idempotent.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.fields (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  customer_id  uuid references public.customers(id) on delete set null,
  lead_id      uuid references public.leads(id) on delete set null,
  crop         text,
  acreage      numeric,
  boundary     jsonb,        -- GeoJSON geometry (Polygon / MultiPolygon)
  center_lat   numeric,
  center_lon   numeric,
  color        text default '#22c55e',
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_fields_customer on public.fields (customer_id);
create index if not exists idx_fields_lead     on public.fields (lead_id);

alter table public.fields enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'fields' and policyname = 'fields_all') then
    create policy fields_all on public.fields for all using (true) with check (true);
  end if;
end $$;

grant select, insert, update, delete on public.fields to anon, authenticated, service_role;

create or replace function public.set_updated_at()
returns trigger language plpgsql
set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_fields_updated_at on public.fields;
create trigger trg_fields_updated_at
  before update on public.fields
  for each row execute function public.set_updated_at();
