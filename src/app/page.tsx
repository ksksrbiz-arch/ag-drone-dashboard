'use client'

import { useEffect, useState } from 'react'
import { supabase, type Lead, type Job } from '@/lib/supabase'

interface KPIs {
  totalLeads: number
  loiSigned: number
  activeJobs: number
  paidRevenue: number
  treatNow: number
  scoutNow: number
  contactNow: number
  avgEfbRisk: number | null
  leadsByVertical: Record<string, number>
  recentJobs: Job[]
  topLeads: Lead[]
}

const VERTICAL_LABELS: Record<string, string> = {
  ag_spray: '🌾 Ag Spray',
  insurance: '🏠 Insurance',
  real_estate: '🏡 Real Estate',
  construction: '🏗️ Construction',
}

const ACTION_COLORS: Record<string, string> = {
  TREAT_NOW:   'bg-red-100 text-red-700 border border-red-200',
  SCOUT_NOW:   'bg-orange-100 text-orange-700 border border-orange-200',
  CONTACT_NOW: 'bg-yellow-100 text-yellow-700 border border-yellow-200',
  MONITOR:     'bg-green-100 text-green-700 border border-green-200',
}

export default function OverviewPage() {
  const [kpis, setKpis] = useState<KPIs | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      const [leadsRes, jobsRes] = await Promise.all([
        supabase.from('leads').select('*'),
        supabase.from('jobs').select('*').order('created_at', { ascending: false }).limit(10),
      ])

      const leads: Lead[] = leadsRes.data ?? []
      const jobs: Job[] = jobsRes.data ?? []

      const paidRevenue = jobs
        .filter(j => j.status === 'paid')
        .reduce((sum, j) => sum + (j.paid_amount ?? 0), 0)

      const byVertical: Record<string, number> = {}
      leads.forEach(l => {
        byVertical[l.vertical] = (byVertical[l.vertical] ?? 0) + 1
      })

      const efbLeads = leads.filter(l => l.composite_efb_risk !== null)
      const avgEfbRisk = efbLeads.length
        ? Math.round(efbLeads.reduce((s, l) => s + (l.composite_efb_risk ?? 0), 0) / efbLeads.length)
        : null

      setKpis({
        totalLeads: leads.length,
        loiSigned: leads.filter(l => l.loi_status === 'loi_signed').length,
        activeJobs: jobs.filter(j => ['scheduled', 'in_progress'].includes(j.status)).length,
        paidRevenue,
        treatNow: leads.filter(l => l.action_recommendation === 'TREAT_NOW').length,
        scoutNow: leads.filter(l => l.action_recommendation === 'SCOUT_NOW').length,
        contactNow: leads.filter(l => l.action_recommendation === 'CONTACT_NOW').length,
        avgEfbRisk,
        leadsByVertical: byVertical,
        recentJobs: jobs.slice(0, 5),
        topLeads: leads
          .filter(l => l.lead_score !== null)
          .sort((a, b) => (b.lead_score ?? 0) - (a.lead_score ?? 0))
          .slice(0, 8),
      })
      setLoading(false)
    }
    fetchData()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-slate-400 text-sm">Loading dashboard…</div>
      </div>
    )
  }

  const k = kpis!

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Operations Overview</h1>
        <p className="text-slate-500 text-sm mt-0.5">1COMMERCE Precision Ag · Canby, OR</p>
      </div>

      {/* Primary KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Total Leads" value={k.totalLeads} sub="across all verticals" color="blue" />
        <KPICard label="LOI Signed" value={k.loiSigned} sub="active contracts" color="green" />
        <KPICard label="Active Jobs" value={k.activeJobs} sub="scheduled + in-progress" color="orange" />
        <KPICard label="Revenue Collected" value={`$${k.paidRevenue.toLocaleString()}`} sub="paid invoices" color="purple" />
      </div>

      {/* EFB Ops Queue */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">EFB Action Queue</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <ActionCard label="🔴 Treat Now" count={k.treatNow} colorClass="bg-red-50 border-red-200" />
          <ActionCard label="🟠 Scout Now" count={k.scoutNow} colorClass="bg-orange-50 border-orange-200" />
          <ActionCard label="🟡 Contact Now" count={k.contactNow} colorClass="bg-yellow-50 border-yellow-200" />
          <ActionCard
            label="🧠 Avg EFB Risk"
            count={k.avgEfbRisk !== null ? `${k.avgEfbRisk}/100` : '—'}
            colorClass="bg-slate-50 border-slate-200"
          />
        </div>
      </div>

      {/* Leads by vertical + top leads */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Vertical breakdown */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Leads by Vertical</h2>
          <div className="space-y-3">
            {Object.entries(k.leadsByVertical).map(([vert, count]) => {
              const pct = Math.round((count / k.totalLeads) * 100)
              return (
                <div key={vert}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-slate-600">{VERTICAL_LABELS[vert] ?? vert}</span>
                    <span className="text-slate-900 font-medium">{count}</span>
                  </div>
                  <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-brand-500 rounded-full"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Top scored leads */}
        <div className="bg-white rounded-xl border border-slate-200 p-5">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Top Priority Leads</h2>
          <div className="space-y-2">
            {k.topLeads.map(lead => (
              <div key={lead.id} className="flex items-center justify-between py-1.5 border-b border-slate-50 last:border-0">
                <div>
                  <div className="text-sm font-medium text-slate-800 truncate max-w-[200px]">
                    {lead.business_name ?? lead.owner_name ?? 'Unknown'}
                  </div>
                  <div className="text-xs text-slate-500">{lead.city}, {lead.county} Co. · {lead.primary_crop ?? lead.vertical}</div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {lead.action_recommendation && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_COLORS[lead.action_recommendation] ?? ''}`}>
                      {lead.action_recommendation.replace('_', ' ')}
                    </span>
                  )}
                  <span className="text-sm font-bold text-slate-700">{lead.lead_score}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Recent jobs */}
      <div className="bg-white rounded-xl border border-slate-200 p-5">
        <h2 className="text-sm font-semibold text-slate-700 mb-4">Recent Jobs</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                <th className="pb-2 font-medium">Job</th>
                <th className="pb-2 font-medium">Vertical</th>
                <th className="pb-2 font-medium">Pilot</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {k.recentJobs.map(job => (
                <tr key={job.id} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 text-slate-800 font-medium">{job.job_title ?? '—'}</td>
                  <td className="py-2 text-slate-500">{VERTICAL_LABELS[job.vertical ?? ''] ?? job.vertical}</td>
                  <td className="py-2 text-slate-500">{job.pilot ?? '—'}</td>
                  <td className="py-2">
                    <StatusBadge status={job.status} />
                  </td>
                  <td className="py-2 text-right text-slate-800">
                    {job.invoice_amount ? `$${job.invoice_amount.toLocaleString()}` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

function KPICard({ label, value, sub, color }: { label: string; value: string | number; sub: string; color: string }) {
  const colorMap: Record<string, string> = {
    blue:   'bg-blue-50 text-blue-700',
    green:  'bg-green-50 text-green-700',
    orange: 'bg-orange-50 text-orange-700',
    purple: 'bg-purple-50 text-purple-700',
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5">
      <div className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full mb-3 ${colorMap[color]}`}>
        {label}
      </div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{sub}</div>
    </div>
  )
}

function ActionCard({ label, count, colorClass }: { label: string; count: string | number; colorClass: string }) {
  return (
    <div className={`rounded-xl border p-4 ${colorClass}`}>
      <div className="text-sm font-medium text-slate-700">{label}</div>
      <div className="text-2xl font-bold text-slate-900 mt-1">{count}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    quoted:      'bg-slate-100 text-slate-600',
    scheduled:   'bg-blue-100 text-blue-600',
    in_progress: 'bg-yellow-100 text-yellow-700',
    completed:   'bg-green-100 text-green-700',
    invoiced:    'bg-purple-100 text-purple-700',
    paid:        'bg-brand-100 text-brand-700',
    cancelled:   'bg-red-100 text-red-600',
  }
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${map[status] ?? 'bg-slate-100 text-slate-500'}`}>
      {status.replace('_', ' ')}
    </span>
  )
}
