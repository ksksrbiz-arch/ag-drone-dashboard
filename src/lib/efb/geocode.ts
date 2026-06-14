import type { Lead } from '@/lib/supabase'
import { getAdminClient } from '@/lib/supabaseAdmin'

// ─────────────────────────────────────────────────────────────────────────
// Geocoding backfill — turns parcel street addresses into lat/lon so the
// satellite risk map can actually plot them.
//
// Uses the free U.S. Census batch geocoder (no API key, up to 10k rows/call):
//   POST https://geocoding.geo.census.gov/geocoder/locations/addressbatch
// It handles rural Willamette-Valley street addresses well. Mailing addresses
// that aren't a physical street point (PO boxes, out-of-area owners) simply
// return No_Match and are left untouched.
//
// Also fills distance_to_canby_mi (haversine to HQ) when missing, which feeds
// the lead-priority proximity factor.
// ─────────────────────────────────────────────────────────────────────────

const CENSUS_URL =
  'https://geocoding.geo.census.gov/geocoder/locations/addressbatch'
const CANBY = { lat: 45.2662, lon: -122.6926 }
const CENSUS_MAX = 9000 // stay under the 10k batch ceiling

export interface GeocodeRunSummary {
  trigger: string
  candidates: number
  attempted: number
  matched: number
  updated: number
  durationMs: number
  writeMode: string
}

interface AddressRow {
  id: string
  street: string
  city: string
  state: string
  zip: string
}

function haversineMi(lat: number, lon: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180
  const R = 3958.8
  const dLat = toRad(lat - CANBY.lat)
  const dLon = toRad(lon - CANBY.lon)
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(CANBY.lat)) * Math.cos(toRad(lat)) * Math.sin(dLon / 2) ** 2
  return Math.round(R * 2 * Math.asin(Math.sqrt(a)) * 10) / 10
}

/** Build the headerless CSV the Census batch endpoint expects. */
function toCsv(rows: AddressRow[]): string {
  const esc = (s: string) => {
    const v = (s ?? '').replace(/[\r\n]+/g, ' ').trim()
    return /[",]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
  }
  return rows
    .map(r => [r.id, esc(r.street), esc(r.city), esc(r.state), esc(r.zip)].join(','))
    .join('\n')
}

/** Parse the Census response CSV → map of id → {lat, lon}. */
function parseCensus(csv: string): Map<string, { lat: number; lon: number }> {
  const out = new Map<string, { lat: number; lon: number }>()
  // Rows: id,"input",Match|No_Match|Tie,matchtype,"matched","lon,lat",tigerid,side
  const rows = csv.split(/\r?\n/).filter(Boolean)
  for (const row of rows) {
    const cells = splitCsvRow(row)
    if (cells.length < 6) continue
    const id = cells[0]
    const status = cells[2]
    if (status !== 'Match') continue
    const coord = cells[5] // "lon,lat"
    const [lonStr, latStr] = coord.split(',')
    const lon = parseFloat(lonStr)
    const lat = parseFloat(latStr)
    if (Number.isFinite(lat) && Number.isFinite(lon)) out.set(id, { lat, lon })
  }
  return out
}

/** Minimal CSV row splitter that respects double-quoted fields. */
function splitCsvRow(row: string): string[] {
  const cells: string[] = []
  let cur = ''
  let inQ = false
  for (let i = 0; i < row.length; i++) {
    const c = row[i]
    if (inQ) {
      if (c === '"' && row[i + 1] === '"') {
        cur += '"'
        i++
      } else if (c === '"') inQ = false
      else cur += c
    } else if (c === '"') inQ = true
    else if (c === ',') {
      cells.push(cur)
      cur = ''
    } else cur += c
  }
  cells.push(cur)
  return cells
}

async function geocodeBatch(rows: AddressRow[]): Promise<Map<string, { lat: number; lon: number }>> {
  const form = new FormData()
  form.append('benchmark', 'Public_AR_Current')
  form.append(
    'addressFile',
    new Blob([toCsv(rows)], { type: 'text/csv' }),
    'addresses.csv'
  )
  const res = await fetch(CENSUS_URL, { method: 'POST', body: form })
  if (!res.ok) throw new Error(`Census geocoder ${res.status}: ${res.statusText}`)
  return parseCensus(await res.text())
}

export async function runGeocodeBackfill(opts: {
  trigger: string
  limit?: number
}): Promise<GeocodeRunSummary> {
  const startedAt = Date.now()
  const supabase = getAdminClient()
  const { writeMode } = await import('@/lib/supabaseAdmin')
  const limit = Math.min(opts.limit ?? 1000, CENSUS_MAX)

  // Parcels that need coordinates and have something to geocode.
  const { data } = await supabase
    .from('leads')
    .select('id, address_physical, city, state, zipcode')
    .eq('vertical', 'ag_spray')
    .is('lat', null)
    .not('address_physical', 'is', null)
    .order('composite_efb_risk', { ascending: false, nullsFirst: false })
    .limit(limit)

  const candidates = (data ?? []) as Pick<
    Lead,
    'id' | 'address_physical' | 'city' | 'state' | 'zipcode'
  >[]

  // Skip obvious non-physical addresses (PO boxes) — they never geocode.
  const rows: AddressRow[] = candidates
    .filter(c => c.address_physical && !/^\s*(po|p\.?\s*o\.?)\s*box/i.test(c.address_physical))
    .map(c => ({
      id: c.id,
      street: c.address_physical ?? '',
      city: c.city ?? '',
      state: c.state ?? 'OR',
      zip: c.zipcode ?? '',
    }))

  let matched = 0
  let updated = 0

  // Census batches in chunks; 1k per call keeps each request snappy.
  const CHUNK = 1000
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK)
    let coords: Map<string, { lat: number; lon: number }>
    try {
      coords = await geocodeBatch(slice)
    } catch {
      continue // transient geocoder error — skip this chunk, others still land
    }
    matched += coords.size
    for (const [id, { lat, lon }] of coords) {
      const { error } = await supabase
        .from('leads')
        .update({ lat, lon, distance_to_canby_mi: haversineMi(lat, lon) })
        .eq('id', id)
      if (!error) updated++
    }
  }

  return {
    trigger: opts.trigger,
    candidates: candidates.length,
    attempted: rows.length,
    matched,
    updated,
    durationMs: Date.now() - startedAt,
    writeMode,
  }
}
