import type { Lead, ActionRec } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────
// EFB Intelligence Engine — deterministic, explainable risk scoring.
//
// Eastern Filbert Blight (EFB) is a fungal disease of hazelnut/filbert orchards.
// Infection pressure is driven by spring leaf-wetness, weather, canopy stress and
// crop susceptibility. This module fuses the raw satellite + weather + ML signals
// that arrive on each parcel into a single transparent picture:
//
//   • composite 0..100 risk          — weighted blend of every available signal
//   • per-factor breakdown           — *why* a parcel scores where it does
//   • action recommendation          — TREAT_NOW / SCOUT_NOW / CONTACT_NOW / MONITOR
//   • confidence 0..1                — how much signal actually backed the score
//   • spray-window assessment        — can we fly a treatment right now?
//
// Pure and dependency-free, so it runs identically in the browser (live map
// analytics) and on the server (the recompute engine that writes back to the DB).
// ─────────────────────────────────────────────────────────────────────────

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const round1 = (n: number) => Math.round(n * 10) / 10

/** Crop susceptibility to EFB. Hazelnuts are the host; everything else is low. */
const CROP_SUSCEPTIBILITY: { match: RegExp; value: number }[] = [
  { match: /hazelnut|filbert/i, value: 1.0 },
  { match: /orchard|nut|walnut|almond/i, value: 0.45 },
  { match: /vineyard|grape|berr|hops?/i, value: 0.25 },
]

export function cropSusceptibility(crop: string | null | undefined): number {
  if (!crop) return 0.5 // unknown — assume a moderate hazelnut-belt parcel
  for (const { match, value } of CROP_SUSCEPTIBILITY) if (match.test(crop)) return value
  return 0.2
}

export interface EfbFactor {
  key: string
  label: string
  weight: number
  value: number // 0..1 normalized
  contribution: number // weight * value * 100, rounded
  /** Whether this factor had real underlying data (vs. a neutral fallback). */
  present: boolean
  detail: string // human-readable source value
}

export type RiskBand = 'critical' | 'high' | 'elevated' | 'low'
export type SprayWindow = 'optimal' | 'narrowing' | 'poor' | 'unknown'

export interface EfbAssessment {
  composite: number // 0..100
  band: RiskBand
  action: ActionRec
  confidence: number // 0..1
  factors: EfbFactor[]
  sprayWindow: SprayWindow
  sprayWindowScore: number // 0..100 (treatability right now)
  summary: string
}

interface FactorSpec {
  key: string
  label: string
  weight: number
  /** Returns [normalizedValue, present, detail]. */
  read: (l: Lead) => [number, boolean, string]
}

const NEUTRAL = 0.4

const FACTORS: FactorSpec[] = [
  {
    key: 'weather',
    label: 'Weather pressure',
    weight: 0.22,
    read: l =>
      l.efb_weather_risk != null
        ? [clamp01(l.efb_weather_risk / 100), true, `${l.efb_weather_risk}/100`]
        : [NEUTRAL, false, 'no weather model'],
  },
  {
    key: 'leaf_wetness',
    label: 'Leaf wetness',
    weight: 0.18,
    // Sustained leaf wetness drives spore germination. ~24h+ is high pressure.
    read: l =>
      l.leaf_wetness_hours != null
        ? [clamp01(l.leaf_wetness_hours / 24), true, `${l.leaf_wetness_hours}h`]
        : [NEUTRAL, false, 'no wetness data'],
  },
  {
    key: 'wetness_anomaly',
    label: 'Wetness vs 10yr norm',
    weight: 0.12,
    // +50% above the climatological norm = saturated infection conditions.
    read: l =>
      l.wetness_anomaly_pct != null
        ? [clamp01(0.5 + l.wetness_anomaly_pct / 100), true, `${l.wetness_anomaly_pct > 0 ? '+' : ''}${l.wetness_anomaly_pct}%`]
        : [NEUTRAL, false, 'no anomaly data'],
  },
  {
    key: 'canopy_stress',
    label: 'Canopy stress',
    weight: 0.14,
    // Lower orchard-health score = a more stressed, more susceptible canopy.
    read: l =>
      l.orchard_health_score != null
        ? [clamp01(1 - l.orchard_health_score / 100), true, `health ${l.orchard_health_score}/100`]
        : [NEUTRAL, false, 'no health score'],
  },
  {
    key: 'ndre_trend',
    label: 'NDRE decline',
    weight: 0.1,
    // A falling NDRE seasonal slope signals canopy vigor loss / early infection.
    read: l => {
      if (l.ndre_seasonal_slope == null) return [NEUTRAL, false, 'no NDRE trend']
      // slope in roughly [-0.01 .. +0.01]; negative = declining = higher risk.
      const v = clamp01(0.5 - l.ndre_seasonal_slope * 50)
      return [v, true, l.ndre_seasonal_slope.toFixed(5)]
    },
  },
  {
    key: 'ml',
    label: 'ML risk model',
    weight: 0.14,
    read: l =>
      l.ml_efb_risk != null
        ? [clamp01(l.ml_efb_risk / 100), true, `${l.ml_efb_risk}/100`]
        : [NEUTRAL, false, 'no ML coverage'],
  },
  {
    key: 'susceptibility',
    label: 'Crop susceptibility',
    weight: 0.1,
    read: l => {
      const v = cropSusceptibility(l.primary_crop)
      return [v, l.primary_crop != null, l.primary_crop ?? 'unknown crop']
    },
  },
]

export function bandFor(composite: number): RiskBand {
  if (composite >= 75) return 'critical'
  if (composite >= 55) return 'high'
  if (composite >= 40) return 'elevated'
  return 'low'
}

/**
 * Spray-window assessment. EFB fungicide must hit dry-ish foliage to adhere, yet
 * the disease pressure that demands treatment comes from wet weather — so the
 * "act now" window is the tension between high need and currently-flyable
 * conditions. Very high active wetness = poor adhesion = narrowing/poor window.
 */
function sprayWindowFor(l: Lead, composite: number): { status: SprayWindow; score: number } {
  if (l.leaf_wetness_hours == null && l.efb_weather_risk == null) {
    return { status: 'unknown', score: 0 }
  }
  const wetness = l.leaf_wetness_hours != null ? clamp01(l.leaf_wetness_hours / 24) : 0.5
  const need = composite / 100
  // Treatability is high when need is high but conditions aren't saturated.
  const treatability = clamp01(need * (1 - wetness * 0.7))
  const score = Math.round(treatability * 100)
  let status: SprayWindow
  if (need < 0.4) status = 'poor' // little need — not worth a flight
  else if (wetness > 0.8) status = 'narrowing' // saturated, hard to adhere
  else if (treatability >= 0.45) status = 'optimal'
  else status = 'narrowing'
  return { status, score }
}

export function assessEfb(lead: Lead): EfbAssessment {
  const factors: EfbFactor[] = FACTORS.map(f => {
    const [raw, present, detail] = f.read(lead)
    const value = clamp01(raw)
    return {
      key: f.key,
      label: f.label,
      weight: f.weight,
      value,
      contribution: round1(f.weight * value * 100),
      present,
      detail,
    }
  })

  const modelComposite = Math.round(factors.reduce((s, f) => s + f.contribution, 0))

  // If an upstream composite already exists, blend it with ours so we never
  // throw away a validated pipeline score — our engine refines, not replaces.
  const composite =
    lead.composite_efb_risk != null
      ? Math.round(lead.composite_efb_risk * 0.5 + modelComposite * 0.5)
      : modelComposite

  // Confidence = how much real signal backed the score, lifted by ML confidence.
  const presentWeight = factors.filter(f => f.present).reduce((s, f) => s + f.weight, 0)
  const totalWeight = factors.reduce((s, f) => s + f.weight, 0)
  const coverage = totalWeight ? presentWeight / totalWeight : 0
  const mlConf = lead.ml_confidence ?? 0
  const confidence = round1(clamp01(coverage * 0.7 + mlConf * 0.3) * 100) / 100

  const band = bandFor(composite)
  const action = recommendAction(lead, composite, band)
  const { status: sprayWindow, score: sprayWindowScore } = sprayWindowFor(lead, composite)

  return {
    composite,
    band,
    action,
    confidence,
    factors,
    sprayWindow,
    sprayWindowScore,
    summary: summarize(lead, composite, band, action, sprayWindow),
  }
}

function recommendAction(lead: Lead, composite: number, band: RiskBand): ActionRec {
  const susceptible = cropSusceptibility(lead.primary_crop) >= 0.5
  // Non-host crops never need EFB treatment — at most a contact/monitor.
  if (!susceptible) return composite >= 55 ? 'CONTACT_NOW' : 'MONITOR'
  if (band === 'critical') return 'TREAT_NOW'
  if (band === 'high') return 'SCOUT_NOW'
  if (band === 'elevated') return 'CONTACT_NOW'
  return 'MONITOR'
}

function summarize(
  lead: Lead,
  composite: number,
  band: RiskBand,
  action: ActionRec,
  spray: SprayWindow
): string {
  const where = lead.primary_crop ?? 'parcel'
  const bandLabel =
    band === 'critical' ? 'Critical' : band === 'high' ? 'High' : band === 'elevated' ? 'Elevated' : 'Low'
  const sprayNote =
    spray === 'optimal'
      ? 'spray window open'
      : spray === 'narrowing'
      ? 'spray window narrowing'
      : spray === 'poor'
      ? 'treatment not warranted'
      : 'spray window unknown'
  const verb =
    action === 'TREAT_NOW'
      ? 'Treat now'
      : action === 'SCOUT_NOW'
      ? 'Scout now'
      : action === 'CONTACT_NOW'
      ? 'Contact grower'
      : 'Monitor'
  return `${bandLabel} EFB risk (${composite}/100) on ${where} — ${verb.toLowerCase()}, ${sprayNote}.`
}

// ── shared display helpers (used by map + dashboard) ──────────────────────

export const BAND_COLOR: Record<RiskBand, string> = {
  critical: '#ef4444',
  high: '#fb923c',
  elevated: '#facc15',
  low: '#4ade80',
}

export const SPRAY_META: Record<SprayWindow, { label: string; cls: string }> = {
  optimal: { label: 'Optimal', cls: 'bg-green-50 text-green-700 border-green-200' },
  narrowing: { label: 'Narrowing', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  poor: { label: 'Not warranted', cls: 'bg-slate-50 text-slate-500 border-slate-200' },
  unknown: { label: 'Unknown', cls: 'bg-slate-50 text-slate-400 border-slate-200' },
}

/** Effective composite for display: prefer the stored composite, else compute. */
export function effectiveRisk(lead: Lead): number {
  if (lead.composite_efb_risk != null) return lead.composite_efb_risk
  return assessEfb(lead).composite
}
