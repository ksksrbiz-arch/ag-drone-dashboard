'use client'

import { useEffect, useState, useMemo } from 'react'
import { supabase, type Job, type JobStatus } from '@/lib/supabase'

const STATUS_COLS: { status: JobStatus; label: string; color: string }[] = [
  { status: 'quoted',      label: 'Quoted',      color: 'bg-slate-100 text-slate-600'   },
  { status: 'scheduled',  label: 'Scheduled',  color: 'bg-blue-100 text-blue-600'      },
  { status: 'in_progress',label: 'In Progress', color: 'bg-yellow-100 text-yellow-700'  },
  { status: 'completed',  label: 'Completed',  color: 'bg-indigo-100 text-indigo-700'  },
  { status: 'invoiced',   label: 'Invoiced',   color: 'bg-purple-100 text-purple-700'  },
  { status: 'paid',        label: 'Paid',        color: 'bg-green-100 text-green-700'    },
  { status: 'cancelled',  label: 'Cancelled',  color: 'bg-red-100 text-red-500'        },
]

const VERTICAL_LABELS: Record<string, string> = {
  ag_spray:    '🌾 Ag Spray',
  insurance:   '🏠 Insurance',
  real_estate: '🏡 Real Estate',
  construction:'🏗️ Construction',
}

export default function JobsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<JobStatus | 'all'>('all')
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<Job | null>(null)
  const [report, setReport] = useState<string | null>(null)
  const [reportBusy, setReportBusy] = useState(false)

  async function generateReport(job: Job) {
    setReport(null)
    setReportBusy(true)
    try {
      const res = await fetch('/api/jobs/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId: job.id }),
      })
      const json = await res.json()
      setReport(res.ok && json.ok ? json.report : `Failed: ${json.error ?? res.statusText}`)
    } catch (err: any) {
      setReport(`Failed: ${String(err?.message ?? err)}`)
    } finally {
      setReportBusy(false)
    }
  }

  useEffect(() => {
    supabase
      .from('jobs')
      .select('*')
      .order('scheduled_date', { ascending: false })
      .then(({ data }) => {
        setJobs(data ?? [])
        setLoading(false)
      })
  }, [])

  const filtered = useMemo(() => {
    return jobs
      .filter(j => statusFilter === 'all' || j.status === statusFilter)
      .filter(j => {
        if (!search) return true
        const q = search.toLowerCase()
        return (
          j.job_title?.toLowerCase().includes(q) ||
          j.city?.toLowerCase().includes(q) ||
          j.pilot?.toLowerCase().includes(q)
        )
      })
  }, [jobs, statusFilter, search])

  // Summary metrics
  const totalInvoiced = jobs.reduce((s, j) => s + (j.invoice_amount ?? 0), 0)
  const totalPaid     = jobs.reduce((s, j) => s + (j.paid_amount ?? 0), 0)
  const outstanding   = totalInvoiced - totalPaid

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto animate-fade">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Job Tracker</h1>
        <p className="text-slate-500 text-sm mt-0.5">All flights, quotes, and invoices</p>
      </div>

      {/* Revenue summary */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <MetricCard label="Total Invoiced" value={`$${totalInvoiced.toLocaleString()}`} color="purple" />
        <MetricCard label="Collected" value={`$${totalPaid.toLocaleString()}`} color="green" />
        <MetricCard label="Outstanding" value={`$${outstanding.toLocaleString()}`} color="orange" />
      </div>

      {/* Status summary pills */}
      <div className="flex flex-wrap gap-2 mb-5">
        <button
          onClick={() => setStatusFilter('all')}
          className={`tap inline-flex items-center text-xs px-3 py-1.5 rounded-full font-medium border transition-colors
            ${statusFilter === 'all' ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}
        >
          All ({jobs.length})
        </button>
        {STATUS_COLS.map(s => {
          const count = jobs.filter(j => j.status === s.status).length
          if (count === 0) return null
          return (
            <button
              key={s.status}
              onClick={() => setStatusFilter(s.status)}
              className={`tap inline-flex items-center text-xs px-3 py-1.5 rounded-full font-medium border transition-colors
                ${statusFilter === s.status ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200 hover:border-slate-400'}`}
            >
              {s.label} ({count})
            </button>
          )
        })}
      </div>

      {/* Search */}
      <div className="mb-4">
        <input
          type="text"
          placeholder="Search job title, pilot, city…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="text-sm border border-slate-200 rounded-lg px-3 py-2 w-full max-w-sm
                     focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      {/* Jobs table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
        {loading ? (
          <div className="p-4 space-y-2">
            {Array.from({ length: 10 }).map((_, i) => <div key={i} className="h-10 skeleton" />)}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100 sticky top-0 z-10">
                <tr className="text-left text-xs text-slate-500">
                  <th className="px-4 py-3 font-medium">Job Title</th>
                  <th className="px-4 py-3 font-medium">Vertical</th>
                  <th className="px-4 py-3 font-medium">Location</th>
                  <th className="px-4 py-3 font-medium">Pilot</th>
                  <th className="px-4 py-3 font-medium">Equipment</th>
                  <th className="px-4 py-3 font-medium">Scheduled</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium text-right">Quote</th>
                  <th className="px-4 py-3 font-medium text-right">Invoice</th>
                  <th className="px-4 py-3 font-medium text-right">Paid</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-8 text-center text-slate-400 text-sm">
                      No jobs match current filters.
                    </td>
                  </tr>
                ) : filtered.map(job => (
                  <tr
                    key={job.id}
                    onClick={() => { setSelected(job); setReport(null) }}
                    className={`border-b border-slate-50 hover:bg-slate-50 last:border-0 cursor-pointer ${selected?.id === job.id ? 'bg-brand-50' : ''}`}
                  >
                    <td className="px-4 py-3 font-medium text-slate-900">{job.job_title ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                      {VERTICAL_LABELS[job.vertical ?? ''] ?? job.vertical ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {[job.city, job.county].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500">{job.pilot ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{job.equipment ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                      {job.scheduled_date
                        ? new Date(job.scheduled_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={job.status} />
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      {job.quote_amount ? `$${job.quote_amount.toLocaleString()}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-slate-600">
                      {job.invoice_amount ? `$${job.invoice_amount.toLocaleString()}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-right text-green-700 font-medium">
                      {job.paid_amount ? `$${job.paid_amount.toLocaleString()}` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Job completion report */}
      {selected && (
        <div className="mt-6 bg-white rounded-xl border border-slate-200 shadow-card p-5">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div>
              <h2 className="text-sm font-semibold text-slate-800">{selected.job_title ?? 'Job'}</h2>
              <p className="text-xs text-slate-500">
                {[selected.city, selected.county].filter(Boolean).join(', ') || '—'} · {selected.status.replace('_', ' ')}
              </p>
            </div>
            <button
              onClick={() => { setSelected(null); setReport(null) }}
              aria-label="Close"
              className="tap-sq inline-flex items-center justify-center text-slate-400 hover:text-slate-600 text-xl leading-none"
            >
              ×
            </button>
          </div>
          <button
            onClick={() => generateReport(selected)}
            disabled={reportBusy}
            className="tap inline-flex items-center justify-center text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-4 py-2 transition-colors disabled:opacity-60 shadow-card"
          >
            {reportBusy ? 'Generating…' : '📄 Generate completion report'}
          </button>
          {report && (
            <div className="mt-3">
              <textarea
                readOnly
                value={report}
                rows={10}
                className="w-full text-xs border border-slate-200 rounded-lg px-3 py-2 bg-slate-50 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <button
                onClick={() => navigator.clipboard?.writeText(report)}
                className="tap inline-flex items-center text-xs text-slate-500 hover:text-slate-700 mt-1"
              >
                Copy
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function MetricCard({ label, value, color }: { label: string; value: string; color: string }) {
  const colorMap: Record<string, string> = {
    purple: 'bg-purple-50 border-purple-100 text-purple-700',
    green:  'bg-green-50 border-green-100 text-green-700',
    orange: 'bg-orange-50 border-orange-100 text-orange-700',
  }
  return (
    <div className={`rounded-xl border p-4 ${colorMap[color]}`}>
      <div className="text-xs font-medium opacity-70 mb-1">{label}</div>
      <div className="text-xl font-bold">{value}</div>
    </div>
  )
}

function StatusBadge({ status }: { status: string }) {
  const entry = STATUS_COLS.find(s => s.status === status)
  return (
    <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium ${entry?.color ?? 'bg-slate-100 text-slate-500'}`}>
      {status.replace('_', ' ')}
    </span>
  )
}
