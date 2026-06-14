'use client'

import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, Polygon, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { Field } from '@/lib/supabase'
import { toLeafletPositions } from '@/lib/geo'
import { BUSINESS } from '@/lib/business'

// ─────────────────────────────────────────────────────────────────────────
// Field boundary map — Leaflet + Esri satellite imagery. Renders each field's
// GeoJSON polygon(s) as filled vector shapes over the imagery. Client-only
// (next/dynamic ssr:false from the parent).
// ─────────────────────────────────────────────────────────────────────────

const CANBY: [number, number] = [BUSINESS.hqLat, BUSINESS.hqLon]

interface FieldMapProps {
  fields: Field[]
  selected: Field | null
  onSelect: (field: Field) => void
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 15)
    else if (points.length > 1) map.fitBounds(points, { padding: [30, 30], maxZoom: 16 })
  }, [map, points])
  return null
}

export default function FieldMap({ fields, selected, onSelect }: FieldMapProps) {
  const polys = useMemo(
    () =>
      fields
        .map(f => ({ field: f, rings: toLeafletPositions(f.boundary) }))
        .filter(p => p.rings.length > 0),
    [fields]
  )

  const allPoints = useMemo(() => polys.flatMap(p => p.rings.flat()), [polys])

  return (
    <div className="relative h-[320px] md:h-[420px] w-full overflow-hidden rounded-xl border border-slate-200 shadow-card">
      <MapContainer
        center={CANBY}
        zoom={11}
        scrollWheelZoom
        className="h-full w-full"
        style={{ background: '#0f172a' }}
      >
        <TileLayer
          attribution="Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          maxZoom={19}
        />
        {polys.map(({ field, rings }) => {
          const isSel = selected?.id === field.id
          const color = field.color ?? '#22c55e'
          return rings.map((ring, i) => (
            <Polygon
              key={`${field.id}-${i}`}
              positions={ring}
              pathOptions={{
                color: isSel ? '#ffffff' : color,
                weight: isSel ? 3 : 2,
                fillColor: color,
                fillOpacity: isSel ? 0.45 : 0.3,
              }}
              eventHandlers={{ click: () => onSelect(field) }}
            >
              <Tooltip direction="top" sticky>
                <span className="text-xs font-semibold">{field.name}</span>
                <br />
                <span className="text-xs">
                  {field.acreage != null ? `${field.acreage} ac` : ''}
                  {field.crop ? ` · ${field.crop}` : ''}
                </span>
              </Tooltip>
            </Polygon>
          ))
        })}
        <FitBounds points={allPoints} />
      </MapContainer>

      {polys.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center">
          <div className="rounded-lg bg-slate-900/80 px-4 py-2 text-xs text-slate-200">
            No field boundaries yet — import a GeoJSON to map your fields.
          </div>
        </div>
      )}
    </div>
  )
}
