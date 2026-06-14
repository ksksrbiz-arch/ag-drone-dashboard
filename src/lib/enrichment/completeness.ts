import type { Lead } from '@/lib/supabase'

// Fields that make a lead actionable for outreach + ops. Data completeness is
// the share of these that are populated — it feeds the Automation dashboard and
// tells the engine which records still need research.
const KEY_FIELDS: (keyof Lead)[] = [
  'business_name',
  'owner_name',
  'contact_name',
  'primary_crop',
  'est_acreage',
  'phone',
  'email',
  'website',
  'address_physical',
  'city',
  'county',
]

function present(v: unknown): boolean {
  if (v == null) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (typeof v === 'number') return !Number.isNaN(v)
  return true
}

/** 0..100 — percentage of key outreach/ops fields populated. */
export function computeCompleteness(lead: Lead): number {
  const filled = KEY_FIELDS.reduce(
    (n, f) => n + (present(lead[f]) ? 1 : 0),
    0
  )
  return Math.round((filled / KEY_FIELDS.length) * 100)
}

/** Field names that are still empty — the research pass targets these first. */
export function missingFields(lead: Lead): string[] {
  return KEY_FIELDS.filter(f => !present(lead[f])) as string[]
}
