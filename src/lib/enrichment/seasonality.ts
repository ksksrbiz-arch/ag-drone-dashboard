// ─────────────────────────────────────────────────────────────────────────
// Seasonal spray-window timing.
//
// For an ag-spray operator the value of a lead is partly *temporal*: a hazelnut
// grower is worth reaching now if we're heading into the EFB treatment window,
// and far less time-critical in the dormant off-season. This module turns the
// current calendar month + the lead's crop into a 0..1 "act now, it's the
// season" signal that the priority engine folds in (ag verticals only).
//
// Northern-hemisphere / Willamette Valley calendar. Pure and deterministic
// given a date, so it's testable and recomputes cleanly on every run.
// ─────────────────────────────────────────────────────────────────────────

const clamp01 = (n: number) => Math.min(1, Math.max(0, n))

// General ag spraying/scouting cadence by month (1 = Jan … 12 = Dec). Peaks in
// spring green-up through early summer, tapers through harvest into dormancy.
const GENERAL_SEASON: Record<number, number> = {
  1: 0.45, 2: 0.6, 3: 0.85, 4: 1.0, 5: 1.0, 6: 0.9,
  7: 0.75, 8: 0.7, 9: 0.55, 10: 0.45, 11: 0.35, 12: 0.35,
}

// Hazelnut / EFB overlay: dormant copper sprays (late winter) through bud-break
// and early shoot growth (Feb–May) are the critical treatment window.
const HAZELNUT_SEASON: Record<number, number> = {
  1: 0.6, 2: 0.9, 3: 1.0, 4: 1.0, 5: 0.9, 6: 0.7,
  7: 0.55, 8: 0.5, 9: 0.45, 10: 0.4, 11: 0.45, 12: 0.55,
}

const HAZELNUT = /hazelnut|filbert/i

export const MONTH_LABEL = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

export interface SeasonalTiming {
  /** 0..1 — how in-season outreach/treatment is for this crop right now. */
  value: number
  /** Human-readable detail for the factor breakdown. */
  detail: string
}

/**
 * Seasonal timing signal for a crop on a given date (defaults to now). EFB-host
 * crops follow the hazelnut treatment calendar; everything else uses the general
 * spray season. Unknown crops use the general curve (no penalty for missing data).
 */
export function seasonalTiming(
  crop: string | null | undefined,
  date: Date = new Date()
): SeasonalTiming {
  const month = date.getUTCMonth() + 1
  const isHazelnut = crop ? HAZELNUT.test(crop) : false
  const table = isHazelnut ? HAZELNUT_SEASON : GENERAL_SEASON
  const value = clamp01(table[month] ?? 0.5)
  const cal = isHazelnut ? 'EFB/hazelnut window' : 'spray season'
  return { value, detail: `${MONTH_LABEL[month - 1]} · ${cal}` }
}
