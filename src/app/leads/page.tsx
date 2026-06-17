'use client'

import { useEffect, useState, useMemo } from 'react'
import dynamic from 'next/dynamic'
import { supabase, type Lead, type Vertical, type LOIStatus, type LeadScoreHistory } from '@/lib/supabase'
import { setSidekickFocus } from '@/lib/assistant/context'
import { useRole } from '@/lib/auth/role'
import { ActivityTimeline } from '@/components/ActivityTimeline'
import { BASEMAP_OPTIONS, type Basemap } from '@/lib/map/basemaps'
import type { ColorBy } from '@/components/intel/LeadMap'

// Leaflet touches `window` — load the territory map client-side only.
const LeadMap = dynamic(() => import('@/components/intel/LeadMap'), {
  ssr: false,
  loading: () => <div className="h-[360px] md:h-[460px] w-full skeleton rounded-xl" />,
})
import { AiBrief } from '@/components/AiBrief'
import { AskAce } from '@/components/AskAce'

const VERTICALS: { value: Vertical | 'all'; label: string }[] = [
  { value: 'all',         label: 'All Verticals' },
  { value: 'ag_spray',    label: '🌾 Ag Spray' },
  { value: 'insurance',   label: '🏠 Insurance' },
  { value: 'real_estate', label: '🏡 Real Estate' },
  { value: 'construction',label: '🏗️ Construction' },
  { value: 'energy',      label: '☀️ Solar & Infra' },
  { value: 'mapping',     label: '🗺️ Mapping' },
  { value: 'inspection',  label: '🔎 Inspection' },
  { value: 'survey',      label: '📐 Survey' },
  { value: 'delivery',    label: '📦 Delivery' },
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

const TIER_COLORS: Record<string, string> = {
  P1: 'bg-red-100 text-red-700',
  P2: 'bg-orange-100 text-orange-700',
  P3: 'bg-yellow-100 text-yellow-700',
  P4: 'bg-slate-100 text-slate-500',
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
  const { isStaff } = useRole()
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [vertical, setVertical] = useState<Vertical | 'all'>('all')
  const [loiStatus, setLoiStatus] = useState<LOIStatus | 'all'>('all')
  const [sortBy, setSortBy] = useState<'priority_score' | 'lead_score' | 'composite_efb_risk' | 'distance_to_canby_mi'>('priority_score')
  const [selected, setSelected] = useState<Lead | null>(null)
  const [refreshing, setRefreshing] = useState(false)
  const [converting, setConverting] = useState(false)
  const [convertMsg, setConvertMsg] = useState<string | null>(null)
  // Smart search (AI) + outreach drafting
  const [aiFilter, setAiFilter] = useState<Record<string, any> | null>(null)
  const [smartQuery, setSmartQuery] = useState('')
  const [smartBusy, setSmartBusy] = useState(false)
  const [draft, setDraft] = useState<string | null>(null)
  const [draftBusy, setDraftBusy] = useState<'email' | 'sms' | null>(null)
  const [rawNotes, setRawNotes] = useState('')
  const [structured, setStructured] = useState<any>(null)
  const [notesBusy, setNotesBusy] = useState(false)
  const [history, setHistory] = useState<LeadScoreHistory[]>([])
  // Table / map view + territory-map controls
  const [view, setView] = useState<'table' | 'map'>('table')
  const [mapColorBy, setMapColorBy] = useState<ColorBy>('priority')
  const [mapBasemap, setMapBasemap] = useState<Basemap>('streets')
  const [geocoding, setGeocoding] = useState(false)
  const [geoMsg, setGeoMsg] = useState<string | null>(null)

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

  useEffect(() => {
    setConvertMsg(null)
    setDraft(null)
    setRawNotes('')
    setStructured(null)
    // Load the selected lead's priority history for the sparkline (v4). Empty
    // until the score-history table is migrated + a couple of runs have landed.
    if (!selected?.id) {
      setHistory([])
      return
    }
    supabase
      .from('lead_score_history')
      .select('*')
      .eq('lead_id', selected.id)
      .order('captured_at', { ascending: true })
      .limit(30)
      .then(({ data }) => setHistory((data ?? []) as LeadScoreHistory[]))
  }, [selected?.id])

  // Publish the open lead to Sidekick (contextual "this lead").
  useEffect(() => {
    setSidekickFocus(
      selected ? { kind: 'lead', id: selected.id, name: selected.business_name ?? selected.owner_name } : null
    )
    return () => setSidekickFocus(null)
  }, [selected])

  // On phones the detail panel stacks below the list — bring it into view when
  // a lead is opened so the tap doesn't feel like nothing happened.
  useEffect(() => {
    if (selected && typeof window !== 'undefined' && window.matchMedia('(max-width: 1023px)').matches) {
      requestAnimationFrame(() =>
        document.getElementById('lead-detail-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      )
    }
  }, [selected?.id])

  // Deep-link: apply filters passed in the URL (e.g. Sidekick "show me Marion P1s").
  useEffect(() => {
    const p = new URLSearchParams(window.location.search)
    const af: Record<string, any> = {}
    for (const k of ['county', 'city', 'crop', 'vertical', 'priority_tier', 'action_recommendation', 'loi_status']) {
      const v = p.get(k)
      if (v) af[k] = v
    }
    const mps = p.get('min_priority_score')
    if (mps && !Number.isNaN(Number(mps))) af.min_priority_score = Number(mps)
    const q = p.get('search')
    if (q) setSearch(q)
    if (Object.keys(af).length) setAiFilter(af)
  }, [])

  // Geocode leads that are missing coordinates (any vertical) via the free
  // Census backfill, then refresh so the new pins appear on the map.
  async function geocodeLeads() {
    setGeocoding(true)
    setGeoMsg(null)
    try {
      const res = await fetch('/api/efb/geocode?limit=2000', { method: 'POST' })
      const json = await res.json()
      if (res.ok && json.ok) {
        const { data } = await supabase.from('leads').select('*').order('lead_score', { ascending: false })
        setLeads(data ?? [])
        setGeoMsg(
          json.updated > 0
            ? `Mapped ${json.updated} more lead(s).`
            : `No new matches — ${json.attempted} address(es) tried (rural/PO-box addresses may not geocode).`
        )
      } else {
        setGeoMsg(`Geocode failed: ${json.error ?? res.statusText}`)
      }
    } catch (err: any) {
      setGeoMsg(`Geocode failed: ${String(err?.message ?? err)}`)
    } finally {
      setGeocoding(false)
    }
  }

  async function structureNotes() {
    if (!rawNotes.trim() || notesBusy || !selected) return
    setNotesBusy(true)
    setStructured(null)
    try {
      const res = await fetch('/api/notes/structure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: selected.id, notes: rawNotes }),
      })
      const json = await res.json()
      setStructured(res.ok && json.ok ? json.structured : { error: json.error ?? res.statusText })
    } catch (err: any) {
      setStructured({ error: String(err?.message ?? err) })
    } finally {
      setNotesBusy(false)
    }
  }

  async function saveStructured() {
    if (!selected || !structured || structured.error) return
    const lines = [
      structured.summary,
      ...(Array.isArray(structured.next_steps) && structured.next_steps.length
        ? ['Next steps:', ...structured.next_steps.map((s: string) => `- ${s}`)]
        : []),
    ]
      .filter(Boolean)
      .join('\n')
    const stamp = new Date().toLocaleDateString()
    const appended = `${selected.notes ? selected.notes + '\n\n' : ''}[${stamp}] ${lines}`
    const patch: Record<string, unknown> = { notes: appended }
    if (structured.suggested_loi_status) patch.loi_status = structured.suggested_loi_status
    const { data } = await supabase.from('leads').update(patch).eq('id', selected.id).select().single()
    if (data) {
      setLeads(prev => prev.map(l => (l.id === (data as Lead).id ? (data as Lead) : l)))
      setSelected(data as Lead)
    }
    setStructured(null)
    setRawNotes('')
  }

  async function runSmartSearch() {
    const q = smartQuery.trim()
    if (!q || smartBusy) return
    setSmartBusy(true)
    try {
      const res = await fetch('/api/leads/smart-search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q }),
      })
      const json = await res.json()
      if (res.ok && json.ok) setAiFilter(json.filter ?? {})
    } finally {
      setSmartBusy(false)
    }
  }

  async function draftOutreach(channel: 'email' | 'sms') {
    if (!selected) return
    setDraftBusy(channel)
    setDraft(null)
    try {
      const res = await fetch('/api/outreach/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: selected.id, channel }),
      })
      const json = await res.json()
      setDraft(res.ok && json.ok ? json.draft : `Failed: ${json.error ?? res.statusText}`)
    } catch (err: any) {
      setDraft(`Failed: ${String(err?.message ?? err)}`)
    } finally {
      setDraftBusy(null)
    }
  }

  async function refreshIntel(lead: Lead) {
    setRefreshing(true)
    try {
      await fetch(`/api/enrich/lead/${lead.id}`, { method: 'POST' })
      const { data } = await supabase.from('leads').select('*').eq('id', lead.id).limit(1)
      const updated = (data?.[0] as Lead) ?? null
      if (updated) {
        setLeads(prev => prev.map(l => (l.id === updated.id ? updated : l)))
        setSelected(updated)
      }
    } finally {
      setRefreshing(false)
    }
  }

  async function convertToCustomer(lead: Lead) {
    setConverting(true)
    setConvertMsg(null)
    try {
      const { data: existing } = await supabase
        .from('customers')
        .select('id')
        .eq('lead_id', lead.id)
        .limit(1)
      if (existing && existing.length > 0) {
        setConvertMsg('Already a customer ✓')
        return
      }
      const { error } = await supabase.from('customers').insert({
        business_name: lead.business_name,
        contact_name: lead.contact_name ?? lead.owner_name,
        phone: lead.phone,
        email: lead.email,
        address: lead.address_physical,
        city: lead.city,
        county: lead.county,
        state: lead.state ?? 'OR',
        primary_crop: lead.primary_crop,
        est_acreage: lead.est_acreage,
        status: lead.loi_status === 'loi_signed' ? 'active' : 'prospect',
        lead_id: lead.id,
        notes: lead.research_summary,
      })
      setConvertMsg(error ? `Failed: ${error.message}` : 'Added to Customers ✓')
    } finally {
      setConverting(false)
    }
  }

  const filtered = useMemo(() => {
    const af = aiFilter ?? {}
    const includes = (val: string | null | undefined, term: unknown) =>
      !term || (val ?? '').toLowerCase().includes(String(term).toLowerCase())
    const allowedSorts = ['priority_score', 'lead_score', 'composite_efb_risk', 'distance_to_canby_mi']
    const sortKey = (allowedSorts.includes(af.sort) ? af.sort : sortBy) as typeof sortBy
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
      // AI smart-search layer (from /api/leads/smart-search)
      .filter(l => !af.vertical || l.vertical === af.vertical)
      .filter(l => !af.loi_status || l.loi_status === af.loi_status)
      .filter(l => !af.priority_tier || l.priority_tier === af.priority_tier)
      .filter(l => !af.action_recommendation || l.action_recommendation === af.action_recommendation)
      .filter(l => af.min_priority_score == null || (l.priority_score ?? 0) >= af.min_priority_score)
      .filter(l => includes(l.county, af.county))
      .filter(l => includes(l.city, af.city))
      .filter(l => includes(l.primary_crop, af.crop))
      .filter(l => {
        if (!af.text) return true
        const q = String(af.text).toLowerCase()
        return (
          l.business_name?.toLowerCase().includes(q) ||
          l.owner_name?.toLowerCase().includes(q) ||
          l.city?.toLowerCase().includes(q) ||
          l.county?.toLowerCase().includes(q) ||
          l.primary_crop?.toLowerCase().includes(q)
        )
      })
      .sort((a, b) => ((b[sortKey] as number) ?? 0) - ((a[sortKey] as number) ?? 0))
  }, [leads, vertical, loiStatus, search, sortBy, aiFilter])

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-screen-2xl mx-auto animate-fade">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Lead Database</h1>
          <p className="text-slate-500 text-sm mt-0.5">{filtered.length} leads matching filters</p>
        </div>
        <div className="text-sm text-slate-500 bg-white border border-slate-200 px-3 py-1.5 rounded-lg">
          {leads.length} total
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-card p-4 mb-5 space-y-3">
        <form onSubmit={e => { e.preventDefault(); runSmartSearch() }} className="flex gap-2">
          <input
            value={smartQuery}
            onChange={e => setSmartQuery(e.target.value)}
            placeholder="✨ Smart search — e.g. “hottest hazelnut leads in Marion County not contacted”"
            className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button
            type="submit"
            disabled={smartBusy || !smartQuery.trim()}
            className="tap inline-flex items-center justify-center text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-4 transition-colors disabled:opacity-60"
          >
            {smartBusy ? '…' : 'Search'}
          </button>
          {aiFilter && (
            <button
              type="button"
              onClick={() => { setAiFilter(null); setSmartQuery('') }}
              className="tap inline-flex items-center text-sm text-slate-500 hover:text-slate-700 px-2"
            >
              Clear
            </button>
          )}
        </form>
        <div className="flex flex-wrap gap-3">
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
          className="tap text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {VERTICALS.map(v => <option key={v.value} value={v.value}>{v.label}</option>)}
        </select>
        <select
          value={loiStatus}
          onChange={e => setLoiStatus(e.target.value as LOIStatus | 'all')}
          className="tap text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          {LOI_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as typeof sortBy)}
          className="tap text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="priority_score">Sort: Priority</option>
          <option value="lead_score">Sort: Lead Score</option>
          <option value="composite_efb_risk">Sort: EFB Risk</option>
          <option value="distance_to_canby_mi">Sort: Distance</option>
        </select>
        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-sm">
          {(['table', 'map'] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`tap px-3 py-2 font-medium transition-colors ${view === v ? 'bg-brand-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'}`}
            >
              {v === 'table' ? '☰ Table' : '🗺️ Map'}
            </button>
          ))}
        </div>
        {view === 'map' && (
          <>
            <select
              value={mapColorBy}
              onChange={e => setMapColorBy(e.target.value as ColorBy)}
              className="tap text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="priority">Color: Priority</option>
              <option value="status">Color: Pipeline</option>
              <option value="efb">Color: EFB risk</option>
              <option value="crop">Color: Crop</option>
            </select>
            <select
              value={mapBasemap}
              onChange={e => setMapBasemap(e.target.value as Basemap)}
              className="tap text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              {BASEMAP_OPTIONS.map(b => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
            {isStaff && (
              <button
                type="button"
                onClick={geocodeLeads}
                disabled={geocoding}
                title="Geocode leads missing coordinates so they appear on the map"
                className="tap inline-flex items-center text-sm border border-slate-200 hover:border-brand-300 hover:text-brand-700 rounded-lg px-3 py-2 font-medium transition-colors disabled:opacity-60"
              >
                {geocoding ? 'Geocoding…' : `📍 Geocode${leads.filter(l => l.lat == null).length ? ` (${leads.filter(l => l.lat == null).length})` : ''}`}
              </button>
            )}
          </>
        )}
        </div>
      </div>

      {geoMsg && (
        <div className="mb-3 text-xs rounded-lg border border-brand-200 bg-brand-50 text-brand-800 px-3 py-2">{geoMsg}</div>
      )}

      <div className="flex flex-col lg:flex-row gap-5">
        {/* Table / Map */}
        <div className="flex-1 min-w-0">
          {loading ? (
            <div className="bg-white rounded-xl border border-slate-200 shadow-card p-4 space-y-2">
              {Array.from({ length: 12 }).map((_, i) => <div key={i} className="h-10 skeleton" />)}
            </div>
          ) : view === 'map' ? (
            <LeadMap
              leads={filtered}
              counties={[]}
              mode="leads"
              colorBy={mapColorBy}
              basemap={mapBasemap}
              onSelect={setSelected}
              selectedId={selected?.id ?? null}
            />
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-100 sticky top-0 z-10">
                  <tr className="text-left text-xs text-slate-500">
                    <th className="px-4 py-3 font-medium">Farm / Business</th>
                    <th className="px-4 py-3 font-medium">Priority</th>
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
                      <td className="px-4 py-3 whitespace-nowrap">
                        {lead.priority_tier ? (
                          <span className="inline-flex items-center gap-1.5">
                            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TIER_COLORS[lead.priority_tier] ?? ''}`}>
                              {lead.priority_tier}
                            </span>
                            <span className="text-xs font-bold text-slate-600">{lead.priority_score}</span>
                          </span>
                        ) : <span className="text-slate-300 text-xs">—</span>}
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
          <div id="lead-detail-panel" className="w-full lg:w-72 lg:shrink-0 bg-white rounded-xl border border-slate-200 shadow-card p-5 space-y-4 self-start scroll-mt-20">
            <div className="flex items-start justify-between">
              <h3 className="font-semibold text-slate-900 text-sm leading-tight">
                {selected.business_name ?? selected.owner_name ?? 'Lead Detail'}
              </h3>
              <button onClick={() => setSelected(null)} aria-label="Close detail" className="tap-sq inline-flex items-center justify-center text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
            </div>

            <AskAce
              label="Brief me"
              query={`Give me a quick brief on the lead ${selected.business_name ?? selected.owner_name ?? ''} — why they matter and the single best next action.`}
            />

            <AiBrief entityType="lead" entityId={selected.id} />

            {(selected.priority_score != null || selected.recommended_approach || selected.enrichment_status) && (
              <Section title="Intelligence">
                {selected.priority_score != null && (
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-slate-400">Priority</span>
                    <span className="flex items-center gap-1.5">
                      <PriorityTrend trend={selected.priority_trend} delta={selected.priority_delta} />
                      {selected.priority_tier && (
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TIER_COLORS[selected.priority_tier] ?? ''}`}>
                          {selected.priority_tier}
                        </span>
                      )}
                      <span className="text-sm font-bold text-slate-700">{selected.priority_score}/100</span>
                    </span>
                  </div>
                )}
                {selected.priority_explanation && (
                  <p className="text-xs text-slate-400 mb-1">{selected.priority_explanation}</p>
                )}
                {history.length >= 2 && (
                  <div className="mt-1 mb-2">
                    <div className="flex items-center justify-between text-xs text-slate-400 mb-0.5">
                      <span>Priority history</span>
                      <span>{history.length} runs</span>
                    </div>
                    <Sparkline points={history.map(h => h.score ?? 0)} />
                  </div>
                )}
                <Detail label="Data Completeness" value={selected.data_completeness != null ? `${selected.data_completeness}%` : null} />
                <Detail label="Enrichment" value={selected.enrichment_status} />
                <Detail label="AI Confidence" value={selected.enrichment_confidence != null ? `${Math.round(selected.enrichment_confidence * 100)}%` : null} />
                <Detail label="Last Enriched" value={selected.enriched_at ? new Date(selected.enriched_at).toLocaleDateString() : null} />
                {selected.best_contact_method && <Detail label="Best Contact" value={selected.best_contact_method} />}
                {selected.recommended_approach && (
                  <div className="mt-2 text-xs text-slate-600 bg-brand-50 border border-brand-100 rounded-lg p-2.5">
                    <span className="font-semibold text-brand-700">Recommended approach:</span> {selected.recommended_approach}
                  </div>
                )}
                {selected.next_best_action && (
                  <div className="mt-2 text-xs text-slate-700 bg-emerald-50 border border-emerald-100 rounded-lg p-2.5">
                    <span className="font-semibold text-emerald-700">Next best action:</span> {selected.next_best_action}
                  </div>
                )}
                {Array.isArray(selected.talking_points) && selected.talking_points.length > 0 && (
                  <div className="mt-2">
                    <div className="text-xs text-slate-400 mb-1">Talking points</div>
                    <ul className="list-disc pl-4 space-y-0.5 text-xs text-slate-600">
                      {selected.talking_points.map((t, i) => <li key={i}>{t}</li>)}
                    </ul>
                  </div>
                )}
                {selected.research_summary && (
                  <p className="mt-2 text-xs text-slate-500">{selected.research_summary}</p>
                )}
              </Section>
            )}

            <Section title="Contact">
              <Detail label="Owner" value={selected.owner_name} />
              <Detail label="Contact" value={selected.contact_name} />
              <Detail label="Phone" value={selected.phone} />
              <Detail label="Email" value={selected.email} />
              <Detail label="Assigned" value={selected.assigned_to} />
            </Section>

            <ActivityTimeline entityType="lead" entityId={selected.id} />

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

            {isStaff && (<>
            <button
              onClick={() => refreshIntel(selected)}
              disabled={refreshing}
              className="tap inline-flex items-center justify-center gap-1.5 w-full text-xs bg-brand-500 hover:bg-brand-600 text-white rounded-lg
                         py-2 font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {refreshing ? 'Researching…' : '🤖 Refresh intel'}
            </button>

            <button
              onClick={() => convertToCustomer(selected)}
              disabled={converting}
              className="tap inline-flex items-center justify-center gap-1.5 w-full text-xs bg-white border border-brand-300 text-brand-700 hover:bg-brand-50 rounded-lg
                         py-2 font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {converting ? 'Converting…' : '🤝 Convert to customer'}
            </button>
            {convertMsg && <p className="text-xs text-center text-slate-500">{convertMsg}</p>}

            <div className="pt-3 border-t border-slate-100">
              <div className="text-xs text-slate-400 mb-1.5">Draft outreach</div>
              <div className="flex gap-2">
                <button
                  onClick={() => draftOutreach('email')}
                  disabled={draftBusy !== null}
                  className="tap inline-flex items-center justify-center flex-1 text-xs border border-slate-200 hover:border-brand-300 hover:text-brand-700 rounded-lg py-2 font-medium transition-colors disabled:opacity-60"
                >
                  {draftBusy === 'email' ? 'Drafting…' : '✉️ Email'}
                </button>
                <button
                  onClick={() => draftOutreach('sms')}
                  disabled={draftBusy !== null}
                  className="tap inline-flex items-center justify-center flex-1 text-xs border border-slate-200 hover:border-brand-300 hover:text-brand-700 rounded-lg py-2 font-medium transition-colors disabled:opacity-60"
                >
                  {draftBusy === 'sms' ? 'Drafting…' : '💬 SMS'}
                </button>
              </div>
              {draft && (
                <div className="mt-2">
                  <textarea
                    readOnly
                    value={draft}
                    rows={7}
                    className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-2 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  <button
                    onClick={() => navigator.clipboard?.writeText(draft)}
                    className="tap inline-flex items-center text-xs text-slate-500 hover:text-slate-700 mt-1"
                  >
                    Copy
                  </button>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100">
              <div className="text-xs text-slate-400 mb-1.5">Structure call/meeting notes</div>
              <textarea
                value={rawNotes}
                onChange={e => setRawNotes(e.target.value)}
                rows={3}
                placeholder="Paste rough notes from a call or visit…"
                className="w-full text-xs border border-slate-200 rounded-lg px-2.5 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <button
                onClick={structureNotes}
                disabled={notesBusy || !rawNotes.trim()}
                className="tap inline-flex items-center justify-center w-full mt-2 text-xs bg-white border border-brand-300 text-brand-700 hover:bg-brand-50 rounded-lg py-2 font-medium transition-colors disabled:opacity-60"
              >
                {notesBusy ? 'Structuring…' : '🧩 Structure notes'}
              </button>
              {structured &&
                (structured.error ? (
                  <p className="text-xs text-red-600 mt-2">{structured.error}</p>
                ) : (
                  <div className="mt-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-lg p-2.5 space-y-1.5">
                    {structured.summary && <p>{structured.summary}</p>}
                    {Array.isArray(structured.next_steps) && structured.next_steps.length > 0 && (
                      <ul className="list-disc pl-4 space-y-0.5">
                        {structured.next_steps.map((s: string, i: number) => <li key={i}>{s}</li>)}
                      </ul>
                    )}
                    {structured.suggested_loi_status && (
                      <p className="text-slate-500">
                        Suggested stage:{' '}
                        <span className="font-medium">{String(structured.suggested_loi_status).replace(/_/g, ' ')}</span>
                      </p>
                    )}
                    <button
                      onClick={saveStructured}
                      className="tap inline-flex items-center justify-center w-full mt-1 text-xs bg-brand-500 hover:bg-brand-600 text-white rounded-lg py-2 font-medium transition-colors"
                    >
                      Save to lead
                    </button>
                  </div>
                ))}
            </div>
            </>)}
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

// Minimal inline-SVG sparkline of a lead's priority score over time (v4).
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return null
  const w = 200
  const h = 36
  const pad = 3
  const min = Math.min(...points)
  const max = Math.max(...points)
  const range = max - min || 1
  const step = (w - pad * 2) / (points.length - 1)
  const coords = points.map((p, i) => {
    const x = pad + i * step
    const y = h - pad - ((p - min) / range) * (h - pad * 2)
    return `${x.toFixed(1)},${y.toFixed(1)}`
  })
  const rising = points[points.length - 1] >= points[0]
  return (
    <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="block">
      <polyline
        points={coords.join(' ')}
        fill="none"
        stroke={rising ? '#16a34a' : '#ef4444'}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

// Compact priority-momentum indicator (▲ +N / ▼ −N / new) for the detail panel.
function PriorityTrend({ trend, delta }: { trend?: string | null; delta?: number | null }) {
  if (!trend) return null
  const meta: Record<string, { icon: string; cls: string }> = {
    up: { icon: '▲', cls: 'text-green-600' },
    down: { icon: '▼', cls: 'text-red-500' },
    flat: { icon: '▬', cls: 'text-slate-400' },
    new: { icon: '✦', cls: 'text-brand-500' },
  }
  const m = meta[trend] ?? meta.flat
  const label = trend === 'new' ? 'new' : delta != null && delta !== 0 ? `${delta > 0 ? '+' : ''}${delta}` : ''
  return (
    <span className={`text-xs font-medium tabular-nums ${m.cls}`} title={`Priority ${trend}`}>
      {m.icon}{label && <span className="ml-0.5">{label}</span>}
    </span>
  )
}
