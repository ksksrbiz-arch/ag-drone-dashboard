'use client'

import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { Lead } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────
// Satellite risk map for the EFB Intelligence Hub.
//
// Leaflet + Esri World Imagery tiles (free, no API token). Each parcel with
// coordinates is plotted as a vector CircleMarker — radius + color encode the
// composite EFB risk, giving a heat-map read over the satellite imagery. The
// risk overlay can be toggled off to inspect the raw satellite view.
//
// Vector markers (not image pins) avoid Leaflet's marker-asset bundling issues.
// Rendered client-only via next/dynamic (ssr:false) by the parent.
// ─────────────────────────────────────────────────────────────────────────

const CANBY: [number, number] = [45.2662, -122.6926] // HQ — default center

interface RiskMapProps {
  leads: Lead[]
  selected: Lead | null
  onSelect: (lead: Lead) => void
  showRiskOverlay: boolean
}

function hasCoords(l: Lead): l is Lead & { lat: number; lon: number } {
  return typeof l.lat === 'number' && typeof l.lon === 'number'
}

function riskColor(risk: number | null): string {
  const r = risk ?? 0
  if (r >= 75) return '#ef4444' // red-500
  if (r >= 55) return '#fb923c' // orange-400
  if (r >= 40) return '#facc15' // yellow-400
  return '#4ade80' // green-400
}

function riskRadius(risk: number | null): number {
  return 6 + (risk ?? 0) / 10 // 6..16px
}

/** Fits the viewport to the plotted parcels whenever they change. */
function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 1) {
      map.setView(points[0], 12)
    } else if (points.length > 1) {
      map.fitBounds(points, { padding: [40, 40], maxZoom: 13 })
    }
  }, [map, points])
  return null
}

export default function RiskMap({
  leads,
  selected,
  onSelect,
  showRiskOverlay,
}: RiskMapProps) {
  const mapped = useMemo(() => leads.filter(hasCoords), [leads])
  const points = useMemo(
    () => mapped.map(l => [l.lat, l.lon] as [number, number]),
    [mapped]
  )

  return (
    <div className="relative h-[300px] md:h-[380px] w-full overflow-hidden rounded-xl border border-slate-200 shadow-card">
      <MapContainer
        center={CANBY}
        zoom={10}
        scrollWheelZoom
        className="h-full w-full"
        style={{ background: '#0f172a' }}
      >
        <TileLayer
          attribution="Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"
          url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
          maxZoom={19}
        />
        {showRiskOverlay &&
          mapped.map(lead => {
            const isSel = selected?.id === lead.id
            return (
              <CircleMarker
                key={lead.id}
                center={[lead.lat, lead.lon]}
                radius={riskRadius(lead.composite_efb_risk) + (isSel ? 3 : 0)}
                pathOptions={{
                  color: isSel ? '#ffffff' : riskColor(lead.composite_efb_risk),
                  weight: isSel ? 3 : 1.5,
                  fillColor: riskColor(lead.composite_efb_risk),
                  fillOpacity: 0.65,
                }}
                eventHandlers={{ click: () => onSelect(lead) }}
              >
                <Tooltip direction="top" offset={[0, -4]}>
                  <span className="text-xs font-semibold">
                    {lead.business_name ?? lead.owner_name ?? 'Parcel'}
                  </span>
                  <br />
                  <span className="text-xs">
                    EFB {lead.composite_efb_risk ?? '?'}/100
                    {lead.primary_crop ? ` · ${lead.primary_crop}` : ''}
                  </span>
                </Tooltip>
              </CircleMarker>
            )
          })}
        <FitBounds points={points} />
      </MapContainer>

      {mapped.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center">
          <div className="rounded-lg bg-slate-900/80 px-4 py-2 text-xs text-slate-200">
            No geocoded parcels in view — add lat/lon to plot risk on the map.
          </div>
        </div>
      )}
    </div>
  )
}
