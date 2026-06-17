import type { Vertical } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────
// Per-vertical service framing for the enrichment researcher. Keeps the
// "recommended_approach" (and the research lens) industry-appropriate instead
// of assuming agriculture for every lead.
// ─────────────────────────────────────────────────────────────────────────

export interface VerticalProfile {
  /** What we offer this kind of customer. */
  service: string
  /** What the recommended_approach should emphasize for this vertical. */
  approachFocus: string
}

export const VERTICAL_PROFILES: Record<Vertical, VerticalProfile> = {
  ag_spray: {
    service: 'agricultural spraying & crop scouting (especially Eastern Filbert Blight treatment for hazelnut orchards)',
    approachFocus:
      'crop & disease pressure, treatable acreage, spray/scout timing, and the best way to reach the grower or farm operator',
  },
  insurance: {
    service: 'roof & property inspection — hail/storm damage assessment, insurance-claim documentation, and pre-listing roof checks',
    approachFocus:
      'recent storm/claims activity, roof & property condition needs, inspection turnaround speed, and the adjuster, owner, or property manager to contact',
  },
  real_estate: {
    service: 'aerial listing photography/video and property & lot maps',
    approachFocus:
      'listing volume, high-value or land/acreage listings, marketing differentiation, and the agent or broker to contact',
  },
  construction: {
    service: 'construction site progress mapping, stockpile volumetrics, and orthomosaic site surveys',
    approachFocus:
      'active project scale & timeline, mapping/survey cadence, and the project manager, superintendent, or surveyor to contact',
  },
  energy: {
    service: 'thermal & visual inspection of solar arrays, substations, power lines, and telecom towers',
    approachFocus:
      'asset count/size (panels, towers, line miles), inspection frequency & compliance needs, and the operations or asset manager to contact',
  },
  mapping: {
    service: 'aerial mapping & orthomosaic/3D modeling — high-resolution site maps, topographic models, and digital twins',
    approachFocus:
      'project area size, mapping cadence & accuracy needs, GIS/CAD deliverable requirements, and the GIS lead, planner, or project manager to contact',
  },
  inspection: {
    service: 'drone inspection of structures & assets — roofs, bridges, towers, façades, and industrial equipment',
    approachFocus:
      'asset count/type & condition, inspection frequency & compliance/safety needs, access difficulty, and the facilities or asset manager to contact',
  },
  survey: {
    service: 'aerial land surveying — boundary, topographic, and volumetric surveys at survey-grade accuracy',
    approachFocus:
      'parcel/site size, survey type & accuracy (RTK/PPK) needs, project timeline, and the surveyor, civil engineer, or land owner to contact',
  },
  delivery: {
    service: 'drone delivery & logistics — short-haul payload transport for time-sensitive goods',
    approachFocus:
      'route frequency & payload weight, distance/regulatory corridor, reliability & SLA needs, and the operations or logistics manager to contact',
  },
}

export function verticalProfile(v: Vertical | null | undefined): VerticalProfile {
  return VERTICAL_PROFILES[v ?? 'ag_spray'] ?? VERTICAL_PROFILES.ag_spray
}

/** Extra system-prompt segment tailoring research to a lead's vertical. */
export function verticalGuidance(v: Vertical | null | undefined): string {
  const p = verticalProfile(v)
  return `\n\nTHIS lead's vertical is "${v ?? 'ag_spray'}". For this lead, our service is: ${p.service}. The "recommended_approach" must focus on: ${p.approachFocus}. Use language appropriate to this industry — do NOT assume agriculture/spraying unless the vertical is ag_spray. For non-agricultural verticals, treat crop/acreage fields as not applicable (return null) and instead capture the relevant operating signals in research_summary.`
}
