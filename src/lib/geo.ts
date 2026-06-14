// ─────────────────────────────────────────────────────────────────────────
// Lightweight geo helpers for field boundaries — no external dependency.
//
// GeoJSON uses [lon, lat]; Leaflet uses [lat, lon]. Keep that straight.
// ─────────────────────────────────────────────────────────────────────────

export type Position = [number, number] // [lon, lat]
export interface PolygonGeometry {
  type: 'Polygon'
  coordinates: Position[][]
}
export interface MultiPolygonGeometry {
  type: 'MultiPolygon'
  coordinates: Position[][][]
}
export type FieldGeometry = PolygonGeometry | MultiPolygonGeometry

const EARTH_RADIUS = 6378137 // meters
const SQM_PER_ACRE = 4046.8564224
const rad = (deg: number) => (deg * Math.PI) / 180

/** Geodesic area of a single ring (m²), via the spherical excess formula. */
function ringAreaSqM(ring: Position[]): number {
  const n = ring.length
  if (n < 3) return 0
  let area = 0
  for (let i = 0; i < n; i++) {
    const [lon1, lat1] = ring[i]
    const [lon2, lat2] = ring[(i + 1) % n]
    area += rad(lon2 - lon1) * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)))
  }
  return Math.abs((area * EARTH_RADIUS * EARTH_RADIUS) / 2)
}

/** Acreage of a Polygon (outer minus holes) or MultiPolygon (summed). */
export function geometryAcres(geom: FieldGeometry | null | undefined): number {
  if (!geom) return 0
  let sqm = 0
  if (geom.type === 'Polygon') {
    geom.coordinates.forEach((ring, i) => {
      sqm += i === 0 ? ringAreaSqM(ring) : -ringAreaSqM(ring)
    })
  } else if (geom.type === 'MultiPolygon') {
    for (const poly of geom.coordinates) {
      poly.forEach((ring, i) => {
        sqm += i === 0 ? ringAreaSqM(ring) : -ringAreaSqM(ring)
      })
    }
  }
  return Math.max(0, sqm) / SQM_PER_ACRE
}

function outerRings(geom: FieldGeometry): Position[][] {
  if (geom.type === 'Polygon') return geom.coordinates.length ? [geom.coordinates[0]] : []
  return geom.coordinates.map(p => p[0]).filter(Boolean)
}

/** Centroid as [lat, lon] — average of outer-ring vertices. */
export function geometryCenter(geom: FieldGeometry | null | undefined): [number, number] | null {
  if (!geom) return null
  const rings = outerRings(geom)
  let sumLat = 0
  let sumLon = 0
  let count = 0
  for (const ring of rings) {
    for (const [lon, lat] of ring) {
      sumLat += lat
      sumLon += lon
      count++
    }
  }
  return count ? [sumLat / count, sumLon / count] : null
}

/** Outer rings as Leaflet [lat, lon] arrays (one per polygon part). */
export function toLeafletPositions(geom: FieldGeometry | null | undefined): [number, number][][] {
  if (!geom) return []
  return outerRings(geom).map(ring => ring.map(([lon, lat]) => [lat, lon] as [number, number]))
}

export interface ParsedField {
  name: string
  geometry: FieldGeometry
  acreage: number
  center: [number, number] | null
}

function nameFromProps(props: Record<string, unknown> | undefined, fallback: string): string {
  if (!props) return fallback
  for (const key of ['name', 'Name', 'NAME', 'title', 'Title', 'field', 'FIELD', 'id']) {
    const v = props[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return fallback
}

/**
 * Parse a GeoJSON string (FeatureCollection, Feature, or bare geometry) into
 * field candidates. Throws on invalid JSON or no usable polygons.
 */
export function parseGeoJSON(text: string): ParsedField[] {
  const json = JSON.parse(text)
  const out: ParsedField[] = []

  const pushGeom = (geom: any, name: string) => {
    if (!geom || (geom.type !== 'Polygon' && geom.type !== 'MultiPolygon')) return
    const g = geom as FieldGeometry
    out.push({
      name,
      geometry: g,
      acreage: Math.round(geometryAcres(g) * 100) / 100,
      center: geometryCenter(g),
    })
  }

  if (json.type === 'FeatureCollection' && Array.isArray(json.features)) {
    json.features.forEach((f: any, i: number) =>
      pushGeom(f.geometry, nameFromProps(f.properties, `Field ${i + 1}`))
    )
  } else if (json.type === 'Feature') {
    pushGeom(json.geometry, nameFromProps(json.properties, 'Imported field'))
  } else if (json.type === 'Polygon' || json.type === 'MultiPolygon') {
    pushGeom(json, 'Imported field')
  }

  if (out.length === 0) throw new Error('No Polygon features found in the GeoJSON.')
  return out
}
