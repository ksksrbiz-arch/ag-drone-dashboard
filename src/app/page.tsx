'use client'

import { useEffect, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { supabase, type Lead, type Job } from '@/lib/supabase'
import { BRAND_NAME, BUSINESS } from '@/lib/business'

interface KPIs {
  totalLeads: number
  p1: number
  loiSigned: number
  paidRevenue: number
  activeJobs: number
  leadsByVertical: Record<string, number>
  recentJobs: Job[]
  topLeads: Lead[]
}

// Counts from the daily-digest endpoint (already aggregates the v4 views).
interface DigestCounts {
  treat_now?: number
  followups_due?: number
  at_risk?: number
  new_p1?: number
  needs_enrichment?: number
}

const VERTICAL_LABELS: Record<string, string> = {
  ag_spray: '🌾 Ag Spray', insurance: '🏠 Insurance', real_estate: '🏡 Real Estate',
  construction: '🏗️ Construction', energy: '☀️ Solar & Infra', mapping: '🗺️ Mapping',
  inspection: '🔎 Inspection', survey: '📐 Survey', delivery: '📦 Delivery',
}

const TIER_PILL: Record<string, string> = {
  P1: 'bg-red-100 text-red-700', P2: 'bg-orange-100 text-orange-700',
  P3: 'bg-yellow-100 text-yellow-700', P4: 'bg-slate-100 text-slate-500',
}

export default function OverviewPage() {
  const [kpis, setKpis] = useState<KPIs | null>(null)
  const [counts, setCounts] = useState<DigestCounts>({})
  const [loading, setLoading] = useState(true)
  const [brief, setBrief] = useState<string | null>(null)
  const [briefBusy, setBriefBusy] = useState(false)

  useEffect(() => {
    async function fetchData() {
      const [leadsRes, jobsRes, digestRes] = await Promise.all([
        supabase.from('leads').select('*'),
        supabase.from('jobs').select('*').order('created_at', { ascending: false }).limit(10),
        fetch('/api/digest', { cache: 'no-store' }).then(r => r.json()).catch(() => null),
      ])

      const leads: Lead[] = leadsRes.data ?? []
      const jobs: Job[] = jobsRes.data ?? []
      if (digestRes?.ok) setCounts(digestRes.counts ?? {})

      const byVertical: Record<string, number> = {}
      leads.forEach(l => { byVertical[l.vertical] = (byVertical[l.vertical] ?? 0) + 1 })

      const score = (l: Lead) => l.priority_score ?? l.lead_score ?? 0

      setKpis({
        totalLeads: leads.length,
        p1: leads.filter(l => l.priority_tier === 'P1').length,
        loiSigned: leads.filter(l => l.loi_status === 'loi_signed').length,
        paidRevenue: jobs.filter(j => j.status === 'paid').reduce((s, j) => s + (j.paid_amount ?? 0), 0),
        activeJobs: jobs.filter(j => ['scheduled', 'in_progress'].includes(j.status)).length,
        leadsByVertical: byVertical,
        recentJobs: jobs.slice(0, 5),
        topLeads: [...leads].sort((a, b) => score(b) - score(a)).slice(0, 8),
      })
      setLoading(false)
    }
    fetchData()
  }, [])

  async function briefMe() {
    if (briefBusy) return
    setBriefBusy(true)
    try {
      const r = await fetch('/api/digest?narrate=1', { cache: 'no-store' })
      const j = await r.json()
      setBrief(j.ok ? String(j.narrated ?? j.text ?? '').replace(/\*/g, '') : 'Could not generate a brief right now.')
    } catch {
      setBrief('Could not generate a brief right now.')
    } finally {
      setBriefBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 md:p-8 space-y-6 max-w-7xl mx-auto">
        <div className="h-7 w-56 skeleton" />
        <div className="h-24 skeleton rounded-xl" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-24 skeleton" />)}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-20 skeleton" />)}
        </div>
      </div>
    )
  }

  const k = kpis!
  const attention: { label: string; count: number; href: string; cls: string; icon: string }[] = [
    { label: 'Treat now', count: counts.treat_now ?? 0, href: '/intel', cls: 'border-red-200 bg-red-50 hover:bg-red-100', icon: '🔴' },
    { label: 'Follow-ups due', count: counts.followups_due ?? 0, href: '/automation', cls: 'border-amber-200 bg-amber-50 hover:bg-amber-100', icon: '⏰' },
    { label: 'At risk', count: counts.at_risk ?? 0, href: '/automation', cls: 'border-red-200 bg-red-50 hover:bg-red-100', icon: '⚠️' },
    { label: 'New P1s', count: counts.new_p1 ?? 0, href: '/leads', cls: 'border-orange-200 bg-orange-50 hover:bg-orange-100', icon: '📈' },
    { label: 'Need research', count: counts.needs_enrichment ?? 0, href: '/automation', cls: 'border-slate-200 bg-slate-50 hover:bg-slate-100', icon: '🤖' },
  ]
  const attentionTotal = attention.reduce((s, a) => s + a.count, 0)

  return (
    <div className="p-4 sm:p-6 md:p-8 space-y-6 max-w-7xl mx-auto animate-fade">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Operations Overview</h1>
          <p className="text-slate-500 text-sm mt-0.5">{[BRAND_NAME, BUSINESS.city].filter(Boolean).join(' · ')}</p>
        </div>
        <Link href="/assistant" className="tap text-sm text-brand-700 hover:text-brand-800 font-medium">Ask the assistant →</Link>
      </div>

      {/* AI state-of-the-business brief */}
      <div className="rounded-xl border border-brand-200 bg-gradient-to-br from-brand-50 to-white p-5 shadow-card">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-brand-800 flex items-center gap-1.5"><span aria-hidden>✨</span> Today&apos;s Brief</h2>
          <button onClick={briefMe} disabled={briefBusy} className="tap text-xs font-medium text-brand-700 hover:text-brand-800 disabled:opacity-60">
            {briefBusy ? 'Thinking…' : brief ? 'Refresh' : 'Brief me'}
          </button>
        </div>
        {brief ? (
          <p className="text-sm text-slate-700 mt-2 whitespace-pre-wrap leading-relaxed">{brief}</p>
        ) : (
          <p className="text-sm text-slate-500 mt-1.5">
            {attentionTotal > 0
              ? `${attentionTotal} item${attentionTotal === 1 ? '' : 's'} need attention today. Tap “Brief me” for a quick read.`
              : 'All quiet — tap “Brief me” for a quick read on the business.'}
          </p>
        )}
      </div>

      {/* Primary KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard label="Total Leads" value={k.totalLeads} sub="across all verticals" color="blue" />
        <KPICard label="P1 Priority" value={k.p1} sub="hottest-fit leads" color="red" />
        <KPICard label="LOIs Signed" value={k.loiSigned} sub="won this pipeline" color="green" />
        <KPICard label="Revenue Collected" value={`$${k.paidRevenue.toLocaleString()}`} sub={`${k.activeJobs} active jobs`} color="purple" />
      </div>

      {/* Needs attention — the command-center strip */}
      <div>
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Needs Attention</h2>
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
          {attention.map(a => (
            <Link key={a.label} href={a.href} className={`tap rounded-xl border p-4 transition-colors ${a.cls}`}>
              <div className="flex items-center gap-1.5 text-sm font-medium text-slate-700"><span aria-hidden>{a.icon}</span>{a.label}</div>
              <div className="text-2xl font-bold text-slate-900 mt-1">{a.count}</div>
            </Link>
          ))}
        </div>
      </div>

      {/* Top priority leads + vertical breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-slate-700">Top Priority Leads</h2>
            <Link href="/leads" className="text-xs text-brand-700 hover:text-brand-800 font-medium">View all →</Link>
          </div>
          <div className="space-y-2">
            {k.topLeads.map(lead => (
              <div key={lead.id} className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-50 last:border-0">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-800 truncate">{lead.business_name ?? lead.owner_name ?? 'Unknown'}</div>
                  <div className="text-xs text-slate-500 truncate">
                    {[lead.city, lead.primary_crop ?? VERTICAL_LABELS[lead.vertical]?.replace(/^\S+\s/, '')].filter(Boolean).join(' · ') || '—'}
                    {lead.next_best_action && <span className="text-brand-600"> · → {lead.next_best_action}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {lead.priority_tier && (
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${TIER_PILL[lead.priority_tier] ?? ''}`}>{lead.priority_tier}</span>
                  )}
                  <span className="text-sm font-bold text-slate-700 w-8 text-right">{lead.priority_score ?? lead.lead_score ?? '—'}</span>
                </div>
              </div>
            ))}
            {k.topLeads.length === 0 && <p className="text-sm text-slate-400">No leads yet.</p>}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">Leads by Vertical</h2>
          <div className="space-y-3">
            {Object.entries(k.leadsByVertical).sort(([, a], [, b]) => b - a).map(([vert, count]) => (
              <div key={vert}>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-slate-600">{VERTICAL_LABELS[vert] ?? vert}</span>
                  <span className="text-slate-900 font-medium">{count}</span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className="h-full bg-brand-500 rounded-full" style={{ width: `${Math.round((count / (k.totalLeads || 1)) * 100)}%` }} />
                </div>
              </div>
            ))}
            {Object.keys(k.leadsByVertical).length === 0 && <p className="text-sm text-slate-400">No leads yet.</p>}
          </div>
        </div>
      </div>

      {/* Recent jobs */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-slate-700">Recent Jobs</h2>
          <Link href="/jobs" className="text-xs text-brand-700 hover:text-brand-800 font-medium">View all →</Link>
        </div>
        {k.recentJobs.length === 0 ? (
          <p className="text-sm text-slate-400">No jobs yet.</p>
        ) : (
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
                    <td className="py-2"><StatusBadge status={job.status} /></td>
                    <td className="py-2 text-right text-slate-800">{job.invoice_amount ? `$${job.invoice_amount.toLocaleString()}` : '—'}</td>
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

function KPICard({ label, value, sub, color }: { label: string; value: string | number; sub: string; color: string }) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-700', green: 'bg-green-50 text-green-700',
    orange: 'bg-orange-50 text-orange-700', purple: 'bg-purple-50 text-purple-700',
    red: 'bg-red-50 text-red-700',
  }
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card hover:shadow-card-hover transition-shadow">
      <div className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full mb-3 ${colorMap[color]}`}>{label}</div>
      <div className="text-2xl font-bold text-slate-900">{value}</div>
      <div className="text-xs text-slate-500 mt-1">{sub}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    quoted: 'bg-slate-100 text-slate-600', scheduled: 'bg-blue-100 text-blue-600',
    in_progress: 'bg-yellow-100 text-yellow-700', completed: 'bg-green-100 text-green-700',
    invoiced: 'bg-purple-100 text-purple-700', paid: 'bg-brand-100 text-brand-700',
    cancelled: 'bg-red-100 text-red-600',
  }
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${map[status] ?? 'bg-slate-100 text-slate-500'}`}>
      {status.replace('_', ' ')}
    </span>
  )
}
