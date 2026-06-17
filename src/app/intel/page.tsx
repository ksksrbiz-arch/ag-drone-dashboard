'use client'

import { useCallback, useEffect, useState, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { Crosshair, RefreshCw, Layers, Map as MapIcon, MapPin } from 'lucide-react'
import { supabase, type Lead, type ActionRec } from '@/lib/supabase'
import {
  ModelStatusBarSkeleton,
  IntelBoardSkeleton,
  MapSkeleton,
} from '@/components/intel/Skeletons'
import { ActionIcon } from '@/components/intel/icons'
import RollupPanels from '@/components/intel/RollupPanels'
import ParcelTable from '@/components/intel/ParcelTable'
import AlertsFeed from '@/components/intel/AlertsFeed'
import {
  assessEfb,
  effectiveRisk,
  SPRAY_META,
  type EfbFactor,
} from '@/lib/efb/scoring'
import { acresAtRisk, actionOf } from '@/lib/efb/analytics'
import { setSidekickFocus } from '@/lib/assistant/context'
import { INTEL_TITLE } from '@/lib/business'
import type { RiskMetric, Basemap, SizeMode } from '@/components/intel/RiskMap'

// Leaflet touches `window`, so load the map client-side only with a skeleton
// fallback while its chunk hydrates.
const RiskMap = dynamic(() => import('@/components/intel/RiskMap'), {
  ssr: false,
  loading: () => <MapSkeleton />,
})

const ACTION_CONFIG: Record<ActionRec, { label: string; bg: string; border: string; text: string; dot: string }> = {
  TREAT_NOW:   { label: 'Treat Now',   bg: 'bg-red-50',    border: 'border-red-200',    text: 'text-red-700',    dot: 'bg-red-500'    },
  SCOUT_NOW:   { label: 'Scout Now',   bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', dot: 'bg-orange-500' },
  CONTACT_NOW: { label: 'Contact Now', bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', dot: 'bg-yellow-400' },
  MONITOR:     { label: 'Monitor',     bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-700',  dot: 'bg-green-500'  },
}

const METRICS: { key: RiskMetric; label: string }[] = [
  { key: 'composite', label: 'Composite' },
  { key: 'weather', label: 'Weather' },
  { key: 'wetness', label: 'Leaf wetness' },
  { key: 'health', label: 'Canopy stress' },
  { key: 'ml', label: 'ML model' },
]

const BASEMAPS: { key: Basemap; label: string }[] = [
  { key: 'satellite', label: 'Satellite' },
  { key: 'streets', label: 'Streets' },
  { key: 'terrain', label: 'Terrain' },
]

export default function IntelPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [crop, setCrop] = useState<string>('all')
  const [selected, setSelected] = useState<Lead | null>(null)
  const [showMap, setShowMap] = useState(true)
  const [showRiskOverlay, setShowRiskOverlay] = useState(true)
  const [metric, setMetric] = useState<RiskMetric>('composite')
  const [basemap, setBasemap] = useState<Basemap>('satellite')
  const [sizeBy, setSizeBy] = useState<SizeMode>('risk')
  const [flyToTop, setFlyToTop] = useState(0)
  const [recomputing, setRecomputing] = useState(false)
  const [geocoding, setGeocoding] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('leads')
      .select('*')
      .eq('vertical', 'ag_spray')
      .not('composite_efb_risk', 'is', null)
      .order('composite_efb_risk', { ascending: false })
    setLeads(data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => {
    load()
    let channel: ReturnType<typeof supabase.channel> | null = null
    try {
      channel = supabase
        .channel('intel-leads')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, load)
        .subscribe()
    } catch {
      /* realtime optional */
    }
    return () => {
      if (channel) supabase.removeChannel(channel)
    }
  }, [load])

  async function recompute() {
    setRecomputing(true)
    setMessage(null)
    try {
      const res = await fetch('/api/efb/recompute?limit=300', { method: 'POST' })
      const json = await res.json()
      if (!res.ok || json.ok === false) {
        setMessage(`Recompute failed: ${json.error ?? res.statusText}`)
      } else {
        setMessage(
          `Recomputed ${json.parcelsProcessed} parcels · ${json.parcelsUpdated} updated · ` +
            `${json.treatNow} treat-now · ${json.alertsRaised} alert(s) · ${(json.durationMs / 1000).toFixed(1)}s` +
            (json.writeMode === 'none' ? ' (read-only — configure a write key)' : '')
        )
      }
      await load()
    } catch (err: any) {
      setMessage(`Recompute failed: ${String(err?.message ?? err)}`)
    } finally {
      setRecomputing(false)
    }
  }

  async function geocode() {
    setGeocoding(true)
    setMessage(null)
    try {
      const res = await fetch('/api/efb/geocode?limit=1000', { method: 'POST' })
      const json = await res.json()
      if (!res.ok || json.ok === false) {
        setMessage(`Geocoding failed: ${json.error ?? res.statusText}`)
      } else {
        setMessage(
          `Geocoded ${json.updated} of ${json.attempted} parcels (${json.matched} matched) · ${(json.durationMs / 1000).toFixed(1)}s` +
            (json.writeMode === 'none' ? ' (read-only — configure a write key)' : '')
        )
      }
      await load()
    } catch (err: any) {
      setMessage(`Geocoding failed: ${String(err?.message ?? err)}`)
    } finally {
      setGeocoding(false)
    }
  }

  // Publish the open parcel to Sidekick so "recompute this / mark them" resolves it.
  useEffect(() => {
    setSidekickFocus(
      selected ? { kind: 'lead', id: selected.id, name: selected.business_name ?? selected.owner_name } : null
    )
    return () => setSidekickFocus(null)
  }, [selected])

  const crops = useMemo(() => {
    const set = new Set(leads.map(l => l.primary_crop).filter(Boolean) as string[])
    return ['all', ...Array.from(set).sort()]
  }, [leads])

  const filtered = useMemo(
    () => (crop === 'all' ? leads : leads.filter(l => l.primary_crop === crop)),
    [leads, crop]
  )

  const mappedCount = useMemo(
    () => filtered.filter(l => l.lat != null && l.lon != null).length,
    [filtered]
  )

  const kpis = useMemo(() => {
    const n = filtered.length
    const risks = filtered.map(effectiveRisk)
    const avg = n ? Math.round(risks.reduce((s, r) => s + r, 0) / n) : 0
    const critical = filtered.filter(l => effectiveRisk(l) >= 75).length
    const rising = filtered.filter(l => l.risk_trend === 'rising').length
    const treat = filtered.filter(l => actionOf(l) === 'TREAT_NOW').length
    return { n, avg, critical, rising, treat, acres: acresAtRisk(filtered) }
  }, [filtered])

  const grouped = (['TREAT_NOW', 'SCOUT_NOW', 'CONTACT_NOW', 'MONITOR'] as ActionRec[]).reduce(
    (acc, action) => {
      acc[action] = filtered.filter(l => actionOf(l) === action)
      return acc
    },
    {} as Record<ActionRec, Lead[]>
  )

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-screen-2xl mx-auto animate-fade space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{INTEL_TITLE}</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Composite risk from 10m CDL · PRISM weather · leaf-wetness · NDRE trend · ML model
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={crop}
            onChange={e => setCrop(e.target.value)}
            className="tap text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            {crops.map(c => <option key={c} value={c}>{c === 'all' ? 'All Crops' : c}</option>)}
          </select>
          <button
            onClick={geocode}
            disabled={geocoding}
            className="tap inline-flex items-center gap-1.5 text-sm border border-slate-200 bg-white hover:border-slate-400 text-slate-700 font-medium rounded-lg px-4 py-2 transition-colors disabled:opacity-60"
            title="Backfill parcel coordinates from street addresses (free U.S. Census geocoder)"
          >
            <MapPin size={15} className={geocoding ? 'animate-pulse' : ''} />
            {geocoding ? 'Geocoding…' : 'Geocode parcels'}
          </button>
          <button
            onClick={recompute}
            disabled={recomputing}
            className="tap inline-flex items-center gap-1.5 text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-4 py-2 transition-colors disabled:opacity-60 shadow-card"
          >
            <RefreshCw size={15} className={recomputing ? 'animate-spin' : ''} />
            {recomputing ? 'Recomputing…' : 'Recompute risk'}
          </button>
        </div>
      </div>

      {message && (
        <div className="text-sm rounded-lg border border-brand-200 bg-brand-50 text-brand-800 px-4 py-2.5">
          {message}
        </div>
      )}

      {!loading && filtered.length > 0 && mappedCount === 0 && (
        <div className="text-sm rounded-lg border border-amber-200 bg-amber-50 text-amber-800 px-4 py-2.5 flex items-center gap-2">
          <MapPin size={16} className="shrink-0" />
          None of these parcels have coordinates yet, so the map can&apos;t plot them. Click{' '}
          <button onClick={geocode} disabled={geocoding} className="font-semibold underline disabled:opacity-60">
            Geocode parcels
          </button>{' '}
          to backfill lat/lon from their street addresses.
        </div>
      )}

      {/* KPI bar */}
      {loading ? (
        <ModelStatusBarSkeleton />
      ) : (
        <div className="bg-slate-800 text-white rounded-xl px-5 py-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <Stat label="Parcels" value={kpis.n} />
          <Stat label="Avg EFB Risk" value={kpis.avg || '—'} />
          <Stat label="Critical (≥75)" value={kpis.critical} />
          <Stat label="Treat Now" value={kpis.treat} accent="text-red-300" />
          <Stat label="Rising" value={kpis.rising} accent="text-amber-300" />
          <Stat label="Acres at Risk" value={kpis.acres.toLocaleString()} />
        </div>
      )}

      {/* Satellite risk map + controls */}
      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-semibold text-slate-700">Satellite Risk Map</h2>
            {!loading && (
              <span className="text-xs text-slate-400">{mappedCount} of {filtered.length} mapped</span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {showMap && (
              <>
                <Segmented<RiskMetric>
                  icon={<Layers size={13} />}
                  value={metric}
                  options={METRICS}
                  onChange={setMetric}
                />
                <Segmented<Basemap>
                  icon={<MapIcon size={13} />}
                  value={basemap}
                  options={BASEMAPS}
                  onChange={setBasemap}
                />
                <button
                  onClick={() => setSizeBy(s => (s === 'risk' ? 'acreage' : 'risk'))}
                  className="tap text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-slate-400 transition-colors"
                  title="Toggle marker sizing"
                >
                  Size: {sizeBy === 'risk' ? 'Risk' : 'Acreage'}
                </button>
                <button
                  onClick={() => setFlyToTop(n => n + 1)}
                  className="tap inline-flex items-center gap-1 text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-slate-400 transition-colors"
                >
                  <Crosshair size={13} /> Hottest
                </button>
                <button
                  onClick={() => setShowRiskOverlay(v => !v)}
                  className="tap text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-slate-400 transition-colors"
                >
                  {showRiskOverlay ? 'Hide risk' : 'Show risk'}
                </button>
              </>
            )}
            <button
              onClick={() => setShowMap(v => !v)}
              className="tap text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-slate-400 transition-colors"
            >
              {showMap ? 'Hide map' : 'Show map'}
            </button>
          </div>
        </div>
        {showMap &&
          (loading ? (
            <MapSkeleton />
          ) : (
            <RiskMap
              leads={filtered}
              selected={selected}
              onSelect={lead => setSelected(selected?.id === lead.id ? null : lead)}
              showRiskOverlay={showRiskOverlay}
              metric={metric}
              basemap={basemap}
              sizeBy={sizeBy}
              flyToTop={flyToTop}
            />
          ))}
      </div>

      {/* Rollups + spray window */}
      {!loading && filtered.length > 0 && <RollupPanels leads={filtered} />}

      {loading ? (
        <IntelBoardSkeleton />
      ) : (
        <div className="flex gap-5">
          {/* Action columns */}
          <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
            {(['TREAT_NOW', 'SCOUT_NOW', 'CONTACT_NOW', 'MONITOR'] as ActionRec[]).map(action => {
              const cfg = ACTION_CONFIG[action]
              const group = grouped[action]
              return (
                <div key={action} className="flex flex-col gap-2">
                  <div className={`flex items-center justify-between px-3 py-2 rounded-lg border ${cfg.bg} ${cfg.border}`}>
                    <span className={`flex items-center gap-1.5 text-xs font-bold ${cfg.text}`}>
                      <ActionIcon action={action} />
                      {cfg.label}
                    </span>
                    <span className={`text-xs font-bold ${cfg.text}`}>{group.length}</span>
                  </div>
                  <div className="space-y-2">
                    {group.map(lead => (
                      <RiskCard
                        key={lead.id}
                        lead={lead}
                        isSelected={selected?.id === lead.id}
                        onClick={() => setSelected(selected?.id === lead.id ? null : lead)}
                        cfg={cfg}
                      />
                    ))}
                    {group.length === 0 && (
                      <div className="text-xs text-slate-400 text-center py-4">None</div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Detail panel */}
          {selected && <DetailPanel lead={selected} onClose={() => setSelected(null)} />}
        </div>
      )}

      {/* Alerts + parcel register */}
      {!loading && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2">
            <ParcelTable
              leads={filtered}
              selected={selected}
              onSelect={lead => setSelected(selected?.id === lead.id ? null : lead)}
            />
          </div>
          <AlertsFeed />
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className={`text-lg font-bold ${accent ?? ''}`}>{value}</div>
    </div>
  )
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  icon,
}: {
  value: T
  options: { key: T; label: string }[]
  onChange: (v: T) => void
  icon?: React.ReactNode
}) {
  return (
    <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white p-0.5">
      {icon && <span className="text-slate-400 px-1.5">{icon}</span>}
      {options.map(o => (
        <button
          key={o.key}
          onClick={() => onChange(o.key)}
          className={`tap text-xs px-2.5 py-1 rounded-md font-medium transition-colors ${
            value === o.key ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function RiskCard({
  lead,
  isSelected,
  onClick,
  cfg,
}: {
  lead: Lead
  isSelected: boolean
  onClick: () => void
  cfg: { bg: string; border: string; dot: string }
}) {
  const risk = effectiveRisk(lead)
  const trend = lead.risk_trend
  return (
    <div
      onClick={onClick}
      className={`bg-white rounded-lg border p-3 cursor-pointer transition-colors
        ${isSelected ? 'border-brand-500 shadow-md' : 'border-slate-200 hover:border-slate-300'}`}
    >
      <div className="flex items-start justify-between gap-2 mb-1">
        <div className="text-xs font-semibold text-slate-800 leading-tight truncate">
          {lead.business_name ?? lead.owner_name ?? 'Unknown'}
        </div>
        <div className="text-xs font-bold text-slate-600 shrink-0 flex items-center gap-1">
          {trend === 'rising' && <span className="text-red-500">▲</span>}
          {trend === 'falling' && <span className="text-green-500">▼</span>}
          {risk}
        </div>
      </div>
      <div className="text-xs text-slate-400 mb-2">{lead.city} · {lead.primary_crop ?? 'Ag'}</div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${cfg.dot}`} style={{ width: `${risk}%` }} />
      </div>
    </div>
  )
}

function DetailPanel({ lead, onClose }: { lead: Lead; onClose: () => void }) {
  const assessment = useMemo(() => assessEfb(lead), [lead])
  const risk = effectiveRisk(lead)
  const factors: EfbFactor[] = lead.efb_factors ?? assessment.factors
  const spray = lead.spray_window_status ?? assessment.sprayWindow
  const confidence = lead.efb_confidence ?? assessment.confidence

  return (
    <div className="w-80 shrink-0 bg-white rounded-xl border border-slate-200 shadow-card p-5 space-y-4 self-start">
      <div className="flex items-start justify-between">
        <h3 className="font-semibold text-slate-900 text-sm leading-tight">
          {lead.business_name ?? lead.owner_name ?? 'Detail'}
        </h3>
        <button onClick={onClose} aria-label="Close detail" className="tap-sq text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
      </div>

      <div className="text-xs text-slate-500">
        {[lead.city, lead.county && `${lead.county} Co.`, lead.primary_crop].filter(Boolean).join(' · ')}
      </div>

      {/* Risk gauge */}
      <div>
        <div className="flex justify-between text-xs text-slate-500 mb-1">
          <span>Composite EFB Risk</span>
          <span className="font-bold text-slate-800 flex items-center gap-1">
            {lead.risk_trend === 'rising' && <span className="text-red-500">▲</span>}
            {lead.risk_trend === 'falling' && <span className="text-green-500">▼</span>}
            {risk}/100
          </span>
        </div>
        <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
          <div
            className={`h-full rounded-full ${
              risk >= 75 ? 'bg-red-500' : risk >= 55 ? 'bg-orange-400' : risk >= 40 ? 'bg-yellow-400' : 'bg-green-400'
            }`}
            style={{ width: `${risk}%` }}
          />
        </div>
        <div className="flex items-center justify-between mt-2 text-xs">
          <span className={`px-2 py-0.5 rounded-full border font-medium ${SPRAY_META[spray].cls}`}>
            Spray: {SPRAY_META[spray].label}
          </span>
          <span className="text-slate-400">Confidence {Math.round(confidence * 100)}%</span>
        </div>
      </div>

      {/* Explainable factor breakdown */}
      <div className="space-y-2">
        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Why this score</div>
        {factors.map(f => (
          <div key={f.key}>
            <div className="flex justify-between text-xs mb-0.5">
              <span className={`${f.present ? 'text-slate-600' : 'text-slate-400 italic'}`}>
                {f.label} {!f.present && '(est.)'}
              </span>
              <span className="text-slate-500">
                <span className="text-slate-400">{f.detail}</span> · +{f.contribution}
              </span>
            </div>
            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
              <div className="h-full rounded-full bg-slate-400" style={{ width: `${f.value * 100}%` }} />
            </div>
          </div>
        ))}
      </div>

      {lead.ml_efb_risk != null && (
        <div className="border-t border-slate-100 pt-3 space-y-2 text-xs">
          <div className="font-semibold text-slate-500 uppercase tracking-wide">ML Layer</div>
          <Row label="ML Risk" value={lead.ml_efb_risk} suffix="/100" />
          <Row label="Confidence" value={lead.ml_confidence != null ? `${(lead.ml_confidence * 100).toFixed(0)}` : null} suffix="%" />
          <Row label="Model" value={lead.model_version} />
        </div>
      )}

      <div className="border-t border-slate-100 pt-3 space-y-2 text-xs">
        <Row label="Est. Acreage" value={lead.est_acreage} suffix=" acres" />
        <Row label="Distance" value={lead.distance_to_canby_mi != null ? lead.distance_to_canby_mi.toFixed(1) : null} suffix=" mi" />
        <Row label="Lead Score" value={lead.lead_score} />
        <Row label="LOI Status" value={lead.loi_status?.replace(/_/g, ' ')} />
        {lead.efb_recomputed_at && (
          <Row label="Recomputed" value={new Date(lead.efb_recomputed_at).toLocaleDateString()} />
        )}
      </div>

      <div className="bg-slate-50 rounded-lg p-3 text-xs text-slate-600 leading-relaxed">
        {assessment.summary}
      </div>

      <div className="text-xs text-slate-400">
        Phone: {lead.phone ?? 'Not available'}<br />
        Email: {lead.email ?? 'Not available'}
      </div>
    </div>
  )
}

function Row({ label, value, suffix = '' }: { label: string; value: string | number | null | undefined; suffix?: string }) {
  if (value === null || value === undefined) return null
  return (
    <div className="flex justify-between">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-700 font-medium">{value}{suffix}</span>
    </div>
  )
}
