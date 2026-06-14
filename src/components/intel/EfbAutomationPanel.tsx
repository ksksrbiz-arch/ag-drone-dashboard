'use client'

import { useCallback, useEffect, useState } from 'react'
import { Satellite, RefreshCw } from 'lucide-react'
import { supabase, type EfbRun } from '@/lib/supabase'

// EFB recompute automation — engine health, run button, and run history.
// Lives on the Automation page alongside the lead-enrichment engine.

export default function EfbAutomationPanel() {
  const [runs, setRuns] = useState<EfbRun[]>([])
  const [writeMode, setWriteMode] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const loadRuns = useCallback(async () => {
    const { data } = await supabase
      .from('efb_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(6)
    setRuns((data ?? []) as EfbRun[])
  }, [])

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/efb/status', { cache: 'no-store' })
      const json = await res.json()
      setWriteMode(json.writeMode ?? null)
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    loadRuns()
    loadStatus()
    let channel: ReturnType<typeof supabase.channel> | null = null
    try {
      channel = supabase
        .channel('efb-runs')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'efb_runs' }, loadRuns)
        .subscribe()
    } catch {
      /* realtime optional */
    }
    return () => {
      if (channel) supabase.removeChannel(channel)
    }
  }, [loadRuns, loadStatus])

  async function runNow() {
    setRunning(true)
    setMessage(null)
    try {
      const res = await fetch('/api/efb/recompute?limit=300', { method: 'POST' })
      const json = await res.json()
      if (!res.ok || json.ok === false) {
        setMessage(`Recompute failed: ${json.error ?? res.statusText}`)
      } else {
        setMessage(
          `Recomputed ${json.parcelsProcessed} parcels · ${json.parcelsUpdated} updated · ` +
            `${json.treatNow} treat-now · ${json.alertsRaised} alert(s) · ${(json.durationMs / 1000).toFixed(1)}s`
        )
      }
      await loadRuns()
    } catch (err: any) {
      setMessage(`Recompute failed: ${String(err?.message ?? err)}`)
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-1">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Satellite size={16} /> EFB Satellite Risk Engine
        </h2>
        <button
          onClick={runNow}
          disabled={running}
          className="tap inline-flex items-center gap-1.5 text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-4 py-2 transition-colors disabled:opacity-60 shadow-card"
        >
          <RefreshCw size={14} className={running ? 'animate-spin' : ''} />
          {running ? 'Recomputing…' : 'Recompute EFB risk'}
        </button>
      </div>
      <p className="text-xs text-slate-400 mb-3">
        Re-scores every ag-spray parcel from weather + leaf-wetness + NDRE + ML signal, refreshes
        action recommendations &amp; spray windows, and raises TREAT_NOW alerts.
        {writeMode && (
          <span className="ml-1">
            Writes: <span className="font-medium text-slate-500">{writeMode}</span>
            {writeMode === 'none' && ' — read-only, configure a Supabase key'}
          </span>
        )}
      </p>

      {message && (
        <div className="text-xs rounded-lg border border-brand-200 bg-brand-50 text-brand-800 px-3 py-2 mb-3">
          {message}
        </div>
      )}

      {runs.length === 0 ? (
        <p className="text-sm text-slate-400">No EFB recompute runs recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                <th className="pb-2 font-medium">Started</th>
                <th className="pb-2 font-medium">Trigger</th>
                <th className="pb-2 font-medium">Status</th>
                <th className="pb-2 font-medium text-right">Parcels</th>
                <th className="pb-2 font-medium text-right">Updated</th>
                <th className="pb-2 font-medium text-right">Treat-now</th>
                <th className="pb-2 font-medium text-right">Alerts</th>
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
                  <td className="py-2 text-right text-slate-600">{run.parcels_processed}</td>
                  <td className="py-2 text-right text-slate-600">{run.parcels_updated}</td>
                  <td className="py-2 text-right text-slate-600">{run.treat_now}</td>
                  <td className="py-2 text-right text-slate-600">{run.alerts_raised}</td>
                  <td className="py-2 text-right text-slate-500">
                    {run.duration_ms != null ? `${(run.duration_ms / 1000).toFixed(1)}s` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
