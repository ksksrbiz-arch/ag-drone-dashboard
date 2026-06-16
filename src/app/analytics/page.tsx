'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

interface Analytics {
  generatedAt: string
  totals: {
    leads: number
    enriched: number
    enrichedPct: number
    avgPriority: number | null
    signed: number
    declined: number
    customers: number
    paidRevenue: number
    outstandingAR: number
    paidJobs: number
    runs: number
    aiTokensTotal: number
    aiCallsTotal: number
  }
  tiers: Record<string, number>
  funnel: { stage: string; label: string; count: number; pct: number }[]
  runs: { date: string; leadsProcessed: number; leadsEnriched: number; aiCalls: number; aiTokens: number; durationMs: number }[]
  topCrops: { crop: string; count: number; avgPriority: number | null }[]
  jobsByStatus: Record<string, number>
  conversion: { contactedOrBeyond: number; signed: number; signRatePct: number; paidJobs: number }
}

const TIER_BAR: Record<string, string> = {
  P1: 'bg-red-500',
  P2: 'bg-orange-400',
  P3: 'bg-yellow-400',
  P4: 'bg-slate-400',
}

export default function AnalyticsPage() {
  const [data, setData] = useState<Analytics | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/analytics', { cache: 'no-store' })
      const json = await res.json()
      if (json.ok) setData(json as Analytics)
    } catch {
      /* best-effort */
    }
  }, [])

  useEffect(() => {
    load().then(() => setLoading(false))
  }, [load])

  if (loading) {
    return (
      <div className="p-4 sm:p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
        <div className="h-7 w-48 skeleton" />
        <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-24 skeleton" />)}
        </div>
        <div className="h-64 skeleton" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900">Analytics</h1>
        <p className="text-sm text-slate-500 mt-2">No analytics available yet.</p>
      </div>
    )
  }

  const t = data.totals
  const runChart = data.runs.map(r => ({
    ...r,
    label: new Date(r.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  }))
  const maxFunnel = Math.max(1, ...data.funnel.map(f => f.count))
  const scoredTotal = Object.values(data.tiers).reduce((s, n) => s + n, 0) || 1

  return (
    <div className="p-4 sm:p-6 md:p-8 space-y-6 max-w-7xl mx-auto animate-fade">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Analytics</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Engine performance, pipeline conversion, and where the value is
          </p>
        </div>
        <button
          onClick={() => { setLoading(true); load().then(() => setLoading(false)) }}
          className="tap text-sm border border-slate-200 hover:border-slate-400 text-slate-700 rounded-lg px-4 py-2 font-medium transition-colors"
        >
          ↻ Refresh
        </button>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-6 gap-4">
        <KPI label="Leads" value={t.leads} color="blue" />
        <KPI label="Enriched" value={`${t.enrichedPct}%`} sub={`${t.enriched}/${t.leads}`} color="green" />
        <KPI label="Avg priority" value={t.avgPriority ?? '—'} color="purple" />
        <KPI label="LOIs signed" value={t.signed} sub={`${data.conversion.signRatePct}% of leads`} color="orange" />
        <KPI label="Paid revenue" value={`$${t.paidRevenue.toLocaleString()}`} sub={`${t.paidJobs} jobs`} color="green" />
        <KPI label="AI tokens" value={fmtCompact(t.aiTokensTotal)} sub={`${t.runs} runs`} color="slate" />
      </div>

      {/* Engine performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Throughput per run" hint="Leads processed vs. enriched">
          {runChart.length === 0 ? (
            <Empty msg="No runs yet." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={runChart} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                <Bar dataKey="leadsProcessed" name="Processed" fill="#cbd5e1" radius={[3, 3, 0, 0]} />
                <Bar dataKey="leadsEnriched" name="Enriched" fill="#22c55e" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="AI cost per run" hint="Tokens consumed (proxy for spend)">
          {runChart.length === 0 ? (
            <Empty msg="No runs yet." />
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <BarChart data={runChart} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e2e8f0' }} />
                <Bar dataKey="aiTokens" name="Tokens" fill="#6366f1" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Pipeline funnel */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
        <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
          <h2 className="text-sm font-semibold text-slate-700">Pipeline Funnel</h2>
          <span className="text-xs text-slate-400">
            {data.conversion.signRatePct}% sign rate · {t.declined} declined
          </span>
        </div>
        <div className="space-y-3">
          {data.funnel.map(f => (
            <div key={f.stage}>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-600">{f.label}</span>
                <span className="text-slate-900 font-medium">
                  {f.count} <span className="text-slate-400 font-normal">· {f.pct}%</span>
                </span>
              </div>
              <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.round((f.count / maxFunnel) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Tier distribution + top crops */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Priority Distribution</h2>
          <div className="space-y-3">
            {(['P1', 'P2', 'P3', 'P4'] as const).map(tier => {
              const count = data.tiers[tier] ?? 0
              return (
                <div key={tier}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600">{tier}</span>
                    <span className="text-slate-900 font-medium">{count}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full ${TIER_BAR[tier]}`} style={{ width: `${Math.round((count / scoredTotal) * 100)}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Top Crops</h2>
          {data.topCrops.length === 0 ? (
            <Empty msg="No crop data yet." />
          ) : (
            <div className="space-y-2">
              {data.topCrops.map(c => (
                <div key={c.crop} className="flex items-center justify-between text-sm py-1 border-b border-slate-50 last:border-0">
                  <span className="text-slate-700 truncate">{c.crop}</span>
                  <span className="flex items-center gap-3 shrink-0">
                    <span className="text-slate-400 text-xs">avg {c.avgPriority ?? '—'}</span>
                    <span className="text-slate-900 font-medium w-8 text-right">{c.count}</span>
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Jobs by status */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
        <h2 className="text-sm font-semibold text-slate-700 mb-1">Jobs by Status</h2>
        <p className="text-xs text-slate-400 mb-4">
          ${t.outstandingAR.toLocaleString()} outstanding A/R · {t.customers} customers
        </p>
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.jobsByStatus).length === 0 ? (
            <Empty msg="No jobs yet." />
          ) : (
            Object.entries(data.jobsByStatus).map(([status, count]) => (
              <span key={status} className="text-xs px-2.5 py-1 rounded-full font-medium bg-slate-100 text-slate-600">
                {status.replace(/_/g, ' ')}: {count}
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  )
}

function fmtCompact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`
  return String(n)
}

function Empty({ msg }: { msg: string }) {
  return <p className="text-sm text-slate-400">{msg}</p>
}

function ChartCard({ title, hint, children }: { title: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
      <h2 className="text-sm font-semibold text-slate-700">{title}</h2>
      <p className="text-xs text-slate-400 mb-4">{hint}</p>
      {children}
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
  sub?: string
  color: string
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    orange: 'bg-orange-50 text-orange-700',
    purple: 'bg-purple-50 text-purple-700',
    slate: 'bg-slate-100 text-slate-600',
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-card">
      <div className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full mb-2 ${colorMap[color]}`}>{label}</div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      {sub && <div className="text-xs text-slate-500 mt-1">{sub}</div>}
    </div>
  )
}
