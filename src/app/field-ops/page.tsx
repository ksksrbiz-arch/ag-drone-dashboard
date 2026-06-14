'use client'

import { useEffect, useMemo, useState } from 'react'
import { supabase, type Job } from '@/lib/supabase'
import { fetchSprayWindows, type SprayDay, type SprayRating } from '@/lib/weather'

const RATING_META: Record<
  SprayRating,
  { label: string; card: string; pill: string; bar: string }
> = {
  GO: {
    label: 'GO',
    card: 'bg-green-50 border-green-200',
    pill: 'bg-green-100 text-green-700',
    bar: 'bg-green-500',
  },
  CAUTION: {
    label: 'CAUTION',
    card: 'bg-yellow-50 border-yellow-200',
    pill: 'bg-yellow-100 text-yellow-700',
    bar: 'bg-yellow-400',
  },
  NO_GO: {
    label: 'NO-GO',
    card: 'bg-red-50 border-red-200',
    pill: 'bg-red-100 text-red-700',
    bar: 'bg-red-500',
  },
}

const DEFAULT_EQUIPMENT = 'DJI Agras T50'

export default function FieldOpsPage() {
  const [jobs, setJobs] = useState<Job[]>([])
  const [spray, setSpray] = useState<SprayDay[]>([])
  const [loading, setLoading] = useState(true)
  const [weatherError, setWeatherError] = useState(false)
  const [savingId, setSavingId] = useState<string | null>(null)
  // Per-job scheduling form drafts
  const [drafts, setDrafts] = useState<Record<string, { date: string; pilot: string }>>({})

  async function loadJobs() {
    const { data } = await supabase
      .from('jobs')
      .select('*')
      .order('scheduled_date', { ascending: true })
    setJobs((data ?? []) as Job[])
  }

  useEffect(() => {
    Promise.all([
      loadJobs(),
      fetchSprayWindows()
        .then(setSpray)
        .catch(() => setWeatherError(true)),
    ]).finally(() => setLoading(false))
  }, [])

  // Best upcoming spray day → suggested default when scheduling.
  const bestDay = useMemo(
    () => spray.find(d => d.rating === 'GO') ?? spray[0],
    [spray]
  )

  const weekAhead = useMemo(() => {
    const now = new Date()
    const in7 = new Date(now.getTime() + 7 * 86400000)
    return jobs
      .filter(j => j.scheduled_date)
      .filter(j => {
        const d = new Date(j.scheduled_date as string)
        return d >= new Date(now.toDateString()) && d <= in7
      })
      .filter(j => !['completed', 'paid', 'cancelled', 'invoiced'].includes(j.status))
  }, [jobs])

  const unscheduled = useMemo(
    () =>
      jobs.filter(
        j => !j.scheduled_date && !['completed', 'paid', 'cancelled'].includes(j.status)
      ),
    [jobs]
  )

  function draftFor(job: Job) {
    return (
      drafts[job.id] ?? {
        date: bestDay?.date ?? '',
        pilot: job.pilot ?? '',
      }
    )
  }

  async function scheduleJob(job: Job) {
    const draft = draftFor(job)
    if (!draft.date) return
    setSavingId(job.id)
    const updates: Partial<Job> = {
      scheduled_date: draft.date,
      status: 'scheduled',
      pilot: draft.pilot || job.pilot,
      equipment: job.equipment ?? DEFAULT_EQUIPMENT,
    }
    await supabase.from('jobs').update(updates).eq('id', job.id)
    setJobs(prev => prev.map(j => (j.id === job.id ? { ...j, ...updates } : j)))
    setSavingId(null)
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto animate-fade">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Field Ops</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Spray-window forecast · Canby, OR · schedule jobs onto the best days
        </p>
      </div>

      {/* Spray window forecast */}
      <div className="mb-8">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">7-Day Spray Window</h2>
        {loading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="h-32 skeleton" />
            ))}
          </div>
        ) : weatherError ? (
          <div className="bg-white rounded-xl border border-slate-200 p-4 text-sm text-slate-500 shadow-card">
            Couldn’t load the forecast right now. Spraying conditions unavailable.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
            {spray.map(day => {
              const m = RATING_META[day.rating]
              return (
                <div key={day.date} className={`rounded-xl border p-3 shadow-card ${m.card}`}>
                  <div className="text-xs font-medium text-slate-600">{day.label}</div>
                  <div className={`mt-1 inline-block text-xs font-bold px-2 py-0.5 rounded-full ${m.pill}`}>
                    {m.label}
                  </div>
                  <div className="mt-2 space-y-0.5 text-xs text-slate-600">
                    <div>💨 {day.windMax} mph{day.gustMax > day.windMax ? ` · g${day.gustMax}` : ''}</div>
                    <div>🌧️ {day.precipProb}%</div>
                    <div>🌡️ {day.tempMax}°F</div>
                  </div>
                  <div className="mt-1.5 text-[11px] text-slate-500 leading-tight">{day.reasons[0]}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* This week's schedule */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
          <h2 className="text-sm font-semibold text-slate-700 mb-4">
            Scheduled — Next 7 Days ({weekAhead.length})
          </h2>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-14 skeleton" />)}
            </div>
          ) : weekAhead.length === 0 ? (
            <p className="text-sm text-slate-400">No jobs scheduled in the next week.</p>
          ) : (
            <div className="space-y-2">
              {weekAhead.map(job => {
                const dayRating = spray.find(d => d.date === job.scheduled_date?.slice(0, 10))
                return (
                  <div
                    key={job.id}
                    className="flex items-center justify-between gap-3 py-2 border-b border-slate-50 last:border-0"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-800 truncate">
                        {job.job_title ?? 'Job'}
                      </div>
                      <div className="text-xs text-slate-500 truncate">
                        {new Date(job.scheduled_date as string).toLocaleDateString('en-US', {
                          weekday: 'short',
                          month: 'short',
                          day: 'numeric',
                        })}
                        {job.pilot ? ` · ${job.pilot}` : ''}
                        {job.city ? ` · ${job.city}` : ''}
                      </div>
                    </div>
                    {dayRating && (
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium shrink-0 ${RATING_META[dayRating.rating].pill}`}>
                        {RATING_META[dayRating.rating].label}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Needs scheduling */}
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
          <h2 className="text-sm font-semibold text-slate-700 mb-1">
            Needs Scheduling ({unscheduled.length})
          </h2>
          <p className="text-xs text-slate-400 mb-4">
            {bestDay
              ? `Next best spray day: ${bestDay.label} (${RATING_META[bestDay.rating].label})`
              : 'Pick a date and pilot to put a job on the board.'}
          </p>
          {loading ? (
            <div className="space-y-2">
              {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-20 skeleton" />)}
            </div>
          ) : unscheduled.length === 0 ? (
            <p className="text-sm text-slate-400">Everything’s scheduled. 🎉</p>
          ) : (
            <div className="space-y-3">
              {unscheduled.map(job => {
                const draft = draftFor(job)
                return (
                  <div key={job.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="text-sm font-medium text-slate-800 truncate">
                      {job.job_title ?? 'Job'}
                    </div>
                    <div className="text-xs text-slate-500 mb-2">
                      {[job.city, job.county && `${job.county} Co.`].filter(Boolean).join(', ') || '—'}
                      {job.quote_amount ? ` · $${job.quote_amount.toLocaleString()}` : ''}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="date"
                        value={draft.date}
                        onChange={e =>
                          setDrafts(d => ({ ...d, [job.id]: { ...draft, date: e.target.value } }))
                        }
                        className="tap text-xs border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                      <input
                        type="text"
                        placeholder="Pilot"
                        value={draft.pilot}
                        onChange={e =>
                          setDrafts(d => ({ ...d, [job.id]: { ...draft, pilot: e.target.value } }))
                        }
                        className="tap text-xs border border-slate-200 rounded-lg px-2 py-1.5 w-24 focus:outline-none focus:ring-2 focus:ring-brand-500"
                      />
                      <button
                        onClick={() => scheduleJob(job)}
                        disabled={savingId === job.id || !draft.date}
                        className="tap inline-flex items-center justify-center text-xs bg-brand-500 hover:bg-brand-600 text-white rounded-lg px-3 py-1.5 font-medium transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        {savingId === job.id ? '…' : 'Schedule'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
