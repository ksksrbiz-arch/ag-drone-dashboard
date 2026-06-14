import { getAdminClient, writeMode } from '@/lib/supabaseAdmin'

// ─────────────────────────────────────────────────────────────────────────
// Parcel → Lead import.
//
// Pulls qualified agricultural parcels from a commercial parcel API (ReportAll
// USA; Regrid scaffolded) for a set of ZIP codes, keeps the ones that look like
// real spray prospects (private owner, sensible acreage, actual cultivated crop
// cover), and writes them in as ag-spray leads — with the true parcel boundary
// stored in `fields` so it renders on the maps.
//
// Designed to be quota-aware: parcel APIs bill per record returned, so callers
// pass a per-ZIP fetch cap and a target lead count.
// ─────────────────────────────────────────────────────────────────────────

const CANBY = { lat: 45.2662, lon: -122.6926 }

// Hazelnut-belt ZIPs per surrounding county (extend as needed).
export const COUNTY_ZIPS: Record<string, { zips: string[]; cityByZip: Record<string, string> }> = {
  Clackamas: {
    zips: ['97013', '97038', '97042', '97004', '97070'],
    cityByZip: { '97013': 'Canby', '97038': 'Molalla', '97042': 'Mulino', '97004': 'Beavercreek', '97070': 'Wilsonville' },
  },
  Yamhill: {
    zips: ['97132', '97115', '97148', '97111', '97114', '97127', '97101', '97128'],
    cityByZip: { '97132': 'Newberg', '97115': 'Dundee', '97148': 'Yamhill', '97111': 'Carlton', '97114': 'Dayton', '97127': 'Lafayette', '97101': 'Amity', '97128': 'McMinnville' },
  },
  Polk: {
    zips: ['97338', '97361', '97351', '97371', '97304'],
    cityByZip: { '97338': 'Dallas', '97361': 'Monmouth', '97351': 'Independence', '97371': 'Rickreall', '97304': 'Salem' },
  },
}

const GOV = /\b(UNITED STATES|USA|U S A|STATE OF|OF OREGON|DEPT|DEPARTMENT|BUREAU|BLM|COUNTY OF|CITY OF|PORT OF|SCH DIST|SCHOOL|DIST #|DIST NO|METRO|FEDERAL|HOMES|HOMEOWNER|DEVELOPMENT|HOA|CHURCH|CEMETERY|DRAINAGE|IRRIGATION|WATER DIST)\b/i

const ORCHARD = new Set([
  'Other Tree Crops', 'Hazelnut', 'Hazelnuts', 'Walnuts', 'Almonds', 'Cherries',
  'Apples', 'Pears', 'Peaches', 'Pecans', 'Citrus', 'Apricots', 'Nectarines', 'Plums', 'Prunes',
])
const CULTIVATED = new Set<string>([
  ...ORCHARD,
  'Grapes', 'Caneberries', 'Blueberries', 'Strawberries', 'Hops', 'Christmas Trees',
  'Sod/Grass Seed', 'Other Crops', 'Corn', 'Sweet Corn', 'Winter Wheat', 'Spring Wheat',
  'Barley', 'Oats', 'Rye', 'Triticale', 'Clover/Wildflowers', 'Alfalfa', 'Other Hay/Non Alfalfa',
  'Mint', 'Onions', 'Potatoes', 'Squash', 'Pumpkins', 'Peas', 'Dry Beans', 'Canola',
  'Sugarbeets', 'Garlic', 'Broccoli', 'Carrots', 'Lettuce', 'Greens', 'Radishes', 'Turnips',
])

export interface ImportOptions {
  counties?: string[] // defaults to all in COUNTY_ZIPS
  perCountyTarget?: number // qualified leads to collect per county
  perZipFetchCap?: number // max records fetched per ZIP (quota guard)
  minAcres?: number
  maxAcres?: number
  dryRun?: boolean
}

export interface ImportSummary {
  provider: string
  fetched: number // ≈ API credits consumed
  qualified: number
  inserted: number
  fields: number
  byCounty: Record<string, number>
  writeMode: typeof writeMode
  dryRun: boolean
  sample: { owner: string; county: string; crop: string; acres: number }[]
}

interface QualifiedLead {
  id: string
  owner: string
  address: string
  city: string
  county: string
  zip: string
  lat: number
  lon: number
  acres: number
  crop: string
  geomWkt: string | null
}

function haversineMi(lat: number, lon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 3958.8
  const dLat = toRad(lat - CANBY.lat)
  const dLon = toRad(lon - CANBY.lon)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(CANBY.lat)) * Math.cos(toRad(lat)) * Math.sin(dLon / 2) ** 2
  return Math.round(R * 2 * Math.asin(Math.sqrt(a)) * 10) / 10
}

// ── Provider: ReportAll USA ───────────────────────────────────────────────
async function* reportAllByZip(zip: string, fetchCap: number): AsyncGenerator<any> {
  const key = process.env.REPORTALL_CLIENT_KEY
  if (!key) throw new Error('REPORTALL_CLIENT_KEY not configured')
  let page = 1
  let pulled = 0
  while (pulled < fetchCap) {
    const url =
      `https://reportallusa.com/api/parcels?client=${encodeURIComponent(key)}&v=9` +
      `&zip_code=${zip}&land_use_class=Agricultural&rpp=50&page=${page}`
    const res = await fetch(url)
    if (!res.ok) break
    const json: any = await res.json()
    const results: any[] = json?.results ?? []
    if (!results.length) break
    for (const r of results) {
      pulled++
      yield r
      if (pulled >= fetchCap) break
    }
    page++
  }
}

function cultivatedSummary(cropCover: Record<string, number> | null | undefined): {
  cultAcres: number
  orchardAcres: number
  dominant: string | null
} {
  if (!cropCover || typeof cropCover !== 'object') return { cultAcres: 0, orchardAcres: 0, dominant: null }
  let cult = 0
  let orchard = 0
  let dominant: string | null = null
  let domVal = 0
  for (const [k, v] of Object.entries(cropCover)) {
    if (typeof v !== 'number') continue
    if (CULTIVATED.has(k)) {
      cult += v
      if (v > domVal) {
        domVal = v
        dominant = k
      }
    }
    if (ORCHARD.has(k)) orchard += v
  }
  return { cultAcres: cult, orchardAcres: orchard, dominant }
}

function cropLabel(dominant: string | null, orchardAcres: number): string {
  if (orchardAcres >= 2) return 'Hazelnut/Orchard'
  if (dominant === 'Sod/Grass Seed') return 'Grass Seed'
  return dominant ?? 'Mixed Ag'
}

/** Convert a WKT MULTIPOLYGON to a GeoJSON MultiPolygon (recursive paren parse). */
export function wktToGeoJson(wkt: string): { type: 'MultiPolygon'; coordinates: number[][][][] } | null {
  if (!wkt || !/^MULTIPOLYGON/i.test(wkt.trim())) return null
  const body = wkt.slice(wkt.indexOf('('))
  let pos = 0
  const parse = (): any => {
    if (body[pos] !== '(') return null
    pos++
    if (body[pos] === '(') {
      const items: any[] = []
      for (;;) {
        items.push(parse())
        if (body[pos] === ',') {
          pos++
          continue
        }
        break
      }
      if (body[pos] === ')') pos++
      return items
    }
    const end = body.indexOf(')', pos)
    const coords: number[][] = []
    for (const pair of body.slice(pos, end).split(',')) {
      const xy = pair.trim().split(/\s+/)
      if (xy.length >= 2) coords.push([Math.round(+xy[0] * 1e6) / 1e6, Math.round(+xy[1] * 1e6) / 1e6])
    }
    pos = end + 1
    return coords
  }
  const coordinates = parse()
  if (!coordinates) return null
  return { type: 'MultiPolygon', coordinates }
}

function centroid(geom: { coordinates: number[][][][] }): [number, number] {
  const xs: number[] = []
  const ys: number[] = []
  for (const poly of geom.coordinates) for (const ring of poly) for (const [x, y] of ring) {
    xs.push(x)
    ys.push(y)
  }
  return [
    Math.round((ys.reduce((s, n) => s + n, 0) / ys.length) * 1e6) / 1e6,
    Math.round((xs.reduce((s, n) => s + n, 0) / xs.length) * 1e6) / 1e6,
  ]
}

export async function importParcels(opts: ImportOptions = {}): Promise<ImportSummary> {
  const counties = opts.counties ?? Object.keys(COUNTY_ZIPS)
  const perCountyTarget = opts.perCountyTarget ?? 50
  const perZipFetchCap = opts.perZipFetchCap ?? 60
  const minAcres = opts.minAcres ?? 5
  const maxAcres = opts.maxAcres ?? 600

  const leads: QualifiedLead[] = []
  const seenParcel = new Set<string>()
  let fetched = 0

  for (const county of counties) {
    const cfg = COUNTY_ZIPS[county]
    if (!cfg) continue
    let got = 0
    for (const zip of cfg.zips) {
      if (got >= perCountyTarget) break
      for await (const r of reportAllByZip(zip, perZipFetchCap)) {
        fetched++
        const owner = String(r.owner ?? '').trim()
        if (!owner || GOV.test(owner)) continue
        const acres = Number(r.acreage_calc)
        if (!Number.isFinite(acres) || acres < minAcres || acres > maxAcres) continue
        const lat = Number(r.latitude)
        const lon = Number(r.longitude)
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
        const { cultAcres, orchardAcres, dominant } = cultivatedSummary(r.crop_cover)
        if (cultAcres < 2 || cultAcres / Math.max(acres, 1) < 0.1) continue
        const parcelId = String(r.parcel_id ?? `${zip}-${owner}`)
        if (seenParcel.has(parcelId)) continue
        seenParcel.add(parcelId)
        let situs = String(r.address ?? '').trim()
        if (!situs || situs.toUpperCase() === 'NO SITUS') situs = String(r.mail_address1 ?? '').trim()
        leads.push({
          id: crypto.randomUUID(),
          owner,
          address: situs,
          city: cfg.cityByZip[zip] ?? String(r.muni_name ?? ''),
          county,
          zip,
          lat,
          lon,
          acres: Math.round(acres * 10) / 10,
          crop: cropLabel(dominant, orchardAcres),
          geomWkt: r.geom_as_wkt ?? null,
        })
        got++
        if (got >= perCountyTarget) break
      }
    }
  }

  // One lead per (owner, county) — matches the DB unique constraint.
  const byOwner = new Map<string, QualifiedLead>()
  for (const l of leads) {
    const k = `${l.owner}|${l.county}`
    if (!byOwner.has(k)) byOwner.set(k, l)
  }
  const finalLeads = [...byOwner.values()]

  const byCounty = finalLeads.reduce((acc, l) => {
    acc[l.county] = (acc[l.county] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  const summary: ImportSummary = {
    provider: 'reportall',
    fetched,
    qualified: finalLeads.length,
    inserted: 0,
    fields: 0,
    byCounty,
    writeMode,
    dryRun: !!opts.dryRun,
    sample: finalLeads.slice(0, 8).map(l => ({ owner: l.owner, county: l.county, crop: l.crop, acres: l.acres })),
  }
  if (opts.dryRun) return summary

  const supabase = getAdminClient()
  for (const l of finalLeads) {
    const { error } = await supabase
      .from('leads')
      .insert({
        id: l.id,
        owner_name: l.owner,
        vertical: 'ag_spray',
        address_physical: l.address || null,
        city: l.city || null,
        county: l.county,
        state: 'OR',
        zipcode: l.zip,
        lat: l.lat,
        lon: l.lon,
        distance_to_canby_mi: haversineMi(l.lat, l.lon),
        est_acreage: l.acres,
        primary_crop: l.crop,
        source: 'reportall',
        loi_status: 'not_contacted',
        tags: ['reportall', l.crop.toLowerCase()],
      })
      .select('id')
    if (error) continue // unique-constraint clash or transient — skip
    summary.inserted++

    if (l.geomWkt) {
      const geom = wktToGeoJson(l.geomWkt)
      if (geom) {
        const [cLat, cLon] = centroid(geom)
        const { error: fErr } = await supabase.from('fields').insert({
          name: `${l.owner.slice(0, 40)} parcel`,
          lead_id: l.id,
          crop: l.crop,
          acreage: l.acres,
          boundary: geom,
          center_lat: cLat,
          center_lon: cLon,
        })
        if (!fErr) summary.fields++
      }
    }
  }

  return summary
}
