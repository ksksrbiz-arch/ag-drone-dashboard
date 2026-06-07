'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase, type Lead, type Vertical, type LOIStatus } from '@/lib/supabase'

const VERTICALS: { value: Vertical | 'all'; label: string }[] = [
  { value: 'all',         label: 'All Verticals' },
  { value: 'ag_spray',    label: '🌾 Ag Spray' },
  { value: 'insurance',   label: '🏠 Insurance' },
  { value: 'real_estate', label: '🏡 Real Estate' },
  { value: 'construction',label: '🏗️ Construction' },
]

const LOI_STATUSES: { value: LOIStatus | 'all'; label: string }[] = [
  { value: 'all',              label: 'All Statuses' },
  { value: 'not_contacted',    label: 'Not Contacted' },
  { value: 'contacted',        label: 'Contacted' },
  { value: 'meeting_scheduled',label: 'Meeting Scheduled' },
  { value: 'loi_sent',         label: 'LOI Sent' },
  { value: 'loi_signed',       label: 'LOI Signed' },
  { value: 'declined',         label: 'Declined' },
]

const ACTION_COLORS: Record<string, string> = {
  TREAT_NOW:   'bg-red-100 text-red-700',
  SCOUT_NOW:   'bg-orange-100 text-orange-700',
  CONTACT_NOW: 'bg-yellow-100 text-yellow-700',
  MONITOR:     'bg-green-100 text-green-700',
}

const LOI_COLORS: Record<string, string> = {
  not_contacted:     'bg-slate-100 text-slate-500',
  contacted:         'bg-blue-100 text-blue-600',
  meeting_scheduled: 'bg-indigo-100 text-indigo-600',
  loi_sent:          'bg-purple-100 text-purple-600',
  loi_signed:        'bg-green-100 text-green-700',
  declined:          'bg-red-100 text-red-500',
}

export default function LeadsPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [vertical, setVertical] = useState<Vertical | 'all'>('all')
  const [loiStatus, setLoiStatus] = useState<LOIStatus | 'all'>('all')
  const [sortBy, setSortBy] = useState<'lead_score' | 'composite_efb_risk' | 'distance_to_canby_mi'>('lead_score')
  const [selected, setSelected] = useState<Lead | null>(null)

  useEffect(() => {
    supabase
      .from('leads')
      .select('*')
      .order('lead_score', { ascending: false })
      .then(({ data }) => {
        setLeads(data ?? [])
        setLoading(false)
      })
  }, [])

  const filtered = useMemo(() => {
    return leads
      .filter(l => vertical === 'all' || l.vertical === vertical)
      .filter(l => loiStatus === 'all' || l.loi_status === loiStatus)
      .filter(l => {
        if (!search) return true
        const q = search.toLowerCase()
        return (
          l.business_name?.toLowerCase().includes(q) ||
          l.owner_name?.toLowerCase().includes(q) ||
          l.city?.toLowerCase().includes(q) ||
          l.county?.toLowerCase().includes(q) ||
          l.primary_crop?.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => (b[sortBy] ?? 0) - (a[sortBy] ?? 0))
  }, [leads, vertical, loiStatus, search, sortBy])

  return (
    <div className="p-6 max-w-screen-2xl mx-auto">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-slate-900">Lead Database</h1>
          <p className="text-slate-500 text-sm mt-0.5">{filtered.length} leads matching filters</p>
        </div>
        <div className="text-sm text-slate-500 bg-white border border-slate-200 px-3 py-1.5 rounded-lg">
          {leads.length} total
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4 mb-5 flex flex-wrap gap-3">
        <input
          type="text"
          placeholder="Search name, city, crop…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="flex-1 min-w-[180px] text-sm border border-slate-200 rounded-lg px-3 py-2
                     focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <select
          value={vertical}
          onChange={e => setVertical(e.target.value as Vertical | 'all')}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {VERTICALS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
        <select
          value={loiStatus}
          onChange={e => setLoiStatus(e.target.value as LOIStatus | 'all')}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {LOI_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as typeof sortBy)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="lead_score">Sort: Lead Score</option>
          <option value="composite_efb_risk">Sort: EFB Risk</option>
          <option value="distance_to_canby_mi">Sort: Distance</option>
        </select>
      </div>

      <div className="flex gap-5">
        {/* Table */}
        <div className="flex-1 bg-white rounded-xl border border-slate-200 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center h-48 text-slate-400 text-sm">
              Loading leads…
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100">
                  <tr className="text-left text-xs text-slate-500">
                    <th className="px-4 py-3 font-medium">Farm / Business</th>
                    <th className="px-4 py-3 font-medium">Location</th>
                    <th className="px-4 py-3 font-medium">Crop</th>
                    <th className="px-4 py-3 font-medium">Acres</th>
                    <th className="px-4 py-3 font-medium">Score</th>
                    <th className="px-4 py-3 font-medium">EFB Risk</th>
                    <th className="px-4 py-3 font-medium">Action</th>
                    <th className="px-4 py-3 font-medium">LOI Status</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(lead => (
                    <tr
                      key={lead.id}
                      onClick={() => setSelected(selected?.id === lead.id ? null : lead)}
                      className={`border-b border-slate-50 cursor-pointer transition-colors last:border-0
                        ${selected?.id === lead.id ? 'bg-brand-50' : 'hover:bg-slate-50'}`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900 truncate max-w-[200px]">
                          {lead.business_name ?? lead.owner_name ?? '—'}
                        </div>
                        {lead.contact_name && (
                          <div className="text-xs text-slate-400">{lead.contact_name}</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                        {lead.city}, {lead.county} Co.
                        {lead.distance_to_canby_mi && (
                          <div className="text-xs text-slate-400">{lead.distance_to_canby_mi.toFixed(1)} mi</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{lead.primary_crop ?? '—'}</td>
                      <td className="px-4 py-3 text-slate-600">{lead.est_acreage ?? '—'}</td>
                      <td className="px-4 py-3">
                        <span className="font-bold text-slate-800">{lead.lead_score ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3">
                        {lead.composite_efb_risk !== null ? (
                          <div className="flex items-center gap-1.5">
                            <div className="h-1.5 w-16 bg-slate-100 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${
                                  (lead.composite_efb_risk ?? 0) >= 75 ? 'bg-red-500' :
                                  (lead.composite_efb_risk ?? 0) >= 55 ? 'bg-orange-400' :
                                  (lead.composite_efb_risk ?? 0) >= 40 ? 'bg-yellow-400' : 'bg-green-400'
                                }`}
                                style={{ width: `${lead.composite_efb_risk}%` }}
                              />
                            </div>
                            <span className="text-xs text-slate-500">{lead.composite_efb_risk}</span>
                          </div>
                        ) : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        {lead.action_recommendation ? (
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_COLORS[lead.action_recommendation]}`}>
                            {lead.action_recommendation.replace('_', ' ')}
                          </span>
                        ) : <span className="text-slate-300 text-xs">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${LOI_COLORS[lead.loi_status] ?? ''}`}>
                          {lead.loi_status.replace(/_/g, ' ')}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-72 shrink-0 bg-white rounded-xl border border-slate-200 p-5 space-y-4 self-start">
            <div className="flex items-start justify-between">
              <h3 className="font-semibold text-slate-900 text-sm leading-tight">
                {selected.business_name ?? selected.owner_name ?? 'Lead Detail'}
              </h3>
              <button onClick={() => setSelected(null)} className="text-slate-400 hover:text-slate-600 text-lg leading-none">×</button>
            </div>

            <Section title="Contact">
              <Detail label="Owner" value={selected.owner_name} />
              <Detail label="Contact" value={selected.contact_name} />
              <Detail label="Phone" value={selected.phone} />
              <Detail label="Email" value={selected.email} />
              <Detail label="Assigned" value={selected.assigned_to} />
            </Section>

            <Section title="Property">
              <Detail label="Address" value={selected.address_physical} />
              <Detail label="City" value={`${selected.city}, ${selected.county} Co.`} />
              <Detail label="Acres" value={selected.est_acreage} />
              <Detail label="Crop" value={selected.primary_crop} />
              <Detail label="Distance" value={selected.distance_to_canby_mi ? `${selected.distance_to_canby_mi.toFixed(1)} mi` : null} />
            </Section>

            {selected.composite_efb_risk !== null && (
              <Section title="EFB Intelligence">
                <Detail label="Composite Risk" value={`${selected.composite_efb_risk}/100`} />
                <Detail label="ML Risk" value={selected.ml_efb_risk !== null ? `${selected.ml_efb_risk}/100` : null} />
                <Detail label="ML Confidence" value={selected.ml_confidence !== null ? `${(selected.ml_confidence * 100).toFixed(0)}%` : null} />
                <Detail label="Weather Risk" value={selected.efb_weather_risk !== null ? `${selected.efb_weather_risk}` : null} />
                <Detail label="Leaf Wetness" value={selected.leaf_wetness_hours !== null ? `${selected.leaf_wetness_hours}h` : null} />
                <Detail label="Anomaly vs 10yr" value={selected.wetness_anomaly_pct !== null ? `${selected.wetness_anomaly_pct}%` : null} />
                <Detail label="NDRE" value={selected.mean_ndre !== null ? selected.mean_ndre.toFixed(3) : null} />
                <Detail label="Health Score" value={selected.orchard_health_score !== null ? `${selected.orchard_health_score}/100` : null} />
                <Detail label="Model" value={selected.model_version} />
              </Section>
            )}

            <Section title="Pipeline">
              <Detail label="LOI Status" value={selected.loi_status.replace(/_/g, ' ')} />
              <Detail label="Lead Score" value={selected.lead_score} />
              <Detail label="Est. Revenue" value={selected.est_annual_revenue ? `$${selected.est_annual_revenue.toLocaleString()}` : null} />
              <Detail label="Source" value={selected.source} />
            </Section>

            {selected.notes && (
              <Section title="Notes">
                <p className="text-xs text-slate-500">{selected.notes}</p>
              </Section>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Detail({ label, value }: { label: string; value: string | number | null | undefined }) {
  if (!value && value !== 0) return null
  return (
    <div className="flex justify-between text-xs">
      <span className="text-slate-400">{label}</span>
      <span className="text-slate-700 font-medium text-right max-w-[150px] truncate">{String(value)}</span>
    </div>
  )
}
