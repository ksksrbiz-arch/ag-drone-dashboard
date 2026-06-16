'use client'

import { useEffect, useMemo, useState } from 'react'
import { AskAce } from '@/components/AskAce'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { supabase, type Job, type Lead, type LOIStatus } from '@/lib/supabase'

// Probability a lead converts, by pipeline stage — drives the weighted forecast.
const STAGE_PROBABILITY: Record<LOIStatus, number> = {
  not_contacted: 0.05,
  contacted: 0.2,
  meeting_scheduled: 0.4,
  loi_sent: 0.65,
  loi_signed: 0.95,
  declined: 0,
}

const STAGE_LABEL: Record<LOIStatus, string> = {
  not_contacted: 'Not contacted',
  contacted: 'Contacted',
  meeting_scheduled: 'Meeting scheduled',
  loi_sent: 'LOI sent',
  loi_signed: 'LOI signed',
  declined: 'Declined',
}

const money = (n: number) => `$${Math.round(n).toLocaleString()}`

export default function FinancePage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    Promise.all([
      supabase.from('jobs').select('*'),
      supabase.from('leads').select('*'),
    ]).then(([j, l]) => {
      setJobs((j.data ?? []) as Job[])
      setLeads((l.data ?? []) as Lead[])
      setLoading(false)
    })
  }, [])

  const kpis = useMemo(() => {
    const collected = jobs.reduce((s, j) => s + (j.paid_amount ?? 0), 0)
    const invoiced = jobs.reduce((s, j) => s + (j.invoice_amount ?? 0), 0)
    const outstanding = jobs
      .filter(j => j.status === 'invoiced')
      .reduce((s, j) => s + ((j.invoice_amount ?? 0) - (j.paid_amount ?? 0)), 0)
    const quoted = jobs
      .filter(j => j.status === 'quoted')
      .reduce((s, j) => s + (j.quote_amount ?? 0), 0)
    return { collected, invoiced, outstanding, quoted }
  }, [jobs])

  // Weighted pipeline forecast from enriched leads.
  const forecast = useMemo(() => {
    const byStage = {} as Record<LOIStatus, { count: number; raw: number; weighted: number }>
    for (const l of leads) {
      const stage = l.loi_status
      const p = STAGE_PROBABILITY[stage] ?? 0
      const rev = l.est_annual_revenue ?? 0
      if (!byStage[stage]) byStage[stage] = { count: 0, raw: 0, weighted: 0 }
      byStage[stage].count += 1
      byStage[stage].raw += rev
      byStage[stage].weighted += rev * p
    }
    const totalWeighted = Object.values(byStage).reduce((s, v) => s + v.weighted, 0)
    return { byStage, totalWeighted }
  }, [leads])

  // Monthly invoiced vs collected.
  const monthly = useMemo(() => {
    const map = new Map<string, { month: string; invoiced: number; paid: number }>()
    for (const j of jobs) {
      const when = j.completed_date ?? j.scheduled_date ?? j.created_at
      if (!when) continue
      const d = new Date(when)
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      const label = d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' })
      const row = map.get(key) ?? { month: label, invoiced: 0, paid: 0 }
      row.invoiced += j.invoice_amount ?? 0
      row.paid += j.paid_amount ?? 0
      map.set(key, row)
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-8)
      .map(([, v]) => v)
  }, [jobs])

  // A/R aging — outstanding invoices bucketed by age.
  const ar = useMemo(() => {
    const open = jobs
      .filter(j => j.status === 'invoiced' && (j.invoice_amount ?? 0) - (j.paid_amount ?? 0) > 0)
      .map(j => {
        const age = Math.max(
          0,
          Math.floor((Date.now() - new Date(j.updated_at).getTime()) / 86400000)
        )
        return { job: j, outstanding: (j.invoice_amount ?? 0) - (j.paid_amount ?? 0), age }
      })
      .sort((a, b) => b.age - a.age)
    const buckets = { '0-30': 0, '31-60': 0, '61-90': 0, '90+': 0 }
    for (const r of open) {
      if (r.age <= 30) buckets['0-30'] += r.outstanding
      else if (r.age <= 60) buckets['31-60'] += r.outstanding
      else if (r.age <= 90) buckets['61-90'] += r.outstanding
      else buckets['90+'] += r.outstanding
    }
    return { open, buckets }
  }, [jobs])

  if (loading) {
    return (
      <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto space-y-6">
        <div className="h-7 w-48 skeleton" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 skeleton" />)}
        </div>
        <div className="h-72 skeleton" />
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-7xl mx-auto animate-fade space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Financial Intelligence</h1>
          <p className="text-slate-500 text-sm mt-0.5">Revenue, receivables & weighted pipeline forecast</p>
        </div>
        <AskAce
          label="Ask Ace"
          query="Give me a financial snapshot — collected vs outstanding A/R, this month's revenue trend, the oldest overdue invoices, and what needs attention."
        />
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPI label="Collected" value={money(kpis.collected)} sub="paid to date" color="green" />
        <KPI label="Invoiced" value={money(kpis.invoiced)} sub="total billed" color="purple" />
        <KPI label="Outstanding A/R" value={money(kpis.outstanding)} sub="awaiting payment" color="orange" />
        <KPI label="Open Quotes" value={money(kpis.quoted)} sub="not yet won" color="blue" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly revenue */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Monthly Revenue</h2>
          {monthly.length === 0 ? (
            <p className="text-sm text-slate-400">No dated jobs to chart yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={monthly} margin={{ top: 4, right: 8, left: -12, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: '#64748b' }} axisLine={false} tickLine={false} tickFormatter={v => `$${v / 1000}k`} />
                <Tooltip formatter={(v: number) => money(v)} cursor={{ fill: '#f8fafc' }} />
                <Bar dataKey="invoiced" name="Invoiced" fill="#c4b5fd" radius={[3, 3, 0, 0]} />
                <Bar dataKey="paid" name="Collected" fill="#22c55e" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Pipeline forecast */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
          <div className="flex items-baseline justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-700">Weighted Pipeline Forecast</h2>
            <span className="text-lg font-bold text-brand-700">{money(forecast.totalWeighted)}/yr</span>
          </div>
          <div className="space-y-2">
            {(Object.keys(STAGE_PROBABILITY) as LOIStatus[])
              .filter(s => forecast.byStage[s]?.count)
              .map(stage => {
                const v = forecast.byStage[stage]
                return (
                  <div key={stage} className="flex items-center justify-between text-sm">
                    <span className="text-slate-600">
                      {STAGE_LABEL[stage]}
                      <span className="text-slate-400 text-xs"> · {v.count} · {Math.round(STAGE_PROBABILITY[stage] * 100)}%</span>
                    </span>
                    <span className="text-slate-800 font-medium">{money(v.weighted)}</span>
                  </div>
                )
              })}
            {forecast.totalWeighted === 0 && (
              <p className="text-sm text-slate-400">
                Add estimated revenue to leads to project the pipeline.
              </p>
            )}
          </div>
        </div>
      </div>

      {/* A/R aging */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Accounts Receivable Aging</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-5">
          {(['0-30', '31-60', '61-90', '90+'] as const).map(b => (
            <div key={b} className="rounded-lg border border-slate-200 p-3">
              <div className="text-xs text-slate-500">{b} days</div>
              <div className={`text-lg font-bold ${b === '90+' && ar.buckets[b] > 0 ? 'text-red-600' : 'text-slate-800'}`}>
                {money(ar.buckets[b])}
              </div>
            </div>
          ))}
        </div>
        {ar.open.length === 0 ? (
          <p className="text-sm text-slate-400">No outstanding invoices. 🎉</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                  <th className="pb-2 font-medium">Job</th>
                  <th className="pb-2 font-medium">Location</th>
                  <th className="pb-2 font-medium text-right">Outstanding</th>
                  <th className="pb-2 font-medium text-right">Age</th>
                </tr>
              </thead>
              <tbody>
                {ar.open.map(r => (
                  <tr key={r.job.id} className="border-b border-slate-50 last:border-0">
                    <td className="py-2 text-slate-800 font-medium">{r.job.job_title ?? '—'}</td>
                    <td className="py-2 text-slate-500">{r.job.city ?? '—'}</td>
                    <td className="py-2 text-right text-slate-800">{money(r.outstanding)}</td>
                    <td className={`py-2 text-right ${r.age > 90 ? 'text-red-600 font-medium' : 'text-slate-500'}`}>
                      {r.age}d
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

function KPI({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700',
    green: 'bg-green-50 text-green-700',
    orange: 'bg-orange-50 text-orange-700',
    purple: 'bg-purple-50 text-purple-700',
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
      <div className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full mb-3 ${colorMap[color]}`}>
        {label}
      </div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{sub}</div>
    </div>
  )
}
