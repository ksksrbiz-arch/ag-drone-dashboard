'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase, type Lead, type ActionRec } from '@/lib/supabase'

const ACTION_CONFIG: Record<ActionRec, { label: string; bg: string; border: string; text: string; dot: string }> = {
  TREAT_NOW:   { label: '🔴 Treat Now',   bg: 'bg-red-50',    border: 'border-red-200',    text: 'text-red-700',    dot: 'bg-red-500'    },
  SCOUT_NOW:   { label: '🟠 Scout Now',   bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', dot: 'bg-orange-500' },
  CONTACT_NOW: { label: '🟡 Contact Now', bg: 'bg-yellow-50', border: 'border-yellow-200', text: 'text-yellow-700', dot: 'bg-yellow-400' },
  MONITOR:     { label: '🟢 Monitor',     bg: 'bg-green-50',  border: 'border-green-200',  text: 'text-green-700',  dot: 'bg-green-500'  },
}

export default function IntelPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [crop, setCrop] = useState<string>('all')
  const [selected, setSelected] = useState<Lead | null>(null)

  useEffect(() => {
    supabase
      .from('leads')
      .select('*')
      .eq('vertical', 'ag_spray')
      .not('composite_efb_risk', 'is', null)
      .order('composite_efb_risk', { ascending: false })
      .then(({ data }) => {
        setLeads(data ?? [])
        setLoading(false)
      })
  }, [])

  const crops = useMemo(() => {
    const set = new Set(leads.map(l => l.primary_crop).filter(Boolean) as string[])
    return ['all', ...Array.from(set).sort()]
  }, [leads])

  const filtered = useMemo(() =>
    crop === 'all' ? leads : leads.filter(l => l.primary_crop === crop),
    [leads, crop]
  )

  const grouped = (['TREAT_NOW', 'SCOUT_NOW', 'CONTACT_NOW', 'MONITOR'] as ActionRec[]).reduce(
    (acc, action) => {
      acc[action] = filtered.filter(l => l.action_recommendation === action)
      return acc
    },
    {} as Record<ActionRec, Lead[]>
  )

  const withoutRec = filtered.filter(l => !l.action_recommendation)

  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">EFB Intelligence Hub</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Composite risk scores from 10m CDL · PRISM weather · ML model · NDRE trends
          </p>
        </div>
        <select
          value={crop}
          onChange={e => setCrop(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {crops.map(c => <option key={c} value={c}>{c === 'all' ? 'All Crops' : c}</option>)}
        </select>
      </div>

      {/* Model status bar */}
      <div className="bg-slate-800 text-white rounded-xl px-5 py-3 mb-6 flex flex-wrap gap-6 text-sm">
        <Stat label="Parcels Analyzed" value={filtered.length} />
        <Stat label="High Risk (≥75)" value={filtered.filter(l => (l.composite_efb_risk ?? 0) >= 75).length} />
        <Stat label="Avg EFB Risk" value={
          filtered.length
            ? Math.round(filtered.reduce((s, l) => s + (l.composite_efb_risk ?? 0), 0) / filtered.length)
            : '—'
        } />
        <Stat label="ML Covered" value={`${filtered.filter(l => l.ml_efb_risk !== null).length} parcels`} />
        <Stat label="Avg ML Confidence" value={
          filtered.filter(l => l.ml_confidence !== null).length
            ? `${Math.round(filtered.filter(l => l.ml_confidence !== null).reduce((s, l) => s + (l.ml_confidence ?? 0), 0) / filtered.filter(l => l.ml_confidence !== null).length * 100)}%`
            : '—'
        } />
      </div>

      {loading ? (
        <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
          Loading intelligence data…
        </div>
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
                    <span className={`text-xs font-bold ${cfg.text}`}>{cfg.label}</span>
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
          {selected && (
            <div className="w-72 shrink-0 bg-white rounded-xl border border-slate-200 p-5 space-y-4 self-start">
              <div className="flex items-start justify-between">
                <h3 className="font-semibold text-slate-900 text-sm leading-tight">
                  {selected.business_name ?? selected.owner_name ?? 'Detail'}
                </h3>
                <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
              </div>

              <div className="text-xs text-slate-500">{selected.city}, {selected.county} Co. · {selected.primary_crop}</div>

              {/* Risk gauge */}
              <div>
                <div className="flex justify-between text-xs text-slate-500 mb-1">
                  <span>Composite EFB Risk</span>
                  <span className="font-bold text-slate-800">{selected.composite_efb_risk}/100</span>
                </div>
                <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      (selected.composite_efb_risk ?? 0) >= 75 ? 'bg-red-500' :
                      (selected.composite_efb_risk ?? 0) >= 55 ? 'bg-orange-400' :
                      (selected.composite_efb_risk ?? 0) >= 40 ? 'bg-yellow-400' : 'bg-green-400'
                    }`}
                    style={{ width: `${selected.composite_efb_risk ?? 0}%` }}
                  />
                </div>
              </div>

              {/* Breakdown */}
              <div className="space-y-2 text-xs">
                <Row label="Weather Risk" value={selected.efb_weather_risk} suffix="/100" />
                <Row label="Leaf Wetness" value={selected.leaf_wetness_hours} suffix="h" />
                <Row label="Wetness Anomaly" value={selected.wetness_anomaly_pct} suffix="% vs 10yr" />
                <Row label="Orchard Health" value={selected.orchard_health_score} suffix="/100" />
                <Row label="NDRE (mean)" value={selected.mean_ndre !== null ? selected.mean_ndre?.toFixed(3) : null} />
                <Row label="NDRE Slope" value={selected.ndre_seasonal_slope !== null ? selected.ndre_seasonal_slope?.toFixed(5) : null} />
              </div>

              {selected.ml_efb_risk !== null && (
                <div className="border-t border-slate-100 pt-3 space-y-2 text-xs">
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">ML Layer</div>
                  <Row label="ML Risk" value={selected.ml_efb_risk} suffix="/100" />
                  <Row label="Confidence" value={selected.ml_confidence !== null ? `${((selected.ml_confidence ?? 0) * 100).toFixed(0)}` : null} suffix="%" />
                  <Row label="Model" value={selected.model_version} />
                </div>
              )}

              <div className="border-t border-slate-100 pt-3 space-y-2 text-xs">
                <Row label="Est. Acreage" value={selected.est_acreage} suffix=" acres" />
                <Row label="Distance" value={selected.distance_to_canby_mi !== null ? selected.distance_to_canby_mi?.toFixed(1) : null} suffix=" mi" />
                <Row label="Lead Score" value={selected.lead_score} />
                <Row label="LOI Status" value={selected.loi_status?.replace(/_/g, ' ')} />
              </div>

              <div className="pt-1">
                <div className="text-xs text-slate-400">
                  Phone: {selected.phone ?? 'Not available'}<br />
                  Email: {selected.email ?? 'Not available'}
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Unscored leads */}
      {withoutRec.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-slate-500 mb-3">
            Ag Leads Without Action Classification ({withoutRec.length})
          </h2>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex flex-wrap gap-2">
              {withoutRec.map(lead => (
                <div
                  key={lead.id}
                  className="text-xs bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 text-slate-600"
                >
                  {lead.business_name ?? lead.owner_name ?? 'Unknown'} · EFB {lead.composite_efb_risk ?? '?'}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="text-lg font-bold">{value}</div>
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
  const risk = lead.composite_efb_risk ?? 0
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
        <div className="text-xs font-bold text-slate-600 shrink-0">{risk}</div>
      </div>
      <div className="text-xs text-slate-400 mb-2">
        {lead.city} · {lead.primary_crop ?? 'Ag'}
      </div>
      <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${cfg.dot}`}
          style={{ width: `${risk}%` }}
        />
      </div>
      {lead.ml_confidence !== null && (
        <div className="text-xs text-slate-400 mt-1.5">
          ML conf: {((lead.ml_confidence ?? 0) * 100).toFixed(0)}%
          {lead.efb_weather_risk !== null && ` · ☁️ ${lead.efb_weather_risk}`}
        </div>
      )}
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
