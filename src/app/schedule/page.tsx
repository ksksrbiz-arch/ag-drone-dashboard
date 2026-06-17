'use client'

// Dispatch board — the scheduling surface. Shows active jobs grouped by day
// (with an Unscheduled bucket) and lets staff assign date, pilot, equipment,
// and status inline. Reuses the jobs table; pairs with Field Ops' spray-window
// view for picking good days.

import { useEffect, useMemo, useState } from 'react'
import { supabase, type Job, type JobStatus } from '@/lib/supabase'
import { useRole } from '@/lib/auth/role'
import { BUSINESS } from '@/lib/business'

// Non-terminal statuses belong on the board; completed/invoiced/paid/cancelled
// drop off it.
const ACTIVE: JobStatus[] = ['quoted', 'scheduled', 'in_progress']
const BOARD_STATUSES: JobStatus[] = ['quoted', 'scheduled', 'in_progress', 'completed', 'cancelled']

const STATUS_PILL: Record<string, string> = {
  quoted: 'bg-slate-100 text-slate-600',
  scheduled: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-amber-100 text-amber-700',
  completed: 'bg-green-100 text-green-700',
  invoiced: 'bg-indigo-100 text-indigo-700',
  paid: 'bg-emerald-100 text-emerald-700',
  cancelled: 'bg-red-100 text-red-600',
}

function dayKey(d: string | null): string {
  return d ? d.slice(0, 10) : 'unscheduled'
}

function dayLabel(key: string): string {
  if (key === 'unscheduled') return 'Unscheduled'
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const d = new Date(key + 'T00:00:00')
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000)
  const rel = diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : null
  const nice = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  return rel ? `${rel} · ${nice}` : nice
}

export default function SchedulePage() {
  const { isStaff } = useRole()
  const [jobs, setJobs] = useState<Job[]>([])
  const [loading, setLoading] = useState(true)
  const [savingId, setSavingId] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('jobs')
      .select('*')
      .in('status', ACTIVE)
      .order('scheduled_date', { ascending: true, nullsFirst: false })
      .then(({ data }) => { setJobs((data ?? []) as Job[]); setLoading(false) })
  }, [])

  async function update(job: Job, patch: Partial<Job>) {
    setSavingId(job.id)
    setJobs(prev => prev.map(j => (j.id === job.id ? { ...j, ...patch } as Job : j)))
    await supabase.from('jobs').update(patch).eq('id', job.id)
    setSavingId(null)
  }

  // Group by day, unscheduled last, then chronological.
  const groups = useMemo(() => {
    const map = new Map<string, Job[]>()
    for (const j of jobs) {
      const k = dayKey(j.scheduled_date)
      ;(map.get(k) ?? map.set(k, []).get(k)!).push(j)
    }
    return Array.from(map.entries()).sort(([a], [b]) => {
      if (a === 'unscheduled') return 1
      if (b === 'unscheduled') return -1
      return a < b ? -1 : 1
    })
  }, [jobs])

  const unscheduledCount = jobs.filter(j => !j.scheduled_date).length

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-5xl mx-auto animate-fade">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dispatch</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          {jobs.length} active job{jobs.length === 1 ? '' : 's'}
          {unscheduledCount > 0 && ` · ${unscheduledCount} unscheduled`}
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : jobs.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-card p-8 text-center">
          <p className="text-sm text-slate-500">No active jobs to dispatch.</p>
          <p className="text-xs text-slate-400 mt-1">Quoted, scheduled, and in-progress jobs show up here.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {groups.map(([key, dayJobs]) => (
            <section key={key}>
              <div className="flex items-center gap-2 mb-2">
                <h2 className={`text-sm font-semibold ${key === 'unscheduled' ? 'text-amber-700' : 'text-slate-700'}`}>{dayLabel(key)}</h2>
                <span className="text-xs text-slate-400">{dayJobs.length}</span>
              </div>
              <div className="space-y-2">
                {dayJobs.map(job => (
                  <div key={job.id} className="bg-white rounded-xl border border-slate-200 shadow-card p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-slate-900 truncate">{job.job_title ?? 'Job'}</p>
                        <p className="text-xs text-slate-500 mt-0.5">
                          {[job.city, job.county && `${job.county} Co.`].filter(Boolean).join(', ') || '—'}
                          {job.quote_amount ? ` · $${job.quote_amount.toLocaleString()}` : ''}
                        </p>
                      </div>
                      <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_PILL[job.status] ?? ''}`}>
                        {job.status.replace('_', ' ')}
                      </span>
                    </div>

                    {isStaff ? (
                      <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[11px] text-slate-400">Date</span>
                          <input
                            type="date"
                            value={job.scheduled_date ? job.scheduled_date.slice(0, 10) : ''}
                            onChange={e => update(job, { scheduled_date: e.target.value || null, ...(e.target.value && job.status === 'quoted' ? { status: 'scheduled' } : {}) })}
                            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
                          />
                        </label>
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[11px] text-slate-400">Pilot</span>
                          <input
                            type="text"
                            defaultValue={job.pilot ?? ''}
                            placeholder={BUSINESS.signer || 'Pilot'}
                            onBlur={e => { if (e.target.value !== (job.pilot ?? '')) update(job, { pilot: e.target.value || null }) }}
                            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
                          />
                        </label>
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[11px] text-slate-400">Equipment</span>
                          <input
                            type="text"
                            defaultValue={job.equipment ?? ''}
                            placeholder={BUSINESS.equipment || 'Drone'}
                            onBlur={e => { if (e.target.value !== (job.equipment ?? '')) update(job, { equipment: e.target.value || null }) }}
                            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
                          />
                        </label>
                        <label className="flex flex-col gap-0.5">
                          <span className="text-[11px] text-slate-400">Status</span>
                          <select
                            value={job.status}
                            onChange={e => update(job, { status: e.target.value as JobStatus })}
                            className="text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
                          >
                            {BOARD_STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                          </select>
                        </label>
                      </div>
                    ) : (
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                        {job.pilot && <span>👤 {job.pilot}</span>}
                        {job.equipment && <span>🚁 {job.equipment}</span>}
                      </div>
                    )}
                    {savingId === job.id && <p className="text-[11px] text-slate-400 mt-1.5">Saving…</p>}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
