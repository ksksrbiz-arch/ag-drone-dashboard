-- ─────────────────────────────────────────────────────────────────────────
-- Proactive Slack alerts — dedupe column.
--
-- The daily digest is a narrated once-a-day summary. This adds the ability to
-- push *individual* urgent transitions (treat-now / new P1) to Slack the moment
-- the enrichment engine flips a lead, without ever repeating one. `notified_at`
-- is stamped once an alert has been delivered to Slack so the next run skips it.
--
-- Additive and idempotent.
-- ─────────────────────────────────────────────────────────────────────────

alter table public.alerts add column if not exists notified_at timestamptz;

-- Fast lookup of the small set of alerts still awaiting a Slack push.
create index if not exists idx_alerts_unnotified
  on public.alerts (created_at desc)
  where notified_at is null;
