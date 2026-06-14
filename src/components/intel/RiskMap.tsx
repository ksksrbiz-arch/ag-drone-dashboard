'use client'

import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { Lead } from '@/lib/supabase'
import { effectiveRisk } from '@/lib/efb/scoring'

// ─────────────────────────────────────────────────────────────────────────
// Satellite risk map for the EFB Intelligence Hub — overhauled.
//
// Leaflet + free tile basemaps (no API token). Each parcel is a vector marker
// whose color encodes the *selected metric* (composite EFB risk, weather, leaf
// wetness, canopy health, or ML risk) and whose radius encodes either risk or
// treatable acreage. Rising-risk parcels get a highlight ring. A switchable
// basemap (satellite / streets / terrain) and an in-map legend round it out.
//
// Vector markers (not image pins) avoid Leaflet's marker-asset bundling issues.
// Rendered client-only via next/dynamic (ssr:false) by the parent.
// ─────────────────────────────────────────────────────────────────────────

const CANBY: [number, number] = [45.2662, -122.6926] // HQ — default center

export type RiskMetric = 'composite' | 'weather' | 'wetness' | 'health' | 'ml'
export type Basemap = 'satellite' | 'streets' | 'terrain'
export type SizeMode = 'risk' | 'acreage'

interface RiskMapProps {
  leads: Lead[]
  selected: Lead | null
  onSelect: (lead: Lead) => void
  showRiskOverlay: boolean
  metric: RiskMetric
  basemap: Basemap
  sizeBy: SizeMode
  /** Bumped by the parent to re-fit the viewport to the highest-risk parcel. */
  flyToTop?: number
}

const BASEMAPS: Record<Basemap, { url: string; attribution: string; maxZoom: number }> = {
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri — Maxar, Earthstar Geographics, GIS Community',
    maxZoom: 19,
  },
  streets: {
    url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png',
    attribution: '&copy; OpenStreetMap &copy; CARTO',
    maxZoom: 20,
  },
  terrain: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: 'Map data: &copy; OpenStreetMap, SRTM | &copy; OpenTopoMap',
    maxZoom: 17,
  },
}

export const METRIC_META: Record<RiskMetric, { label: string; read: (l: Lead) => number | null }> = {
  composite: { label: 'Composite EFB risk', read: l => effectiveRisk(l) },
  weather: { label: 'Weather pressure', read: l => l.efb_weather_risk },
  wetness: {
    label: 'Leaf wetness',
    // Normalize 0..24h+ into a 0..100 scale for consistent coloring.
    read: l => (l.leaf_wetness_hours != null ? Math.min(100, (l.leaf_wetness_hours / 24) * 100) : null),
  },
  health: {
    // Invert orchard health so "redder = worse" stays consistent across layers.
    label: 'Canopy stress',
    read: l => (l.orchard_health_score != null ? 100 - l.orchard_health_score : null),
  },
  ml: { label: 'ML risk model', read: l => l.ml_efb_risk },
}

function hasCoords(l: Lead): l is Lead & { lat: number; lon: number } {
  return typeof l.lat === 'number' && typeof l.lon === 'number'
}

function metricColor(v: number | null): string {
  if (v == null) return '#64748b' // slate-500 — no data
  if (v >= 75) return '#ef4444'
  if (v >= 55) return '#fb923c'
  if (v >= 40) return '#facc15'
  return '#4ade80'
}

function markerRadius(lead: Lead, metricVal: number | null, sizeBy: SizeMode): number {
  if (sizeBy === 'acreage') {
    const a = lead.est_acreage ?? 0
    return 5 + Math.min(14, Math.sqrt(a) * 0.9) // 5..19px
  }
  return 6 + (metricVal ?? 0) / 10 // 6..16px
}

/** Fits to all parcels on mount/data-change; on flyToTop bump, zooms the hottest. */
function ViewController({
  points,
  topPoint,
  flyToTop,
}: {
  points: [number, number][]
  topPoint: [number, number] | null
  flyToTop?: number
}) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 12)
    else if (points.length > 1) map.fitBounds(points, { padding: [40, 40], maxZoom: 13 })
  }, [map, points])

  useEffect(() => {
    if (flyToTop && topPoint) map.flyTo(topPoint, 14, { duration: 1.2 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flyToTop])
  return null
}

export default function RiskMap({
  leads,
  selected,
  onSelect,
  showRiskOverlay,
  metric,
  basemap,
  sizeBy,
  flyToTop,
}: RiskMapProps) {
  const mapped = useMemo(() => leads.filter(hasCoords), [leads])
  const points = useMemo(() => mapped.map(l => [l.lat, l.lon] as [number, number]), [mapped])
  const read = METRIC_META[metric].read

  const topPoint = useMemo<[number, number] | null>(() => {
    let best: (Lead & { lat: number; lon: number }) | null = null
    let bestVal = -1
    for (const l of mapped) {
      const v = effectiveRisk(l)
      if (v > bestVal) {
        bestVal = v
        best = l
      }
    }
    return best ? [best.lat, best.lon] : null
  }, [mapped])

  const tiles = BASEMAPS[basemap]

  return (
    <div className="relative h-[340px] md:h-[440px] w-full overflow-hidden rounded-xl border border-slate-200 shadow-card">
      <MapContainer
        center={CANBY}
        zoom={10}
        scrollWheelZoom
        className="h-full w-full"
        style={{ background: '#0f172a' }}
      >
        <TileLayer
          key={basemap}
          attribution={tiles.attribution}
          url={tiles.url}
          maxZoom={tiles.maxZoom}
        />
        {showRiskOverlay &&
          mapped.map(lead => {
            const isSel = selected?.id === lead.id
            const v = read(lead)
            const color = metricColor(v)
            const rising = lead.risk_trend === 'rising'
            return (
              <CircleMarker
                key={lead.id}
                center={[lead.lat, lead.lon]}
                radius={markerRadius(lead, v, sizeBy) + (isSel ? 3 : 0)}
                pathOptions={{
                  color: isSel ? '#ffffff' : rising ? '#fca5a5' : color,
                  weight: isSel ? 3 : rising ? 2.5 : 1.5,
                  fillColor: color,
                  fillOpacity: 0.66,
                }}
                eventHandlers={{ click: () => onSelect(lead) }}
              >
                <Tooltip direction="top" offset={[0, -4]}>
                  <span className="text-xs font-semibold">
                    {lead.business_name ?? lead.owner_name ?? 'Parcel'}
                  </span>
                  <br />
                  <span className="text-xs">
                    {METRIC_META[metric].label}: {v != null ? Math.round(v) : '—'}
                    {lead.primary_crop ? ` · ${lead.primary_crop}` : ''}
                    {rising ? ' · ▲ rising' : ''}
                  </span>
                </Tooltip>
              </CircleMarker>
            )
          })}
        <ViewController points={points} topPoint={topPoint} flyToTop={flyToTop} />
      </MapContainer>

      {/* Legend */}
      {showRiskOverlay && mapped.length > 0 && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-lg bg-slate-900/85 px-3 py-2 text-[11px] text-slate-200 shadow-lg">
          <div className="font-semibold mb-1">{METRIC_META[metric].label}</div>
          <div className="flex items-center gap-2">
            {[
              ['#4ade80', '<40'],
              ['#facc15', '40+'],
              ['#fb923c', '55+'],
              ['#ef4444', '75+'],
            ].map(([c, label]) => (
              <span key={label} className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: c }} />
                {label}
              </span>
            ))}
          </div>
          <div className="mt-1 text-slate-400">
            ⬤ size = {sizeBy === 'acreage' ? 'acreage' : 'risk'} · ◯ ring = rising
          </div>
        </div>
      )}

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
