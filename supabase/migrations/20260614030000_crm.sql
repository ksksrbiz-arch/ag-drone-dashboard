-- ─────────────────────────────────────────────────────────────────────────
-- CRM — customers & contracts.
--
-- Promotes the pipeline beyond leads: a real customer entity with contracts
-- and service history, so won business is tracked through delivery and billing.
--
-- Additive and idempotent.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.customers (
  id            uuid primary key default gen_random_uuid(),
  business_name text,
  contact_name  text,
  phone         text,
  email         text,
  address       text,
  city          text,
  county        text,
  state         text default 'OR',
  primary_crop  text,
  est_acreage   numeric,
  status        text not null default 'active',  -- 'prospect' | 'active' | 'inactive'
  lead_id       uuid references public.leads(id) on delete set null,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_customers_status on public.customers (status);
create index if not exists idx_customers_lead   on public.customers (lead_id);

create table if not exists public.contracts (
  id            uuid primary key default gen_random_uuid(),
  customer_id   uuid not null references public.customers(id) on delete cascade,
  title         text not null,
  type          text not null default 'service_agreement', -- 'loi'|'service_agreement'|'quote'
  status        text not null default 'draft',             -- 'draft'|'sent'|'signed'|'active'|'expired'|'declined'
  annual_value  numeric,
  start_date    date,
  end_date      date,
  signed_date   date,
  terms         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_contracts_customer on public.contracts (customer_id);

-- Tie jobs to a customer (additive — existing lead_id link is untouched).
alter table public.jobs add column if not exists customer_id uuid references public.customers(id) on delete set null;
create index if not exists idx_jobs_customer on public.jobs (customer_id);

-- RLS — mirror the app's single-tenant permissive model.
alter table public.customers enable row level security;
alter table public.contracts enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'customers' and policyname = 'customers_all') then
    create policy customers_all on public.customers for all using (true) with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'contracts' and policyname = 'contracts_all') then
    create policy contracts_all on public.contracts for all using (true) with check (true);
  end if;
end $$;

grant select, insert, update, delete on public.customers to anon, authenticated, service_role;
grant select, insert, update, delete on public.contracts to anon, authenticated, service_role;

-- updated_at maintenance (self-contained; matches the hardened helper).
create or replace function public.set_updated_at()
returns trigger language plpgsql
set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists trg_customers_updated_at on public.customers;
create trigger trg_customers_updated_at
  before update on public.customers
  for each row execute function public.set_updated_at();

drop trigger if exists trg_contracts_updated_at on public.contracts;
create trigger trg_contracts_updated_at
  before update on public.contracts
  for each row execute function public.set_updated_at();
