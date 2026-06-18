// ─────────────────────────────────────────────────────────────────────────
// Business profile — the single source of truth for identity that everything
// (branding, AI prompts, outreach drafts, digest, map center) reads from.
//
// Every value is overridable via env (all NEXT_PUBLIC_ so client + server see
// them) with no code changes. Defaults reflect the current working assumptions,
// but NONE of this is hard-committed — set the env var when a decision is made.
//
//   NEXT_PUBLIC_BUSINESS_NAME       e.g. "1COMMERCE Drone Ops"  ("" to blank it)
//   NEXT_PUBLIC_BUSINESS_TAGLINE    e.g. "Drone Ops"
//   NEXT_PUBLIC_BUSINESS_SIGNER     person who signs outreach; "" → "[Your name]"
//   NEXT_PUBLIC_BUSINESS_CITY       e.g. "Canby, Oregon"  ("" → no location claims)
//   NEXT_PUBLIC_BUSINESS_REGION     e.g. "Oregon's Willamette Valley"
//   NEXT_PUBLIC_BUSINESS_EQUIPMENT  e.g. "DJI Agras T50"
//   NEXT_PUBLIC_BUSINESS_RADIUS_MI  service radius in miles
//   NEXT_PUBLIC_BUSINESS_LAT / _LON map + weather center
// ─────────────────────────────────────────────────────────────────────────

const num = (v: string | undefined, fallback: number) =>
  v != null && v !== '' && !Number.isNaN(Number(v)) ? Number(v) : fallback

// `??` (not `||`) so an explicit empty string is honored as "intentionally blank".
const str = (v: string | undefined, fallback: string) => (v ?? fallback)

export const BUSINESS = {
  name: str(process.env.NEXT_PUBLIC_BUSINESS_NAME, '1COMMERCE Drone Ops'),
  tagline: str(process.env.NEXT_PUBLIC_BUSINESS_TAGLINE, 'Drone Ops'),
  signer: str(process.env.NEXT_PUBLIC_BUSINESS_SIGNER, ''),
  city: str(process.env.NEXT_PUBLIC_BUSINESS_CITY, 'Canby, Oregon'),
  region: str(process.env.NEXT_PUBLIC_BUSINESS_REGION, "Oregon's Willamette Valley"),
  equipment: str(process.env.NEXT_PUBLIC_BUSINESS_EQUIPMENT, 'DJI Agras T50'),
  // The kind of operation, used in AI prompts ("a ___ business") and copy.
  // Override for non-ag operators, e.g. "drone mapping & inspection".
  industry: str(process.env.NEXT_PUBLIC_BUSINESS_INDUSTRY, 'drone services'),
  serviceRadiusMi: num(process.env.NEXT_PUBLIC_BUSINESS_RADIUS_MI, 60),
  hqLat: num(process.env.NEXT_PUBLIC_BUSINESS_LAT, 45.2662),
  hqLon: num(process.env.NEXT_PUBLIC_BUSINESS_LON, -122.6926),
}

/** Short city (drops state), e.g. "Canby". Empty if no city configured. */
export const CITY_SHORT = BUSINESS.city ? BUSINESS.city.split(',')[0].trim() : ''

// ─────────────────────────────────────────────────────────────────────────
// Product identity (white-label). The PRODUCT is the software platform
// ("Sortie"); the BUSINESS above is the tenant/workspace using it. Both are
// env-overridable so any licensee can rebrand without code changes:
//   NEXT_PUBLIC_PRODUCT_NAME      e.g. "Sortie"
//   NEXT_PUBLIC_PRODUCT_TAGLINE   e.g. "Drone Operations Platform"
//   NEXT_PUBLIC_ASSISTANT_NAME    the built-in AI's name, e.g. "Ace"
// ─────────────────────────────────────────────────────────────────────────
export const PRODUCT_NAME = str(process.env.NEXT_PUBLIC_PRODUCT_NAME, 'Sortie')
export const PRODUCT_TAGLINE = str(process.env.NEXT_PUBLIC_PRODUCT_TAGLINE, 'Drone Operations Platform')
export const ASSISTANT_NAME = str(process.env.NEXT_PUBLIC_ASSISTANT_NAME, 'Ace')

// Apollo prospecting (org search) requires a paid Apollo plan with API access.
// Off by default so the Discover source toggle stays hidden until you opt in:
//   NEXT_PUBLIC_APOLLO_PROSPECTING=true
export const APOLLO_PROSPECTING_ENABLED =
  String(process.env.NEXT_PUBLIC_APOLLO_PROSPECTING ?? '').toLowerCase() === 'true'

// Label for the precision-intelligence module (the satellite/risk hub). Ag
// tenants may set "EFB Intel"; the de-ag default is the neutral "Intel".
//   NEXT_PUBLIC_INTEL_LABEL   nav label, e.g. "Intel" | "EFB Intel"
//   NEXT_PUBLIC_INTEL_TITLE   page heading, e.g. "Intelligence Hub"
export const INTEL_LABEL = str(process.env.NEXT_PUBLIC_INTEL_LABEL, 'Intel')
export const INTEL_TITLE = str(process.env.NEXT_PUBLIC_INTEL_TITLE, 'Intelligence Hub')

/** Short phrase for AI prompt preambles: "a <industry> business". */
export const INDUSTRY_DESC = `a ${BUSINESS.industry} business`

/** Display name with safe fallback for branding. */
export const BRAND_NAME = BUSINESS.name || 'Drone Ops'

/** Outreach sign-off — uses a clear placeholder when the signer is undecided. */
export const OUTREACH_SIGNOFF = [BUSINESS.signer || '[Your name]', BUSINESS.name]
  .filter(Boolean)
  .join(' — ')

// The services description that grounds AI prompts. Defaults to the current ag
// operation, but a non-ag licensee can fully re-aim the assistant/outreach by
// setting NEXT_PUBLIC_BUSINESS_SERVICES — no code change.
const DEFAULT_SERVICES = `Core service: agricultural spraying and crop scouting with ${BUSINESS.equipment} spray drones — especially Eastern Filbert Blight (EFB) treatment and scouting for hazelnut orchards, plus fungicide/pesticide application for orchards, vineyards, berries, nurseries, grass seed and row crops. Secondary verticals: aerial imaging for insurance, real estate, and construction. Ideal customers are growers${
  CITY_SHORT ? ` within roughly ${BUSINESS.serviceRadiusMi} miles of ${CITY_SHORT}` : ''
} with treatable acreage and a recurring spray or scouting need.`

export const BUSINESS_SERVICES = str(process.env.NEXT_PUBLIC_BUSINESS_SERVICES, DEFAULT_SERVICES)

/** Reusable AI-prompt context. Omits location claims when no city is set. */
export const BUSINESS_CONTEXT = `${BUSINESS.name || 'This'} is ${INDUSTRY_DESC}${
  BUSINESS.city ? ` based in ${BUSINESS.city}` : ''
}${BUSINESS.region ? ` (${BUSINESS.region})` : ''}. ${BUSINESS_SERVICES}`
