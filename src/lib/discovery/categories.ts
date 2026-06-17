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
  {
    key: 'ag_spray',
    label: 'Ag spraying & scouting',
    vertical: 'ag_spray',
    tag: 'ag-spray',
    prompt:
      'orchards, vineyards, berry and hazelnut growers, nurseries, grass-seed and row-crop farms, and ag co-ops/custom applicators that need aerial spraying, fungicide/pesticide application, and crop scouting',
    queries: [
      'orchards and vineyards',
      'hazelnut and berry growers',
      'plant nurseries and grass seed farms',
      'agricultural cooperative custom applicator',
    ],
  },
  {
    key: 'mapping',
    label: 'Mapping & GIS',
    vertical: 'mapping',
    tag: 'aerial-mapping',
    prompt:
      'civil engineering and land-planning firms, GIS departments, municipalities and public-works agencies, and developers that need orthomosaic maps, topographic models, volumetrics, and 3D site/digital-twin deliverables',
    queries: [
      'civil engineering firms',
      'land planning and GIS consultants',
      'city public works department',
      'land developers',
    ],
  },
  {
    key: 'inspection',
    label: 'Structure & asset inspection',
    vertical: 'inspection',
    tag: 'asset-inspection',
    prompt:
      'industrial plants and facility owners, bridge/infrastructure and DOT contractors, commercial property and tower owners, and engineering firms that need drone inspection of roofs, structures, towers, façades, and hard-to-access equipment',
    queries: [
      'industrial facility maintenance',
      'bridge and infrastructure inspection contractors',
      'commercial property management',
      'structural engineering firms',
    ],
  },
  {
    key: 'survey',
    label: 'Land survey',
    vertical: 'survey',
    tag: 'aerial-survey',
    prompt:
      'land surveying companies, civil engineers, title and land-development firms, and large landowners that need survey-grade aerial boundary, topographic, and volumetric surveys (RTK/PPK accuracy)',
    queries: [
      'land surveying companies',
      'civil engineering and surveying',
      'land development firms',
      'topographic survey services',
    ],
  },
  {
    key: 'delivery',
    label: 'Drone delivery & logistics',
    vertical: 'delivery',
    tag: 'drone-delivery',
    prompt:
      'medical/lab and pharmacy couriers, time-sensitive logistics and last-mile delivery operators, and retailers/distributors that could use short-haul drone delivery for payload transport',
    queries: [
      'medical courier and lab logistics',
      'last mile delivery companies',
      'same day courier services',
      'logistics and distribution companies',
    ],
  },
]

export const categoryByKey = (key: string) => DISCOVERY_CATEGORIES.find(c => c.key === key)
