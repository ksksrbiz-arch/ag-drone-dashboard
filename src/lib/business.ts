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

/** Display name with safe fallback for branding. */
export const BRAND_NAME = BUSINESS.name || 'Drone Ops'

/** Outreach sign-off — uses a clear placeholder when the signer is undecided. */
export const OUTREACH_SIGNOFF = [BUSINESS.signer || '[Your name]', BUSINESS.name]
  .filter(Boolean)
  .join(' — ')

/** Reusable AI-prompt context. Omits location claims when no city is set. */
export const BUSINESS_CONTEXT = `${BUSINESS.name || 'This'} is a drone-services company${
  BUSINESS.city ? ` based in ${BUSINESS.city}` : ''
} (${BUSINESS.region}). Core service: agricultural spraying and crop scouting with ${BUSINESS.equipment} spray drones — especially Eastern Filbert Blight (EFB) treatment and scouting for hazelnut orchards, plus fungicide/pesticide application for orchards, vineyards, berries, nurseries, grass seed and row crops. Secondary verticals: aerial imaging for insurance, real estate, and construction. Ideal customers are growers${
  CITY_SHORT ? ` within roughly ${BUSINESS.serviceRadiusMi} miles of ${CITY_SHORT}` : ''
} with treatable acreage and a recurring spray or scouting need.`
