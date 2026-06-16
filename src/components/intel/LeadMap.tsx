'use client'

import { useEffect, useMemo } from 'react'
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { Lead } from '@/lib/supabase'
import { effectiveRisk } from '@/lib/efb/scoring'
import { BUSINESS } from '@/lib/business'
import { BASEMAPS, type Basemap } from '@/lib/map/basemaps'

// ─────────────────────────────────────────────────────────────────────────
// Generalized lead/territory map. Plots geocoded leads colored by a chosen
// dimension (priority tier, pipeline stage, EFB risk, or crop), or switches to
// a county-aggregate view (one bubble per county at its lead centroid, sized by
// count, colored by average priority). Read-only analytics surface — tooltips,
// no editing. Client-only (next/dynamic ssr:false from the parent).
// ─────────────────────────────────────────────────────────────────────────

const HQ: [number, number] = [BUSINESS.hqLat, BUSINESS.hqLon]

export type ColorBy = 'priority' | 'status' | 'efb' | 'crop'
export type MapMode = 'leads' | 'counties'

export interface CountyAgg {
  county: string
  count: number
  signed: number
  avgPriority: number | null
  pipeline: number
  lat: number | null
  lon: number | null
}

interface LeadMapProps {
  leads: Lead[]
  counties: CountyAgg[]
  mode: MapMode
  colorBy: ColorBy
  basemap: Basemap
  /** Optional: make leads-mode markers clickable (e.g. open a detail panel). */
  onSelect?: (lead: Lead) => void
  /** Optional: highlight the currently-selected lead. */
  selectedId?: string | null
}

const NO_DATA = '#64748b'

const TIER_COLOR: Record<string, string> = {
  P1: '#ef4444', P2: '#fb923c', P3: '#facc15', P4: '#94a3b8',
}
const STATUS_COLOR: Record<string, string> = {
  not_contacted: '#94a3b8',
  contacted: '#3b82f6',
  meeting_scheduled: '#6366f1',
  loi_sent: '#a855f7',
  loi_signed: '#22c55e',
  declined: '#ef4444',
}
const CROP_PALETTE = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899', '#0ea5e9', '#84cc16']

function bandColor(v: number | null): string {
  if (v == null) return NO_DATA
  if (v >= 75) return '#ef4444'
  if (v >= 55) return '#fb923c'
  if (v >= 40) return '#facc15'
  return '#4ade80'
}
function cropColor(crop: string | null | undefined): string {
  if (!crop) return NO_DATA
  let h = 0
  for (let i = 0; i < crop.length; i++) h = (h * 31 + crop.charCodeAt(i)) >>> 0
  return CROP_PALETTE[h % CROP_PALETTE.length]
}

function leadColor(lead: Lead, colorBy: ColorBy): string {
  switch (colorBy) {
    case 'priority':
      return lead.priority_tier ? TIER_COLOR[lead.priority_tier] ?? NO_DATA : NO_DATA
    case 'status':
      return STATUS_COLOR[lead.loi_status] ?? NO_DATA
    case 'efb':
      return bandColor(effectiveRisk(lead))
    case 'crop':
      return cropColor(lead.primary_crop)
  }
}

function hasCoords(l: Lead): l is Lead & { lat: number; lon: number } {
  return typeof l.lat === 'number' && typeof l.lon === 'number'
}

function FitBounds({ points }: { points: [number, number][] }) {
  const map = useMap()
  useEffect(() => {
    if (points.length === 1) map.setView(points[0], 11)
    else if (points.length > 1) map.fitBounds(points, { padding: [40, 40], maxZoom: 13 })
  }, [map, points])
  return null
}

const LEGENDS: Record<ColorBy, { label: string; items: [string, string][] }> = {
  priority: { label: 'Priority tier', items: [['#ef4444', 'P1'], ['#fb923c', 'P2'], ['#facc15', 'P3'], ['#94a3b8', 'P4']] },
  status: {
    label: 'Pipeline stage',
    items: [['#94a3b8', 'New'], ['#3b82f6', 'Contacted'], ['#6366f1', 'Meeting'], ['#a855f7', 'LOI sent'], ['#22c55e', 'Signed']],
  },
  efb: { label: 'EFB risk', items: [['#4ade80', '<40'], ['#facc15', '40+'], ['#fb923c', '55+'], ['#ef4444', '75+']] },
  crop: { label: 'Colored by crop', items: [] },
}

export default function LeadMap({ leads, counties, mode, colorBy, basemap, onSelect, selectedId }: LeadMapProps) {
  const mapped = useMemo(() => leads.filter(hasCoords), [leads])
  const geoCounties = useMemo(
    () => counties.filter(c => typeof c.lat === 'number' && typeof c.lon === 'number') as (CountyAgg & { lat: number; lon: number })[],
    [counties]
  )

  const points = useMemo<[number, number][]>(
    () => (mode === 'counties' ? geoCounties.map(c => [c.lat, c.lon]) : mapped.map(l => [l.lat, l.lon])),
    [mode, mapped, geoCounties]
  )
  const maxCount = useMemo(() => Math.max(1, ...geoCounties.map(c => c.count)), [geoCounties])
  const tiles = BASEMAPS[basemap]
  const empty = mode === 'counties' ? geoCounties.length === 0 : mapped.length === 0

  return (
    <div className="relative h-[360px] md:h-[460px] w-full overflow-hidden rounded-xl border border-slate-200 shadow-card">
      <MapContainer center={HQ} zoom={9} scrollWheelZoom className="h-full w-full" style={{ background: '#0f172a' }}>
        <TileLayer key={basemap} attribution={tiles.attribution} url={tiles.url} maxZoom={tiles.maxZoom} />

        {mode === 'leads' &&
          mapped.map(lead => {
            const color = leadColor(lead, colorBy)
            const isSel = selectedId === lead.id
            return (
              <CircleMarker
                key={lead.id}
                center={[lead.lat, lead.lon]}
                radius={isSel ? 9 : 6}
                pathOptions={{
                  color: isSel ? '#ffffff' : color,
                  weight: isSel ? 3 : 1.5,
                  fillColor: color,
                  fillOpacity: 0.8,
                }}
                eventHandlers={onSelect ? { click: () => onSelect(lead) } : undefined}
              >
                <Tooltip direction="top" offset={[0, -4]}>
                  <span className="text-xs font-semibold">{lead.business_name ?? lead.owner_name ?? 'Lead'}</span>
                  <br />
                  <span className="text-xs">
                    {[lead.priority_tier, lead.primary_crop, lead.city].filter(Boolean).join(' · ') || '—'}
                  </span>
                </Tooltip>
              </CircleMarker>
            )
          })}

        {mode === 'counties' &&
          geoCounties.map(c => {
            const color = bandColor(c.avgPriority)
            return (
              <CircleMarker
                key={c.county}
                center={[c.lat, c.lon]}
                radius={7 + Math.sqrt(c.count / maxCount) * 22}
                pathOptions={{ color, weight: 1.5, fillColor: color, fillOpacity: 0.45 }}
              >
                <Tooltip direction="top" offset={[0, -4]}>
                  <span className="text-xs font-semibold">{c.county} County</span>
                  <br />
                  <span className="text-xs">
                    {c.count} leads · avg {c.avgPriority ?? '—'} · {c.signed} signed
                    {c.pipeline ? ` · $${c.pipeline.toLocaleString()}/yr` : ''}
                  </span>
                </Tooltip>
              </CircleMarker>
            )
          })}

        <FitBounds points={points} />
      </MapContainer>

      {/* Legend */}
      {!empty && (
        <div className="pointer-events-none absolute bottom-3 left-3 z-[500] rounded-lg bg-slate-900/85 px-3 py-2 text-[11px] text-slate-200 shadow-lg">
          <div className="font-semibold mb-1">
            {mode === 'counties' ? 'County · avg priority' : LEGENDS[colorBy].label}
          </div>
          {mode === 'counties' ? (
            <div className="flex items-center gap-2">
              {[['#4ade80', 'low'], ['#facc15', 'mid'], ['#fb923c', 'high'], ['#ef4444', 'hot']].map(([c, l]) => (
                <span key={l} className="flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: c }} />
                  {l}
                </span>
              ))}
              <span className="text-slate-400">· ⬤ size = leads</span>
            </div>
          ) : LEGENDS[colorBy].items.length ? (
            <div className="flex flex-wrap items-center gap-2">
              {LEGENDS[colorBy].items.map(([c, l]) => (
                <span key={l} className="flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: c }} />
                  {l}
                </span>
              ))}
            </div>
          ) : (
            <div className="text-slate-400">each color = a crop</div>
          )}
        </div>
      )}

      {empty && (
        <div className="pointer-events-none absolute inset-0 z-[500] flex items-center justify-center">
          <div className="rounded-lg bg-slate-900/80 px-4 py-2 text-xs text-slate-200">
            No geocoded leads to plot — add lat/lon (or run the geocode backfill) to see the territory.
          </div>
        </div>
      )}
    </div>
  )
}
