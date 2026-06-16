-- ─────────────────────────────────────────────────────────────────────────
-- At-Risk Radar — the mirror of lead_heating_up.
--
-- Surfaces still-winnable, worth-attention leads whose priority score has
-- DECLINED across the last 3 scoring runs (sustained cool-off, not a one-run
-- dip). Pairs with the Heating Up view so the dashboard shows both momentum
-- directions: who to lean into, and who's slipping away.
--
-- Additive + idempotent. Read-only view over the v4 lead_score_history table.
-- ─────────────────────────────────────────────────────────────────────────

create or replace view public.lead_cooling_off
  with (security_invoker = on) as
  with ranked as (
    select lead_id, score,
           row_number() over (partition by lead_id order by captured_at desc) as rn
      from public.lead_score_history
  ),
  last3 as (
    select lead_id,
           max(score) filter (where rn = 1) as s1,   -- most recent
           max(score) filter (where rn = 2) as s2,
           max(score) filter (where rn = 3) as s3,   -- oldest of the three
           count(*) as n
      from ranked
     where rn <= 3
     group by lead_id
  )
  select l.id, l.business_name, l.owner_name, l.city, l.primary_crop,
         l.priority_score, l.priority_tier, l.loi_status,
         l.recommended_approach, l.next_best_action,
         round(h.s3 - h.s1, 1) as drop_3          -- points lost (positive)
    from last3 h
    join public.leads l on l.id = h.lead_id
   where h.n >= 3 and h.s1 < h.s2 and h.s2 < h.s3   -- strictly declining
     and l.loi_status not in ('loi_signed', 'declined')      -- still winnable
     and coalesce(l.priority_tier, 'P4') in ('P1', 'P2', 'P3') -- worth attention
   order by drop_3 desc
   limit 25;

grant select on public.lead_cooling_off to anon, authenticated;
