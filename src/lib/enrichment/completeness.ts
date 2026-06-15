import type { Lead } from '@/lib/supabase'

// Fields that make a lead actionable for outreach + ops, each weighted by how
// much it matters. Data completeness is the *weighted* share that is populated —
// a lead with a phone and email is far more actionable than one with only a
// county, and the score now reflects that. It feeds the Automation dashboard and
// tells the engine which records still need research.
const FIELD_WEIGHTS: { field: keyof Lead; weight: number }[] = [
  { field: 'business_name', weight: 3 }, // who they are
  { field: 'owner_name', weight: 2 },
  { field: 'contact_name', weight: 2 },
  { field: 'phone', weight: 3 }, // can we reach them
  { field: 'email', weight: 3 },
  { field: 'primary_crop', weight: 2 }, // fit / what to pitch
  { field: 'est_acreage', weight: 2 },
  { field: 'website', weight: 1 },
  { field: 'address_physical', weight: 1 }, // where they are
  { field: 'city', weight: 1 },
  { field: 'county', weight: 1 },
]

// The unweighted field list — the research pass targets these gaps first, and
// callers that just want "which fields are empty" use missingFields().
const KEY_FIELDS = FIELD_WEIGHTS.map(f => f.field)

function present(v: unknown): boolean {
  if (v == null) return false
  if (typeof v === 'string') return v.trim().length > 0
  if (typeof v === 'number') return !Number.isNaN(v)
  return true
}

/** 0..100 — importance-weighted percentage of key outreach/ops fields populated. */
export function computeCompleteness(lead: Lead): number {
  let filled = 0
  let total = 0
  for (const { field, weight } of FIELD_WEIGHTS) {
    total += weight
    if (present(lead[field])) filled += weight
  }
  return total ? Math.round((filled / total) * 100) : 0
}

/** Field names that are still empty — the research pass targets these first. */
export function missingFields(lead: Lead): string[] {
  return KEY_FIELDS.filter(f => !present(lead[f])) as string[]
}
