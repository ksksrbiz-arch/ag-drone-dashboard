import type { Lead, PriorityFactor, PriorityTier } from '@/lib/supabase'
import { CITY_SHORT } from '@/lib/business'
import { seasonalTiming } from './seasonality'

// ─────────────────────────────────────────────────────────────────────────
// Algorithmic prioritization (v3).
//
// Deterministic, transparent, and cheap — runs on every lead with no API call.
// Produces a 0..100 composite score, a P1..P4 tier, a per-factor breakdown, and
// a short plain-language explanation so the dashboard can show *why* a lead
// ranks where it does.
//
// v3 adds four signals on top of the original mix:
//   • EFB urgency now folds in the spray-window score and the risk trend.
//   • Seasonal timing (ag) — is it the treatment season for this crop right now?
//   • Relationship — repeat / paying customers outrank cold names (from jobs).
//   • Engagement recency — recently-touched / new leads edge out dormant ones.
// ─────────────────────────────────────────────────────────────────────────

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const DAY_MS = 24 * 60 * 60 * 1000

/** Relationship / activity signals the engine derives from related rows (jobs). */
export interface PrioritySignals {
  /** Jobs linked to this lead (any status). */
  jobCount?: number
  /** Jobs that have been paid — a proven, billable relationship. */
  paidJobs?: number
}

interface ScoreContext {
  signals: PrioritySignals
  now: Date
}

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

/** Most recent meaningful activity timestamp (not the engine's own writes). */
function lastActivity(lead: Lead): number | null {
  const candidates = [lead.loi_signed_at, lead.loi_sent_at, lead.created_at]
    .map(t => (t ? Date.parse(t) : NaN))
    .filter(n => !Number.isNaN(n))
  return candidates.length ? Math.max(...candidates) : null
}

// Each factor carries an ag-spray weight and a non-ag weight. Ag-specific
// factors (acreage, crop value, EFB urgency, seasonal timing) weigh 0 for non-ag
// verticals; that weight shifts to scale/value, reachability, and base-score
// signals so roof/real-estate/construction/solar leads rank on what matters for
// them. Within each vertical group the weights sum to 1.0 (no renormalization
// needed), but computePriority normalizes defensively in case they ever drift.
interface FactorSpec {
  key: string
  label: string
  agWeight: number
  nonAgWeight: number
  value: (l: Lead, ctx: ScoreContext) => number
  detail?: (l: Lead, ctx: ScoreContext) => string | undefined
}

const FACTORS: FactorSpec[] = [
  {
    key: 'proximity',
    label: CITY_SHORT ? `Proximity to ${CITY_SHORT}` : 'Proximity to HQ',
    agWeight: 0.13,
    nonAgWeight: 0.16,
    value: l =>
      l.distance_to_canby_mi == null
        ? 0.5
        : clamp01(1 - l.distance_to_canby_mi / 90),
    detail: l =>
      l.distance_to_canby_mi == null ? undefined : `${Math.round(l.distance_to_canby_mi)} mi`,
  },
  {
    key: 'acreage',
    label: 'Treatable acreage',
    agWeight: 0.13,
    nonAgWeight: 0, // ag-only
    value: l => (l.est_acreage == null ? 0.4 : clamp01(l.est_acreage / 400)),
    detail: l => (l.est_acreage == null ? undefined : `${Math.round(l.est_acreage)} ac`),
  },
  {
    key: 'crop_value',
    label: 'Crop value fit',
    agWeight: 0.11,
    nonAgWeight: 0, // ag-only
    value: l => cropValue(l.primary_crop),
    detail: l => l.primary_crop ?? undefined,
  },
  {
    key: 'efb_urgency',
    label: 'EFB / action urgency',
    agWeight: 0.15,
    nonAgWeight: 0, // ag-only
    value: l => {
      const risk = l.composite_efb_risk != null ? l.composite_efb_risk / 100 : 0
      const action = l.action_recommendation
        ? ACTION_URGENCY[l.action_recommendation] ?? 0
        : 0
      const spray = l.spray_window_score != null ? l.spray_window_score / 100 : 0
      let base = Math.max(risk, action, spray)
      // A rising risk trend pulls the lead forward; a falling one eases off.
      if (l.risk_trend === 'rising') base += 0.12
      else if (l.risk_trend === 'falling') base -= 0.08
      return clamp01(base)
    },
    detail: l => {
      const parts: string[] = []
      if (l.composite_efb_risk != null) parts.push(`risk ${Math.round(l.composite_efb_risk)}`)
      if (l.action_recommendation) parts.push(l.action_recommendation.replace(/_/g, ' ').toLowerCase())
      if (l.risk_trend === 'rising') parts.push('↑ rising')
      else if (l.risk_trend === 'falling') parts.push('↓ falling')
      return parts.length ? parts.join(' · ') : undefined
    },
  },
  {
    key: 'seasonal_timing',
    label: 'Seasonal timing',
    agWeight: 0.06,
    nonAgWeight: 0, // ag-only
    value: (l, ctx) => seasonalTiming(l.primary_crop, ctx.now).value,
    detail: (l, ctx) => seasonalTiming(l.primary_crop, ctx.now).detail,
  },
  {
    key: 'revenue',
    label: 'Revenue / job-value potential',
    agWeight: 0.1,
    nonAgWeight: 0.26, // primary scale signal for non-ag
    value: l =>
      l.est_annual_revenue == null
        ? 0.35
        : clamp01(l.est_annual_revenue / 50000),
    detail: l =>
      l.est_annual_revenue == null ? undefined : `$${Math.round(l.est_annual_revenue).toLocaleString()}/yr`,
  },
  {
    key: 'relationship',
    label: 'Existing relationship',
    agWeight: 0.06,
    nonAgWeight: 0.07,
    value: (_l, ctx) => {
      const jc = ctx.signals.jobCount
      const pj = ctx.signals.paidJobs ?? 0
      if (jc == null) return 0.4 // unknown (no job lookup) — neutral
      if (pj > 0) return 1.0 // proven, paying customer — repeat / upsell
      if (jc > 0) return 0.65 // has work history
      return 0.3 // known, no jobs yet
    },
    detail: (_l, ctx) => {
      const jc = ctx.signals.jobCount
      if (jc == null) return undefined
      const pj = ctx.signals.paidJobs ?? 0
      return jc === 0 ? 'no jobs yet' : `${jc} job${jc > 1 ? 's' : ''}${pj ? ` · ${pj} paid` : ''}`
    },
  },
  {
    key: 'pipeline',
    label: 'Pipeline warmth',
    agWeight: 0.09,
    nonAgWeight: 0.14,
    value: l => STAGE_WARMTH[l.loi_status] ?? 0.15,
    detail: l => (l.loi_status ? l.loi_status.replace(/_/g, ' ') : undefined),
  },
  {
    key: 'contactability',
    label: 'Reachable now',
    agWeight: 0.08,
    nonAgWeight: 0.16,
    value: l => {
      const phone = l.phone ? 0.6 : 0
      const email = l.email ? 0.4 : 0
      return clamp01(phone + email)
    },
    detail: l => {
      const have = [l.phone ? 'phone' : null, l.email ? 'email' : null].filter(Boolean)
      return have.length ? have.join(' + ') : 'no contact info'
    },
  },
  {
    key: 'engagement',
    label: 'Engagement recency',
    agWeight: 0.05,
    nonAgWeight: 0.05,
    value: (l, ctx) => {
      const ts = lastActivity(l)
      if (ts == null) return 0.4
      const days = (ctx.now.getTime() - ts) / DAY_MS
      // Fresh/new leads ~1.0, decaying to a 0.25 floor by ~45 days dormant.
      return clamp01(0.25 + 0.75 * (1 - days / 45))
    },
    detail: (l, ctx) => {
      const ts = lastActivity(l)
      if (ts == null) return undefined
      const days = Math.max(0, Math.round((ctx.now.getTime() - ts) / DAY_MS))
      return days === 0 ? 'today' : `${days}d ago`
    },
  },
  {
    key: 'lead_score',
    label: 'Base lead score',
    agWeight: 0.04,
    nonAgWeight: 0.16,
    value: l => (l.lead_score == null ? 0.4 : clamp01(l.lead_score / 100)),
    detail: l => (l.lead_score == null ? undefined : `${Math.round(l.lead_score)}/100`),
  },
]

export interface PriorityResult {
  score: number // 0..100
  tier: PriorityTier
  factors: PriorityFactor[]
  /** Short plain-language "why this rank" line for the dashboard + digest. */
  explanation: string
}

/** Optional, opt-in overrides for the scoring weights + tier thresholds. */
export interface ScoringConfig {
  agWeights?: Record<string, number>
  nonAgWeights?: Record<string, number>
  thresholds?: { p1: number; p2: number; p3: number }
}

export const DEFAULT_THRESHOLDS = { p1: 75, p2: 55, p3: 35 }

/** The factor catalog (key/label + default ag/non-ag weights) for the config UI. */
export const SCORING_FACTORS = FACTORS.map(f => ({
  key: f.key,
  label: f.label,
  agWeight: f.agWeight,
  nonAgWeight: f.nonAgWeight,
}))

export function computePriority(
  lead: Lead,
  signals: PrioritySignals = {},
  config: ScoringConfig = {}
): PriorityResult {
  const ctx: ScoreContext = { signals, now: new Date() }
  const isAg = (lead.vertical ?? 'ag_spray') === 'ag_spray'
  const overrides = isAg ? config.agWeights : config.nonAgWeights
  const active = FACTORS.map(f => {
    const base = isAg ? f.agWeight : f.nonAgWeight
    const o = overrides?.[f.key]
    const weight = typeof o === 'number' && o >= 0 ? o : base
    return { f, weight }
  }).filter(x => x.weight > 0)
  const totalWeight = active.reduce((s, x) => s + x.weight, 0) || 1

  const factors: PriorityFactor[] = active.map(({ f, weight }) => {
    const w = weight / totalWeight // normalize defensively
    const value = clamp01(f.value(lead, ctx))
    return {
      key: f.key,
      label: f.label,
      weight: Math.round(w * 1000) / 1000,
      value,
      contribution: Math.round(w * value * 100 * 10) / 10,
      detail: f.detail?.(lead, ctx),
    }
  })

  const score = Math.round(factors.reduce((s, f) => s + f.contribution, 0))
  const th = config.thresholds
  const p1 = th?.p1 ?? DEFAULT_THRESHOLDS.p1
  const p2 = th?.p2 ?? DEFAULT_THRESHOLDS.p2
  const p3 = th?.p3 ?? DEFAULT_THRESHOLDS.p3
  const tier: PriorityTier =
    score >= p1 ? 'P1' : score >= p2 ? 'P2' : score >= p3 ? 'P3' : 'P4'

  return { score, tier, factors, explanation: explain(factors, tier) }
}

/** Build a one-line "top drivers" explanation from the scored factors. */
function explain(factors: PriorityFactor[], tier: PriorityTier): string {
  const top = [...factors]
    .filter(f => f.contribution > 0)
    .sort((a, b) => b.contribution - a.contribution)
    .slice(0, 3)
  if (!top.length) return `${tier} · not enough signal yet`
  return `${tier} · top drivers: ${top.map(f => f.label.toLowerCase()).join(', ')}`
}
