'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  supabase,
  type Lead,
  type EnrichmentRun,
  type PriorityTier,
} from '@/lib/supabase'
import type { DupCluster } from '@/lib/enrichment/dedupe'
import EfbAutomationPanel from '@/components/intel/EfbAutomationPanel'

interface Capabilities {
  aiEnabled: boolean
  apolloEnabled: boolean
  writeMode: 'service_role' | 'anon' | 'none'
  modelVersion: string
  staleDays: number
  batchSize: number
  concurrency: number
  retries?: number
}

const TREND_META: Record<string, { icon: string; cls: string }> = {
  up: { icon: '▲', cls: 'text-green-600' },
  down: { icon: '▼', cls: 'text-red-500' },
  flat: { icon: '▬', cls: 'text-slate-400' },
  new: { icon: '✦', cls: 'text-brand-500' },
}

function TrendBadge({ trend, delta }: { trend?: string | null; delta?: number | null }) {
  if (!trend) return null
  const m = TREND_META[trend] ?? TREND_META.flat
  const label =
    trend === 'new'
      ? 'new'
      : delta != null && delta !== 0
      ? `${delta > 0 ? '+' : ''}${delta}`
      : ''
  return (
    <span className={`text-xs font-medium tabular-nums ${m.cls}`} title={`Priority ${trend}`}>
      {m.icon}
      {label && <span className="ml-0.5">{label}</span>}
    </span>
  )
}

const TIER_META: Record<PriorityTier, { label: string; cls: string; bar: string }> = {
  P1: { label: 'P1 · Hot', cls: 'bg-red-50 text-red-700 border-red-200', bar: 'bg-red-500' },
  P2: { label: 'P2 · Warm', cls: 'bg-orange-50 text-orange-700 border-orange-200', bar: 'bg-orange-400' },
  P3: { label: 'P3 · Nurture', cls: 'bg-yellow-50 text-yellow-700 border-yellow-200', bar: 'bg-yellow-400' },
  P4: { label: 'P4 · Cold', cls: 'bg-slate-50 text-slate-600 border-slate-200', bar: 'bg-slate-400' },
}

const STATUS_META: Record<string, string> = {
  enriched: 'bg-green-100 text-green-700',
  researching: 'bg-blue-100 text-blue-700',
  pending: 'bg-slate-100 text-slate-500',
  failed: 'bg-red-100 text-red-600',
  stale: 'bg-amber-100 text-amber-700',
}

export default function AutomationPage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [runs, setRuns] = useState<EnrichmentRun[]>([])
  const [nextActions, setNextActions] = useState<Lead[]>([])
  const [caps, setCaps] = useState<Capabilities | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [tagBusy, setTagBusy] = useState<'preview' | 'apply' | null>(null)
  const [tagResult, setTagResult] = useState<any>(null)
  const [dupes, setDupes] = useState<DupCluster[]>([])
  const [dupBusy, setDupBusy] = useState<string | null>(null)
  const [dupMsg, setDupMsg] = useState<string | null>(null)
  const [followups, setFollowups] = useState<any[]>([])
  const [heating, setHeating] = useState<any[]>([])

  const loadLeads = useCallback(async () => {
    const { data } = await supabase.from('leads').select('*')
    setLeads((data ?? []) as Lead[])
  }, [])

  const loadDupes = useCallback(async () => {
    try {
      const res = await fetch('/api/leads/dedupe', { cache: 'no-store' })
      const json = await res.json()
      setDupes(json.ok ? (json.clusters ?? []) : [])
    } catch {
      /* dedupe is best-effort */
    }
  }, [])

  async function mergeCluster(cluster: DupCluster) {
    // Keep the member with the strongest score as the survivor.
    const sorted = [...cluster.members].sort(
      (a, b) => (b.priority_score ?? -1) - (a.priority_score ?? -1)
    )
    const primary = sorted[0]
    const mergeIds = sorted.slice(1).map(m => m.id)
    setDupBusy(primary.id)
    setDupMsg(null)
    try {
      const res = await fetch('/api/leads/dedupe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ primaryId: primary.id, mergeIds }),
      })
      const json = await res.json()
      if (!res.ok || json.ok === false) {
        setDupMsg(`Merge failed: ${json.error ?? res.statusText}`)
      } else {
        setDupMsg(
          `Merged ${json.markedDuplicate} duplicate(s) into ${primary.business_name ?? primary.owner_name ?? 'lead'}` +
            (json.backfilled?.length ? ` · backfilled ${json.backfilled.join(', ')}` : '')
        )
        await Promise.all([loadLeads(), loadDupes()])
      }
    } catch (err: any) {
      setDupMsg(`Merge failed: ${String(err?.message ?? err)}`)
    } finally {
      setDupBusy(null)
    }
  }

  async function runTagging(dryRun: boolean) {
    setTagBusy(dryRun ? 'preview' : 'apply')
    try {
      const res = await fetch('/api/leads/tag', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun, limit: 20, onlyUntagged: true }),
      })
      const json = await res.json()
      setTagResult(json)
      if (!dryRun && json.ok) loadLeads()
    } catch (err: any) {
      setTagResult({ ok: false, error: String(err?.message ?? err) })
    } finally {
      setTagBusy(null)
    }
  }

  // From the Supabase `next_best_actions` view (intelligence_backend migration).
  // Resolves empty if the view isn't present yet — no error surfaced.
  const loadNextActions = useCallback(async () => {
    const { data } = await supabase.from('next_best_actions').select('*').limit(8)
    setNextActions((data ?? []) as Lead[])
  }, [])

  // v4 intelligence views — follow-up SLAs + sustained risers. Resolve empty
  // if the v4 migration / score history isn't present yet.
  const loadFollowups = useCallback(async () => {
    const { data } = await supabase.from('lead_followups').select('*').limit(8)
    setFollowups(data ?? [])
  }, [])

  const loadHeating = useCallback(async () => {
    const { data } = await supabase.from('lead_heating_up').select('*').limit(8)
    setHeating(data ?? [])
  }, [])

  const loadRuns = useCallback(async () => {
    const { data } = await supabase
      .from('enrichment_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(8)
    setRuns((data ?? []) as EnrichmentRun[])
  }, [])

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/enrich/status', { cache: 'no-store' })
      const json = await res.json()
      setCaps(json.capabilities ?? null)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    Promise.all([
      loadLeads(),
      loadRuns(),
      loadStatus(),
      loadNextActions(),
      loadDupes(),
      loadFollowups(),
      loadHeating(),
    ]).then(() => setLoading(false))

    // Best-effort realtime so the board updates as the engine writes back.
    let channel: ReturnType<typeof supabase.channel> | null = null
    try {
      const onLeads = () => {
        loadLeads()
        loadNextActions()
        loadFollowups()
        loadHeating()
      }
      channel = supabase
        .channel('automation')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'leads' }, onLeads)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'enrichment_runs' }, loadRuns)
        .subscribe()
    } catch {
      /* realtime not enabled — manual refresh still works */
    }
    return () => {
      if (channel) supabase.removeChannel(channel)
    }
  }, [loadLeads, loadRuns, loadStatus, loadNextActions, loadDupes, loadFollowups, loadHeating])

  async function runNow() {
    setRunning(true)
    setMessage(null)
    try {
      const res = await fetch('/api/enrich/run?limit=' + (caps?.batchSize ?? 6), {
        method: 'POST',
      })
      const json = await res.json()
      if (!res.ok || json.ok === false) {
        setMessage(`Run failed: ${json.error ?? res.statusText}`)
      } else {
        setMessage(
          `Processed ${json.leadsProcessed} lead(s) · ${json.leadsEnriched} updated · ` +
            `${json.aiCalls} AI call(s) · ${(json.durationMs / 1000).toFixed(1)}s`
        )
      }
      await Promise.all([loadLeads(), loadRuns(), loadNextActions(), loadDupes(), loadFollowups(), loadHeating()])
    } catch (err: any) {
      setMessage(`Run failed: ${String(err?.message ?? err)}`)
    } finally {
      setRunning(false)
    }
  }

  const stats = useMemo(() => deriveStats(leads), [leads])

  if (loading) {
    return (
      <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
        <div className="h-7 w-64 skeleton" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 skeleton" />
          ))}
        </div>
        <div className="h-64 skeleton" />
      </div>
    )
  }

  return (
    <div className="p-6 md:p-8 space-y-6 max-w-7xl mx-auto animate-fade">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Lead Intelligence Automation
          </h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Algorithmic prioritization + AI analysis, momentum &amp; auto-sync
          </p>
        </div>
        <button
          onClick={runNow}
          disabled={running}
          className="tap inline-flex items-center justify-center text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-4 py-2
                     transition-colors disabled:opacity-60 disabled:cursor-not-allowed shadow-card"
        >
          {running ? 'Researching…' : '⚡ Run automation now'}
        </button>
      </div>

      {message && (
        <div className="text-sm rounded-lg border border-brand-200 bg-brand-50 text-brand-800 px-4 py-2.5">
          {message}
        </div>
      )}

      {/* Engine health */}
      <EngineHealth caps={caps} />

      {/* EFB satellite risk engine */}
      <EfbAutomationPanel />

      {/* Coverage KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="Leads Tracked" value={stats.total} sub="in database" color="blue" />
        <KPI
          label="Enriched"
          value={`${stats.enriched}`}
          sub={`${pct(stats.enriched, stats.total)}% coverage`}
          color="green"
        />
        <KPI
          label="Avg Data Completeness"
          value={stats.avgCompleteness != null ? `${stats.avgCompleteness}%` : '—'}
          sub="of key fields"
          color="purple"
        />
        <KPI
          label="Avg Research Confidence"
          value={stats.avgConfidence != null ? `${stats.avgConfidence}%` : '—'}
          sub="AI-verified leads"
          color="orange"
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Priority distribution */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">
            Priority Distribution
          </h2>
          <div className="space-y-3">
            {(['P1', 'P2', 'P3', 'P4'] as PriorityTier[]).map(tier => {
              const count = stats.tiers[tier] ?? 0
              const p = pct(count, stats.scored || 1)
              return (
                <div key={tier}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600">{TIER_META[tier].label}</span>
                    <span className="text-slate-900 font-medium">{count}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full ${TIER_META[tier].bar}`}
                      style={{ width: `${p}%` }}
                    />
                  </div>
                </div>
              )
            })}
            {stats.scored === 0 && (
              <p className="text-xs text-slate-400">
                No leads scored yet — run the automation to prioritize.
              </p>
            )}
          </div>
        </div>

        {/* Enrichment status mix */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">
            Enrichment Status
          </h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.statusCounts).map(([status, count]) => (
              <span
                key={status}
                className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                  STATUS_META[status] ?? 'bg-slate-100 text-slate-500'
                }`}
              >
                {status.replace(/_/g, ' ')}: {count}
              </span>
            ))}
            {Object.keys(stats.statusCounts).length === 0 && (
              <p className="text-xs text-slate-400">
                Not enriched yet — the queue will populate on the first run.
              </p>
            )}
          </div>
          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">
              Needs attention
            </div>
            <p className="text-sm text-slate-600">
              <span className="font-bold text-slate-800">{stats.needsWork}</span>{' '}
              lead(s) pending, stale, failed, or never researched.
            </p>
          </div>
        </div>
      </div>

      {/* Top priority leads */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">
          Top Priority Leads (live)
        </h2>
        {stats.top.length === 0 ? (
          <p className="text-sm text-slate-400">No prioritized leads yet.</p>
        ) : (
          <div className="space-y-2">
            {stats.top.map(lead => (
              <div
                key={lead.id}
                className="flex items-center justify-between gap-3 py-2 border-b border-slate-50 last:border-0"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">
                    {lead.business_name ?? lead.owner_name ?? 'Unknown'}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {[lead.city, lead.primary_crop].filter(Boolean).join(' · ') || '—'}
                    {lead.recommended_approach && (
                      <span className="text-slate-400"> — {lead.recommended_approach}</span>
                    )}
                  </div>
                  {lead.next_best_action && (
                    <div className="text-xs text-brand-600 truncate mt-0.5">
                      → {lead.next_best_action}
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <TrendBadge trend={lead.priority_trend} delta={lead.priority_delta} />
                  {lead.priority_tier && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                        TIER_META[lead.priority_tier as PriorityTier]?.cls ?? ''
                      }`}
                    >
                      {lead.priority_tier}
                    </span>
                  )}
                  <span className="text-sm font-bold text-slate-700 w-8 text-right">
                    {lead.priority_score ?? '—'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Priority Movers — momentum since the last scoring run */}
      {stats.movers.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <h2 className="text-sm font-semibold text-slate-700">Priority Movers</h2>
            {stats.risenP1 > 0 && (
              <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-red-50 text-red-700 border border-red-200">
                📈 {stats.risenP1} risen into P1
              </span>
            )}
          </div>
          <p className="text-xs text-slate-400 mb-4">
            Biggest score changes vs. the previous run — what got hotter or cooled off
          </p>
          <div className="space-y-2">
            {stats.movers.map(lead => (
              <div
                key={lead.id}
                className="flex items-center justify-between gap-3 py-2 border-b border-slate-50 last:border-0"
              >
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">
                    {lead.business_name ?? lead.owner_name ?? 'Unknown'}
                  </div>
                  <div className="text-xs text-slate-500 truncate">
                    {[lead.city, lead.primary_crop].filter(Boolean).join(' · ') || '—'}
                    {lead.priority_score_prev != null && (
                      <span className="text-slate-400">
                        {' '}· {lead.priority_score_prev} → {lead.priority_score}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <TrendBadge trend={lead.priority_trend} delta={lead.priority_delta} />
                  {lead.priority_tier && (
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                        TIER_META[lead.priority_tier as PriorityTier]?.cls ?? ''
                      }`}
                    >
                      {lead.priority_tier}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Follow-ups due + Heating up — v4 intelligence views */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
          <h2 className="text-sm font-semibold text-slate-700 mb-1">⏰ Follow-ups Due</h2>
          <p className="text-xs text-slate-400 mb-4">
            Engaged leads stalled past their stage SLA — re-engage before they go cold
          </p>
          {followups.length === 0 ? (
            <p className="text-sm text-slate-400">Nothing overdue. 👍</p>
          ) : (
            <div className="space-y-2">
              {followups.map(f => (
                <div key={f.id} className="py-2 border-b border-slate-50 last:border-0">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800 truncate">
                      {f.business_name ?? f.owner_name ?? 'Unknown'}
                    </span>
                    <span className="shrink-0 text-xs px-2 py-0.5 rounded-full font-medium bg-amber-50 text-amber-700 border border-amber-200">
                      {f.days_in_stage}d in {String(f.loi_status ?? '').replace(/_/g, ' ')}
                    </span>
                  </div>
                  {f.next_best_action && (
                    <p className="text-xs text-brand-600 mt-0.5 line-clamp-1">→ {f.next_best_action}</p>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
          <h2 className="text-sm font-semibold text-slate-700 mb-1">🔥 Heating Up</h2>
          <p className="text-xs text-slate-400 mb-4">
            Leads whose priority rose across the last 3 scoring runs — sustained momentum
          </p>
          {heating.length === 0 ? (
            <p className="text-sm text-slate-400">No sustained risers yet (needs 3+ runs of history).</p>
          ) : (
            <div className="space-y-2">
              {heating.map(h => (
                <div
                  key={h.id}
                  className="flex items-center justify-between gap-3 py-2 border-b border-slate-50 last:border-0"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-slate-800 truncate">
                      {h.business_name ?? h.owner_name ?? 'Unknown'}
                    </div>
                    <div className="text-xs text-slate-500 truncate">
                      {[h.city, h.primary_crop].filter(Boolean).join(' · ') || '—'}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs font-medium text-green-600 tabular-nums">▲ +{h.rise_3}</span>
                    {h.priority_tier && (
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium border ${
                          TIER_META[h.priority_tier as PriorityTier]?.cls ?? ''
                        }`}
                      >
                        {h.priority_tier}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Next best actions — from the Supabase intelligence view */}
      {nextActions.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
          <h2 className="text-sm font-semibold text-slate-700 mb-1">Next Best Actions</h2>
          <p className="text-xs text-slate-400 mb-4">
            Outreach-ready leads, prioritized server-side — who to call next
          </p>
          <div className="space-y-2">
            {nextActions.map(l => (
              <div
                key={l.id}
                className="py-3 border-b border-slate-50 last:border-0"
              >
                <div className="flex items-start justify-between gap-2">
                  <span className="text-sm font-medium text-slate-800 truncate">
                    {l.business_name ?? l.owner_name ?? 'Unknown'}
                  </span>
                  {l.priority_tier && (
                    <span
                      className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium border ${
                        TIER_META[l.priority_tier as PriorityTier]?.cls ?? ''
                      }`}
                    >
                      {l.priority_tier}
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {[l.city, l.primary_crop].filter(Boolean).join(' · ') || '—'}
                </div>
                {l.recommended_approach && (
                  <p className="text-xs text-slate-600 mt-1 line-clamp-2">
                    {l.recommended_approach}
                  </p>
                )}
                {l.next_best_action && (
                  <p className="text-xs text-brand-600 mt-1 line-clamp-1">
                    → {l.next_best_action}
                  </p>
                )}
                {l.best_contact_method && (
                  <p className="text-xs text-slate-400 mt-1 line-clamp-1">
                    📞 {l.best_contact_method}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Duplicate leads — detection + non-destructive assisted merge */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
          <h2 className="text-sm font-semibold text-slate-700">Duplicate Leads</h2>
          <span className="text-xs text-slate-400">
            {dupes.length} cluster(s) ·{' '}
            {dupes.reduce((n, c) => n + (c.members.length - 1), 0)} duplicate(s)
          </span>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Matched on phone / email / name + city. Merge backfills the strongest record and
          tags the rest <span className="font-medium">duplicate</span> — it never deletes.
        </p>

        {dupMsg && (
          <div className="text-xs rounded-lg border border-brand-200 bg-brand-50 text-brand-800 px-3 py-2 mb-3">
            {dupMsg}
          </div>
        )}

        {dupes.length === 0 ? (
          <p className="text-sm text-slate-400">No duplicates detected. 🎉</p>
        ) : (
          <div className="space-y-3">
            {dupes.slice(0, 6).map((cluster, i) => (
              <div key={i} className="border border-slate-100 rounded-lg p-3">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <span className="flex flex-wrap gap-1">
                    {cluster.reasons.map(r => (
                      <span
                        key={r}
                        className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100"
                      >
                        {r}
                      </span>
                    ))}
                  </span>
                  <button
                    onClick={() => mergeCluster(cluster)}
                    disabled={dupBusy !== null}
                    className="tap text-xs border border-slate-200 hover:border-slate-400 text-slate-700 rounded-lg px-3 py-1 font-medium transition-colors disabled:opacity-60"
                  >
                    {dupBusy ? 'Merging…' : 'Merge'}
                  </button>
                </div>
                <div className="space-y-1">
                  {cluster.members.map(m => (
                    <div key={m.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-700 truncate">
                        {m.business_name ?? m.owner_name ?? 'Unknown'}
                        <span className="text-slate-400">
                          {' '}· {[m.city, m.phone, m.email].filter(Boolean).join(' · ') || '—'}
                        </span>
                      </span>
                      <span className="text-slate-400 shrink-0 tabular-nums">
                        {m.priority_score ?? '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* AI lead tagging (Groq/OpenRouter/Claude) */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
          <h2 className="text-sm font-semibold text-slate-700">AI Lead Tagging</h2>
          <span className="text-xs text-slate-400">
            {leads.filter(l => !l.tags || l.tags.length === 0).length} untagged
          </span>
        </div>
        <p className="text-xs text-slate-400 mb-4">
          Adds normalized crop/fit tags (additive — never overwrites existing data), 20 leads per pass.
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => runTagging(true)}
            disabled={tagBusy !== null}
            className="tap inline-flex items-center justify-center text-sm border border-slate-200 hover:border-slate-400 text-slate-700 rounded-lg px-4 py-2 font-medium transition-colors disabled:opacity-60"
          >
            {tagBusy === 'preview' ? 'Previewing…' : 'Preview (dry run)'}
          </button>
          <button
            onClick={() => runTagging(false)}
            disabled={tagBusy !== null}
            className="tap inline-flex items-center justify-center text-sm bg-brand-500 hover:bg-brand-600 text-white rounded-lg px-4 py-2 font-medium transition-colors disabled:opacity-60 shadow-card"
          >
            {tagBusy === 'apply' ? 'Tagging…' : 'Tag next 20'}
          </button>
        </div>

        {tagResult && (
          <div className="mt-4">
            {tagResult.ok === false ? (
              <p className="text-xs text-red-600">{tagResult.error}</p>
            ) : (
              <>
                <p className="text-xs text-slate-500 mb-2">
                  {tagResult.dryRun ? 'Preview' : 'Applied'} · {tagResult.tagged}/{tagResult.processed} tagged
                  {tagResult.note ? ` · ${tagResult.note}` : ''}
                </p>
                <div className="space-y-1.5 max-h-56 overflow-y-auto">
                  {(tagResult.results ?? []).map((r: any) => (
                    <div key={r.id} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-slate-700 truncate">{r.name}</span>
                      <span className="flex flex-wrap gap-1 shrink-0 justify-end">
                        {r.tags.map((t: string) => (
                          <span key={t} className="px-1.5 py-0.5 rounded-full bg-brand-50 text-brand-700 border border-brand-100">
                            {t}
                          </span>
                        ))}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Run history */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">
          Automation Run History
        </h2>
        {runs.length === 0 ? (
          <p className="text-sm text-slate-400">
            No runs recorded yet. Click “Run automation now” or wait for the next
            scheduled cycle.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                  <th className="pb-2 font-medium">Started</th>
                  <th className="pb-2 font-medium">Trigger</th>
                  <th className="pb-2 font-medium">Status</th>
                  <th className="pb-2 font-medium text-right">Processed</th>
                  <th className="pb-2 font-medium text-right">Updated</th>
                  <th className="pb-2 font-medium text-right">AI calls</th>
                  <th className="pb-2 font-medium text-right">Tokens</th>
                  <th className="pb-2 font-medium text-right">Duration</th>
                </tr>
              </thead>
              <tbody>
                {runs.map(run => (
                  <tr key={run.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2 text-slate-600 whitespace-nowrap">
                      {new Date(run.started_at).toLocaleString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })}
                    </td>
                    <td className="py-2 text-slate-500">{run.trigger ?? '—'}</td>
                    <td className="py-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                          run.status === 'completed'
                            ? 'bg-green-100 text-green-700'
                            : run.status === 'running'
                            ? 'bg-blue-100 text-blue-700'
                            : 'bg-red-100 text-red-600'
                        }`}
                      >
                        {run.status}
                      </span>
                    </td>
                    <td className="py-2 text-right text-slate-600">{run.leads_processed}</td>
                    <td className="py-2 text-right text-slate-600">{run.leads_enriched}</td>
                    <td className="py-2 text-right text-slate-600">{run.ai_calls}</td>
                    <td className="py-2 text-right text-slate-500">
                      {run.ai_tokens != null && run.ai_tokens > 0
                        ? run.ai_tokens.toLocaleString()
                        : '—'}
                    </td>
                    <td className="py-2 text-right text-slate-500">
                      {run.duration_ms != null
                        ? `${(run.duration_ms / 1000).toFixed(1)}s`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

// ── helpers ────────────────────────────────────────────────────────────────
function deriveStats(leads: Lead[]) {
  const total = leads.length
  const scoredLeads = leads.filter(l => l.priority_score != null)
  const enriched = leads.filter(l => l.enrichment_status === 'enriched').length

  const tiers = scoredLeads.reduce((acc, l) => {
    const t = (l.priority_tier ?? 'P4') as PriorityTier
    acc[t] = (acc[t] ?? 0) + 1
    return acc
  }, {} as Record<PriorityTier, number>)

  const statusCounts = leads.reduce((acc, l) => {
    if (!l.enrichment_status) return acc
    acc[l.enrichment_status] = (acc[l.enrichment_status] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)

  const completes = leads
    .map(l => l.data_completeness)
    .filter((n): n is number => n != null)
  const avgCompleteness = completes.length
    ? Math.round(completes.reduce((s, n) => s + n, 0) / completes.length)
    : null

  const confs = leads
    .map(l => l.enrichment_confidence)
    .filter((n): n is number => n != null)
  const avgConfidence = confs.length
    ? Math.round((confs.reduce((s, n) => s + n, 0) / confs.length) * 100)
    : null

  const needsWork = leads.filter(
    l =>
      !l.enrichment_status ||
      ['pending', 'stale', 'failed'].includes(l.enrichment_status)
  ).length

  const top = [...scoredLeads]
    .sort((a, b) => (b.priority_score ?? 0) - (a.priority_score ?? 0))
    .slice(0, 8)

  // Priority momentum — biggest movers (gainers + decliners) since last run.
  const movers = leads
    .filter(l => l.priority_delta != null && l.priority_delta !== 0)
    .sort((a, b) => Math.abs(b.priority_delta ?? 0) - Math.abs(a.priority_delta ?? 0))
    .slice(0, 6)
  const risenP1 = leads.filter(
    l => l.priority_tier === 'P1' && (l.priority_trend === 'up' || l.priority_trend === 'new')
  ).length

  return {
    total,
    scored: scoredLeads.length,
    enriched,
    tiers,
    statusCounts,
    avgCompleteness,
    avgConfidence,
    needsWork,
    top,
    movers,
    risenP1,
  }
}

function pct(n: number, total: number): number {
  if (!total) return 0
  return Math.round((n / total) * 100)
}

function EngineHealth({ caps }: { caps: Capabilities | null }) {
  if (!caps) return null
  const items: { label: string; ok: boolean; detail: string }[] = [
    {
      label: 'AI Analysis',
      ok: caps.aiEnabled,
      detail: caps.aiEnabled ? caps.modelVersion : 'set a Groq / OpenRouter / Anthropic key',
    },
    {
      label: 'Database Writes',
      ok: caps.writeMode !== 'none',
      detail: caps.writeMode,
    },
    {
      label: 'Apollo Contacts',
      ok: caps.apolloEnabled,
      detail: caps.apolloEnabled ? 'enabled' : 'optional',
    },
    {
      label: 'Schedule',
      ok: true,
      detail: `daily · batch ${caps.batchSize}${caps.retries != null ? ` · ${caps.retries} retries` : ''}`,
    },
  ]
  return (
    <div className="bg-slate-800 text-white rounded-xl px-5 py-3 flex flex-wrap gap-x-8 gap-y-2 text-sm">
      {items.map(i => (
        <div key={i.label} className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${i.ok ? 'bg-green-400' : 'bg-slate-500'}`}
          />
          <span className="text-slate-300">{i.label}:</span>
          <span className="font-medium">{i.detail}</span>
        </div>
      ))}
    </div>
  )
}

function KPI({
  label,
  value,
  sub,
  color,
}: {
  label: string
  value: string | number
  sub: string
  color: string
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    orange: 'bg-orange-50 text-orange-700',
    purple: 'bg-purple-50 text-purple-700',
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
      <div
        className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full mb-3 ${colorMap[color]}`}
      >
        {label}
      </div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{sub}</div>
    </div>
  )
}
