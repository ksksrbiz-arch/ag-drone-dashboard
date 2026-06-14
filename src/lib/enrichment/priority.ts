import type { Lead, PriorityFactor, PriorityTier } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────
// Algorithmic prioritization.
//
// Deterministic, transparent, and cheap — runs on every lead with no API call.
// Produces a 0..100 composite score, a P1..P4 tier, and a per-factor breakdown
// so the dashboard can show *why* a lead ranks where it does.
// ─────────────────────────────────────────────────────────────────────────

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

// Crop value tier for an ag-spray drone operator: orchards/vineyards/berries
// carry the most recurring treatable acreage and highest per-acre value.
const CROP_VALUE: { match: RegExp; value: number }[] = [
  { match: /hazelnut|filbert/i, value: 1.0 }, // core EFB market
  { match: /orchard|apple|cherry|pear|stone\s?fruit|nut|walnut|almond/i, value: 0.92 },
  { match: /vineyard|grape|wine/i, value: 0.85 },
  { match: /berr|blueberr|caneberr|raspberr|blackberr|strawberr/i, value: 0.82 },
  { match: /hops?/i, value: 0.8 },
  { match: /nursery|christmas tree|greenhouse/i, value: 0.7 },
  { match: /hemp|cannabis/i, value: 0.6 },
  { match: /vegetable|row crop|potato|onion|mint|seed/i, value: 0.5 },
  { match: /grass|hay|wheat|grain|clover|pasture/i, value: 0.4 },
]

function cropValue(crop: string | null | undefined): number {
  if (!crop) return 0.45 // unknown — neutral-ish
  for (const { match, value } of CROP_VALUE) if (match.test(crop)) return value
  return 0.5
}

// Higher = warmer / further along the LOI pipeline.
const STAGE_WARMTH: Record<string, number> = {
  not_contacted: 0.15,
  contacted: 0.45,
  meeting_scheduled: 0.7,
  loi_sent: 0.85,
  loi_signed: 1.0,
  declined: 0.0,
}

const ACTION_URGENCY: Record<string, number> = {
  TREAT_NOW: 1.0,
  SCOUT_NOW: 0.75,
  CONTACT_NOW: 0.6,
  MONITOR: 0.3,
}

interface FactorSpec {
  key: string
  label: string
  weight: number
  value: (l: Lead) => number
}

const FACTORS: FactorSpec[] = [
  {
    key: 'proximity',
    label: 'Proximity to Canby',
    weight: 0.16,
    value: l =>
      l.distance_to_canby_mi == null
        ? 0.5
        : clamp01(1 - l.distance_to_canby_mi / 90),
  },
  {
    key: 'acreage',
    label: 'Treatable acreage',
    weight: 0.15,
    value: l => (l.est_acreage == null ? 0.4 : clamp01(l.est_acreage / 400)),
  },
  {
    key: 'crop_value',
    label: 'Crop value fit',
    weight: 0.13,
    value: l => cropValue(l.primary_crop),
  },
  {
    key: 'efb_urgency',
    label: 'EFB / action urgency',
    weight: 0.15,
    value: l => {
      const risk = l.composite_efb_risk != null ? l.composite_efb_risk / 100 : 0
      const action = l.action_recommendation
        ? ACTION_URGENCY[l.action_recommendation] ?? 0
        : 0
      return clamp01(Math.max(risk, action))
    },
  },
  {
    key: 'revenue',
    label: 'Revenue potential',
    weight: 0.12,
    value: l =>
      l.est_annual_revenue == null
        ? 0.35
        : clamp01(l.est_annual_revenue / 50000),
  },
  {
    key: 'pipeline',
    label: 'Pipeline warmth',
    weight: 0.1,
    value: l => STAGE_WARMTH[l.loi_status] ?? 0.15,
  },
  {
    key: 'contactability',
    label: 'Reachable now',
    weight: 0.09,
    value: l => {
      const phone = l.phone ? 0.6 : 0
      const email = l.email ? 0.4 : 0
      return clamp01(phone + email)
    },
  },
  {
    key: 'lead_score',
    label: 'Base lead score',
    weight: 0.1,
    value: l => (l.lead_score == null ? 0.4 : clamp01(l.lead_score / 100)),
  },
]

export interface PriorityResult {
  score: number // 0..100
  tier: PriorityTier
  factors: PriorityFactor[]
}

export function computePriority(lead: Lead): PriorityResult {
  const factors: PriorityFactor[] = FACTORS.map(f => {
    const value = clamp01(f.value(lead))
    return {
      key: f.key,
      label: f.label,
      weight: f.weight,
      value,
      contribution: Math.round(f.weight * value * 100 * 10) / 10,
    }
  })

  const score = Math.round(factors.reduce((s, f) => s + f.contribution, 0))
  const tier: PriorityTier =
    score >= 75 ? 'P1' : score >= 55 ? 'P2' : score >= 35 ? 'P3' : 'P4'

  return { score, tier, factors }
}
