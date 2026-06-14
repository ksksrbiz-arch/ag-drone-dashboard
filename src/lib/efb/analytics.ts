import type { Lead } from '@/lib/supabase'
import { assessEfb, effectiveRisk, type RiskBand, type SprayWindow } from './scoring'

// ─────────────────────────────────────────────────────────────────────────
// Client-side EFB analytics — rollups & exports for the Intel Hub dashboard.
// All derived live from the parcel set so the dashboard works even before the
// server recompute/migration has run.
// ─────────────────────────────────────────────────────────────────────────

export interface Rollup {
  key: string
  parcels: number
  acres: number
  avgRisk: number
  treatNow: number
  topRisk: number
}

function rollupBy(leads: Lead[], keyFn: (l: Lead) => string | null): Rollup[] {
  const map = new Map<string, Lead[]>()
  for (const l of leads) {
    const k = keyFn(l)
    if (!k) continue
    const arr = map.get(k) ?? []
    arr.push(l)
    map.set(k, arr)
  }
  const out: Rollup[] = []
  for (const [key, group] of map) {
    const risks = group.map(effectiveRisk)
    out.push({
      key,
      parcels: group.length,
      acres: Math.round(group.reduce((s, l) => s + (l.est_acreage ?? 0), 0)),
      avgRisk: Math.round(risks.reduce((s, r) => s + r, 0) / group.length),
      treatNow: group.filter(l => actionOf(l) === 'TREAT_NOW').length,
      topRisk: Math.max(...risks),
    })
  }
  return out.sort((a, b) => b.avgRisk - a.avgRisk)
}

export const rollupByCounty = (leads: Lead[]) => rollupBy(leads, l => l.county)
export const rollupByCrop = (leads: Lead[]) => rollupBy(leads, l => l.primary_crop)

/** Live action recommendation — stored if present, else freshly assessed. */
export function actionOf(l: Lead): string {
  return l.action_recommendation ?? assessEfb(l).action
}

export function bandDistribution(leads: Lead[]): Record<RiskBand, number> {
  const out: Record<RiskBand, number> = { critical: 0, high: 0, elevated: 0, low: 0 }
  for (const l of leads) out[assessEfb(l).band]++
  return out
}

export function sprayWindowDistribution(leads: Lead[]): Record<SprayWindow, number> {
  const out: Record<SprayWindow, number> = { optimal: 0, narrowing: 0, poor: 0, unknown: 0 }
  for (const l of leads) {
    const w = l.spray_window_status ?? assessEfb(l).sprayWindow
    out[w]++
  }
  return out
}

/** Acreage exposed at each risk band (critical/high) — drives the "acres at risk" KPI. */
export function acresAtRisk(leads: Lead[]): number {
  return Math.round(
    leads.filter(l => effectiveRisk(l) >= 55).reduce((s, l) => s + (l.est_acreage ?? 0), 0)
  )
}

// ── CSV export ────────────────────────────────────────────────────────────
const CSV_COLS: { header: string; get: (l: Lead) => string | number }[] = [
  { header: 'Business', get: l => l.business_name ?? l.owner_name ?? '' },
  { header: 'City', get: l => l.city ?? '' },
  { header: 'County', get: l => l.county ?? '' },
  { header: 'Crop', get: l => l.primary_crop ?? '' },
  { header: 'Acreage', get: l => l.est_acreage ?? '' },
  { header: 'EFB Risk', get: l => effectiveRisk(l) },
  { header: 'Action', get: l => actionOf(l) },
  { header: 'Spray Window', get: l => l.spray_window_status ?? assessEfb(l).sprayWindow },
  { header: 'Trend', get: l => l.risk_trend ?? '' },
  { header: 'Weather', get: l => l.efb_weather_risk ?? '' },
  { header: 'Leaf Wetness h', get: l => l.leaf_wetness_hours ?? '' },
  { header: 'ML Risk', get: l => l.ml_efb_risk ?? '' },
  { header: 'ML Conf', get: l => l.ml_confidence ?? '' },
  { header: 'Phone', get: l => l.phone ?? '' },
  { header: 'Email', get: l => l.email ?? '' },
]

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function leadsToCsv(leads: Lead[]): string {
  const head = CSV_COLS.map(c => c.header).join(',')
  const rows = leads.map(l => CSV_COLS.map(c => csvCell(c.get(l))).join(','))
  return [head, ...rows].join('\n')
}

export function downloadCsv(leads: Lead[], filename = 'efb-risk-export.csv') {
  const blob = new Blob([leadsToCsv(leads)], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
