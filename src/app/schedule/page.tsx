'use client'

// Dispatch board — the scheduling surface. Shows active jobs grouped by day
// (with an Unscheduled bucket) and lets staff assign date, pilot, equipment,
// and status inline. Reuses the jobs table; pairs with Field Ops' spray-window
// view for picking good days.

import { useEffect, useMemo, useState } from 'react'
import { supabase, type Job, type JobStatus } from '@/lib/supabase'
import { useRole } from '@/lib/auth/role'
import { BUSINESS } from '@/lib/business'
import { fetchSprayWindows, type SprayDay, type SprayRating } from '@/lib/weather'

// Non-terminal statuses belong on the board; completed/invoiced/paid/cancelled
// drop off it.
const ACTIVE: JobStatus[] = ['quoted', 'scheduled', 'in_progress']
const BOARD_STATUSES: JobStatus[] = ['quoted', 'scheduled', 'in_progress', 'completed', 'cancelled']

// Flyability badge styling per weather rating (vertical-neutral: wind/precip
// suitability applies to any drone work, not just spraying).
const FLY_META: Record<SprayRating, { dot: string; label: string; cls: string }> = {
  GO: { dot: '🟢', label: 'Good to fly', cls: 'text-green-700' },
  CAUTION: { dot: '🟡', label: 'Marginal', cls: 'text-amber-700' },
  NO_GO: { dot: '🔴', label: 'No-fly', cls: 'text-red-600' },
}

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

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Monday (local) of the week containing `d`. */
function mondayOf(d: Date): string {
  const x = new Date(d); x.setHours(0, 0, 0, 0)
  const dow = (x.getDay() + 6) % 7 // 0 = Monday
  x.setDate(x.getDate() - dow)
  return isoDate(x)
}

function addDays(iso: string, n: number): string {
  const d = new Date(iso + 'T00:00:00'); d.setDate(d.getDate() + n)
  return isoDate(d)
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
  const [view, setView] = useState<'agenda' | 'week'>('agenda')
  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()))
  const [weather, setWeather] = useState<Record<string, SprayDay>>({})

  useEffect(() => {
    supabase
      .from('jobs')
      .select('*')
      .in('status', ACTIVE)
      .order('scheduled_date', { ascending: true, nullsFirst: false })
      .then(({ data }) => { setJobs((data ?? []) as Job[]); setLoading(false) })
  }, [])

  // Forecast-window flyability (wind/precip) for "best day to fly" hints.
  useEffect(() => {
    fetchSprayWindows(BUSINESS.hqLat, BUSINESS.hqLon, 16)
      .then(days => setWeather(Object.fromEntries(days.map(d => [d.date, d]))))
      .catch(() => {})
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
      <div className="mb-6 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Dispatch</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {jobs.length} active job{jobs.length === 1 ? '' : 's'}
            {unscheduledCount > 0 && ` · ${unscheduledCount} unscheduled`}
          </p>
        </div>
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-medium">
          {(['agenda', 'week'] as const).map(v => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`tap px-3 py-1.5 rounded-md capitalize transition-colors ${view === v ? 'bg-brand-500 text-white' : 'text-slate-500 hover:text-slate-700'}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : jobs.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-card p-8 text-center">
          <p className="text-sm text-slate-500">No active jobs to dispatch.</p>
          <p className="text-xs text-slate-400 mt-1">Quoted, scheduled, and in-progress jobs show up here.</p>
        </div>
      ) : view === 'week' ? (
        <div>
          <div className="flex items-center justify-between mb-3">
            <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="tap text-sm text-slate-500 hover:text-slate-700">← Prev</button>
            <div className="text-sm font-semibold text-slate-700">Week of {new Date(weekStart + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</div>
            <div className="flex items-center gap-3">
              <button onClick={() => setWeekStart(mondayOf(new Date()))} className="tap text-xs text-brand-600 hover:text-brand-700">This week</button>
              <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="tap text-sm text-slate-500 hover:text-slate-700">Next →</button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-2">
            {Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)).map(date => {
              const dayJobs = jobs.filter(j => j.scheduled_date?.slice(0, 10) === date)
              const d = new Date(date + 'T00:00:00')
              const isToday = date === isoDate(new Date())
              const fly = weather[date]
              return (
                <div key={date} className={`rounded-lg border p-2 min-h-[90px] ${isToday ? 'border-brand-300 bg-brand-50/40' : 'border-slate-200 bg-white'}`}>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-medium text-slate-500">{d.toLocaleDateString(undefined, { weekday: 'short' })} {d.getDate()}</span>
                    {fly && (
                      <span
                        className={`text-[10px] ${FLY_META[fly.rating].cls}`}
                        title={`${FLY_META[fly.rating].label} · wind ${Math.round(fly.windMax)}mph, gust ${Math.round(fly.gustMax)}mph, precip ${fly.precipProb}%${fly.reasons.length ? ' — ' + fly.reasons.join(', ') : ''}`}
                      >
                        {FLY_META[fly.rating].dot} {Math.round(fly.windMax)}mph
                      </span>
                    )}
                  </div>
                  <div className="space-y-1">
                    {dayJobs.map(job => (
                      <div key={job.id} className="rounded-md border border-slate-100 bg-white px-1.5 py-1">
                        <p className="text-[11px] font-medium text-slate-700 truncate">{job.job_title ?? 'Job'}</p>
                        <span className={`inline-block mt-0.5 text-[10px] px-1.5 rounded-full ${STATUS_PILL[job.status] ?? ''}`}>{job.status.replace('_', ' ')}</span>
                      </div>
                    ))}
                    {dayJobs.length === 0 && <p className="text-[11px] text-slate-300">—</p>}
                  </div>
                </div>
              )
            })}
          </div>
          {unscheduledCount > 0 && (
            <p className="text-xs text-amber-700 mt-3">{unscheduledCount} unscheduled job{unscheduledCount === 1 ? '' : 's'} — switch to Agenda to assign dates.</p>
          )}
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
