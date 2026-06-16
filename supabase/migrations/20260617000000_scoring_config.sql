-- ─────────────────────────────────────────────────────────────────────────
-- Scoring config — opt-in overrides for the priority engine.
--
-- A single-row table holding optional overrides for the per-factor weights and
-- the P1–P4 tier thresholds. When absent or empty, the engine uses its built-in
-- code defaults, so this is a no-op until someone saves an override. Lets the
-- engine be dialed in to real-world results without a code change.
--
-- Additive + idempotent.
-- ─────────────────────────────────────────────────────────────────────────

create table if not exists public.scoring_config (
  id         text primary key default 'singleton',
  config     jsonb not null default '{}'::jsonb,   -- { agWeights, nonAgWeights, thresholds }
  updated_at timestamptz not null default now()
);

-- Keep updated_at fresh (reuses the generic trigger fn from intelligence_backend).
drop trigger if exists trg_scoring_config_updated on public.scoring_config;
create trigger trg_scoring_config_updated
  before update on public.scoring_config
  for each row execute function public.set_updated_at();

alter table public.scoring_config enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where tablename = 'scoring_config' and policyname = 'scoring_config_read') then
    create policy scoring_config_read   on public.scoring_config for select using (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'scoring_config' and policyname = 'scoring_config_insert') then
    create policy scoring_config_insert on public.scoring_config for insert with check (true);
  end if;
  if not exists (select 1 from pg_policies where tablename = 'scoring_config' and policyname = 'scoring_config_update') then
    create policy scoring_config_update on public.scoring_config for update using (true);
  end if;
end $$;

grant select, insert, update on public.scoring_config to anon, authenticated, service_role;
