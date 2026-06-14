import { getAdminClient, writeMode } from '@/lib/supabaseAdmin'
import type { FieldGeometry } from '@/lib/geo'
import { geometryAcres, geometryCenter } from '@/lib/geo'

// ─────────────────────────────────────────────────────────────────────────
// Field-boundary backfill — pulls the TRUE parcel polygon for each geocoded
// ag-spray lead from the county's free public GIS (point-in-polygon) and stores
// it in `fields` so the Fields map shows real boundaries, not just points.
//
// Free + quota-less (county ArcGIS services). Marion is wired up; add more
// counties to COUNTY_PARCEL_SERVICES as needed. Leads in counties already
// covered by the ReportAll importer (Clackamas/Yamhill/Polk) get their polygons
// there, so this focuses on the Marion bulk.
// ─────────────────────────────────────────────────────────────────────────

interface CountyService {
  queryUrl: string
  ownerField?: string
  taxlotField?: string
  acresField?: string
}

const COUNTY_PARCEL_SERVICES: Record<string, CountyService> = {
  Marion: {
    queryUrl: 'https://gis.co.marion.or.us/arcgis/rest/services/Public/Parcels/MapServer/0/query',
    ownerField: 'OWNERNAME',
    taxlotField: 'TAXLOT',
    acresField: 'ACRES',
  },
}

export interface ParcelBoundary {
  geometry: FieldGeometry
  acres: number | null
  taxlot: string | null
  center: [number, number] | null // [lat, lon]
}

/** Esri polygon `rings` ([lon,lat] in outSR=4326) → GeoJSON Polygon. */
function ringsToGeoJSON(rings: number[][][]): FieldGeometry | null {
  if (!Array.isArray(rings) || !rings.length) return null
  const coordinates = rings
    .map(ring =>
      ring
        .filter(p => Array.isArray(p) && p.length >= 2)
        .map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6] as [number, number])
    )
    .filter(r => r.length >= 4)
  if (!coordinates.length) return null
  return { type: 'Polygon', coordinates }
}

/** Query the county service for the parcel containing (lat, lon). */
export async function fetchParcelBoundary(
  lat: number,
  lon: number,
  county: string
): Promise<ParcelBoundary | null> {
  const svc = COUNTY_PARCEL_SERVICES[county]
  if (!svc) return null

  const params = new URLSearchParams({
    geometry: `${lon},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    outSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    returnGeometry: 'true',
    outFields: '*',
    f: 'json',
  })

  let json: any
  try {
    const res = await fetch(`${svc.queryUrl}?${params.toString()}`)
    if (!res.ok) return null
    json = await res.json()
  } catch {
    return null
  }

  const feat = json?.features?.[0]
  if (!feat?.geometry?.rings) return null
  const geometry = ringsToGeoJSON(feat.geometry.rings)
  if (!geometry) return null

  const attrs = feat.attributes ?? {}
  const acresRaw = svc.acresField ? Number(attrs[svc.acresField]) : NaN
  const acres = Number.isFinite(acresRaw) ? Math.round(acresRaw * 10) / 10 : Math.round(geometryAcres(geometry) * 10) / 10

  return {
    geometry,
    acres,
    taxlot: svc.taxlotField ? (attrs[svc.taxlotField] ?? null) : null,
    center: geometryCenter(geometry),
  }
}

export interface BoundaryBackfillSummary {
  trigger: string
  candidates: number
  matched: number
  inserted: number
  durationMs: number
  writeMode: typeof writeMode
  byCounty: Record<string, number>
}

const CONCURRENCY = 4

export async function runBoundaryBackfill(opts: {
  trigger: string
  limit?: number
}): Promise<BoundaryBackfillSummary> {
  const startedAt = Date.now()
  const supabase = getAdminClient()
  const limit = Math.min(opts.limit ?? 500, 2000)
  const counties = Object.keys(COUNTY_PARCEL_SERVICES)

  // Ag-spray leads that are geocoded, in a covered county, and have no field yet.
  const { data } = await supabase
    .from('leads')
    .select('id, lat, lon, county, owner_name, business_name, primary_crop')
    .eq('vertical', 'ag_spray')
    .in('county', counties)
    .not('lat', 'is', null)
    .limit(limit)

  const all = (data ?? []) as any[]

  // Skip leads that already have a field row.
  const ids = all.map(l => l.id)
  const existing = new Set<string>()
  for (let i = 0; i < ids.length; i += 500) {
    const slice = ids.slice(i, i + 500)
    const { data: fr } = await supabase.from('fields').select('lead_id').in('lead_id', slice)
    for (const r of fr ?? []) if (r.lead_id) existing.add(r.lead_id)
  }
  const candidates = all.filter(l => !existing.has(l.id))

  let matched = 0
  let inserted = 0
  const byCounty: Record<string, number> = {}

  let cursor = 0
  async function worker() {
    while (cursor < candidates.length) {
      const lead = candidates[cursor++]
      const b = await fetchParcelBoundary(Number(lead.lat), Number(lead.lon), lead.county)
      if (!b) continue
      matched++
      const name = `${(lead.business_name ?? lead.owner_name ?? 'Parcel').slice(0, 40)} parcel`
      const { error } = await supabase.from('fields').insert({
        name,
        lead_id: lead.id,
        crop: lead.primary_crop ?? null,
        acreage: b.acres,
        boundary: b.geometry,
        center_lat: b.center?.[0] ?? null,
        center_lon: b.center?.[1] ?? null,
      })
      if (!error) {
        inserted++
        byCounty[lead.county] = (byCounty[lead.county] ?? 0) + 1
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, candidates.length) }, worker))

  return {
    trigger: opts.trigger,
    candidates: candidates.length,
    matched,
    inserted,
    durationMs: Date.now() - startedAt,
    writeMode,
    byCounty,
  }
}
