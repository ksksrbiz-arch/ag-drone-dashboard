import type { Vertical } from '@/lib/supabase'

// Drone-service prospecting categories. Each maps to a `vertical` (for the
// dashboard's coarse filter) plus a granular `tag`, and carries a prompt
// describing the kinds of businesses/orgs that are strong prospects.
//
// `queries` are short base phrases the Brave/Tavily search stage runs (a
// location suffix is appended at search time); `prompt` is the richer context
// the Groq inference stage reasons over when turning hits into lead stubs.
export interface DiscoveryCategory {
  key: string
  label: string
  vertical: Vertical
  tag: string
  prompt: string
  queries: string[]
}

export const DISCOVERY_CATEGORIES: DiscoveryCategory[] = [
  {
    key: 'roof',
    label: 'Roof & property inspection',
    vertical: 'insurance',
    tag: 'roof-inspection',
    prompt:
      'roofing contractors, exterior/restoration contractors, property & casualty insurance adjusters, and property management companies / HOAs that need roof and property-condition inspections, hail/storm damage assessment, and claims documentation',
    queries: [
      'roofing contractors',
      'storm and hail damage roof inspection',
      'property restoration contractors',
      'property management companies',
    ],
  },
  {
    key: 'real_estate',
    label: 'Real estate aerial',
    vertical: 'real_estate',
    tag: 'aerial-listing',
    prompt:
      'real estate brokerages, high-volume listing agents, land & farm realtors, and property developers that need aerial listing photos/video, lot and acreage maps, and neighborhood context for marketing',
    queries: [
      'real estate brokerages',
      'land and farm realtors',
      'top listing real estate agents',
      'property developers',
    ],
  },
  {
    key: 'construction',
    label: 'Construction & survey',
    vertical: 'construction',
    tag: 'site-mapping',
    prompt:
      'general contractors, civil and site-work contractors, excavation/grading firms, and land surveyors that need site progress documentation, stockpile volumetrics, and orthomosaic site maps',
    queries: [
      'general contractors',
      'excavation and grading contractors',
      'civil site work contractors',
      'land surveyors',
    ],
  },
  {
    key: 'solar',
    label: 'Solar & infrastructure',
    vertical: 'energy',
    tag: 'solar-infra',
    prompt:
      'solar installers and solar farm operators, electric utilities and rural electric co-ops, and telecom/cell-tower companies that need thermal and visual inspection of panels, substations, power lines, and towers',
    queries: [
      'solar installers',
      'solar energy companies',
      'electric utility cooperative',
      'telecom and cell tower companies',
    ],
  },
]

export const categoryByKey = (key: string) => DISCOVERY_CATEGORIES.find(c => c.key === key)
