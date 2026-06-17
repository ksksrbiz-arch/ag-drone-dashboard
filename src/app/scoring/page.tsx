'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase, type Lead, type PriorityTier } from '@/lib/supabase'
import { computePriority, type ScoringConfig } from '@/lib/enrichment/priority'

// Scoring-config editor — tune the priority engine's per-factor weights and
// P1–P4 thresholds without code. Empty/Reset reverts to the built-in defaults;
// changes take effect on the next scoring run.

type FactorDef = { key: string; label: string; agWeight: number; nonAgWeight: number }
type Thresholds = { p1: number; p2: number; p3: number }

const TIER_BAR: Record<PriorityTier, string> = {
  P1: 'bg-red-500',
  P2: 'bg-orange-400',
  P3: 'bg-yellow-400',
  P4: 'bg-slate-400',
}

export default function ScoringSettingsPage() {
  const [factors, setFactors] = useState<FactorDef[]>([])
  const [agW, setAgW] = useState<Record<string, string>>({})
  const [nonAgW, setNonAgW] = useState<Record<string, string>>({})
  const [th, setTh] = useState<{ p1: string; p2: string; p3: string }>({ p1: '', p2: '', p3: '' })
  const [defaults, setDefaults] = useState<{ factors: FactorDef[]; thresholds: Thresholds } | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  // Live-preview sample: real leads scored in-browser under the edited config.
  const [sample, setSample] = useState<Lead[]>([])
  // The config currently in effect (saved) — the baseline the preview compares against.
  const [savedConfig, setSavedConfig] = useState<ScoringConfig>({})

  const hydrate = useCallback(
    (config: any, defs: { factors: FactorDef[]; thresholds: Thresholds }) => {
      setFactors(defs.factors)
      const ag: Record<string, string> = {}
      const nonag: Record<string, string> = {}
      for (const f of defs.factors) {
        ag[f.key] = String(config?.agWeights?.[f.key] ?? f.agWeight)
        nonag[f.key] = String(config?.nonAgWeights?.[f.key] ?? f.nonAgWeight)
      }
      setAgW(ag)
      setNonAgW(nonag)
      const t = config?.thresholds ?? defs.thresholds
      setTh({ p1: String(t.p1), p2: String(t.p2), p3: String(t.p3) })
    },
    []
  )

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/scoring-config', { cache: 'no-store' })
      const json = await res.json()
      if (json.ok) {
        setDefaults(json.defaults)
        setSavedConfig(json.config ?? {})
        hydrate(json.config, json.defaults)
      }
    } catch {
      /* best-effort */
    }
  }, [hydrate])

  useEffect(() => {
    load().then(() => setLoading(false))
  }, [load])

  // Pull a sample of real leads (only the fields the scorer reads) for the
  // in-browser live preview.
  useEffect(() => {
    supabase
      .from('leads')
      .select(
        'id,vertical,distance_to_canby_mi,est_acreage,primary_crop,composite_efb_risk,action_recommendation,spray_window_score,risk_trend,est_annual_revenue,loi_status,phone,email,loi_signed_at,loi_sent_at,created_at,lead_score'
      )
      .limit(500)
      .then(({ data }) => setSample((data ?? []) as Lead[]))
  }, [])

  function buildConfig() {
    const num = (s: string, fallback: number) => {
      const n = Number(s)
      return Number.isFinite(n) ? n : fallback
    }
    const agWeights: Record<string, number> = {}
    const nonAgWeights: Record<string, number> = {}
    for (const f of factors) {
      agWeights[f.key] = Math.max(0, num(agW[f.key], f.agWeight))
      nonAgWeights[f.key] = Math.max(0, num(nonAgW[f.key], f.nonAgWeight))
    }
    const thresholds = {
      p1: num(th.p1, defaults?.thresholds.p1 ?? 75),
      p2: num(th.p2, defaults?.thresholds.p2 ?? 55),
      p3: num(th.p3, defaults?.thresholds.p3 ?? 35),
    }
    return { agWeights, nonAgWeights, thresholds }
  }

  // Baseline tiers under the config currently in effect — recomputed when the
  // sample or the saved config changes.
  const baseTiers = useMemo(
    () => sample.map(l => computePriority(l, {}, savedConfig).tier),
    [sample, savedConfig]
  )

  // Re-tier the sample under the currently-edited config (relationship signal
  // left neutral — this previews the weight/threshold effect, not job history).
  const preview = useMemo(() => {
    if (!sample.length) return null
    const cfg = buildConfig()
    const base: Record<PriorityTier, number> = { P1: 0, P2: 0, P3: 0, P4: 0 }
    const next: Record<PriorityTier, number> = { P1: 0, P2: 0, P3: 0, P4: 0 }
    let changed = 0
    sample.forEach((l, i) => {
      const b = baseTiers[i]
      base[b]++
      const n = computePriority(l, {}, cfg).tier
      next[n]++
      if (n !== b) changed++
    })
    return { base, next, changed, n: sample.length }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sample, baseTiers, agW, nonAgW, th, factors, defaults])

  async function save() {
    const cfg = buildConfig()
    const { p1, p2, p3 } = cfg.thresholds
    if (!(p1 >= p2 && p2 >= p3)) {
      setMessage('Thresholds must be ordered: P1 ≥ P2 ≥ P3.')
      return
    }
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/scoring-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: cfg }),
      })
      const json = await res.json()
      if (res.ok && json.ok) setSavedConfig(cfg)
      setMessage(res.ok && json.ok ? 'Saved — applies on the next scoring run.' : `Save failed: ${json.error ?? res.statusText}`)
    } catch (err: any) {
      setMessage(`Save failed: ${String(err?.message ?? err)}`)
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    setBusy(true)
    setMessage(null)
    try {
      const res = await fetch('/api/scoring-config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: {} }),
      })
      const json = await res.json()
      if (res.ok && json.ok) {
        setSavedConfig({})
        if (defaults) hydrate({}, defaults)
        setMessage('Reset to defaults.')
      } else {
        setMessage(`Reset failed: ${json.error ?? res.statusText}`)
      }
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <div className="p-4 sm:p-6 md:p-8 max-w-3xl mx-auto space-y-6">
        <div className="h-7 w-48 skeleton" />
        <div className="h-64 skeleton rounded-xl" />
      </div>
    )
  }

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-3xl mx-auto space-y-6 animate-fade">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Scoring Settings</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          Tune the priority engine — weights are relative (auto-normalized). Changes apply on the next scoring run.
        </p>
      </div>

      {message && (
        <div className="text-sm rounded-lg border border-brand-200 bg-brand-50 text-brand-800 px-4 py-2.5">{message}</div>
      )}

      {/* Live preview */}
      {preview && (
        <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
            <h2 className="text-sm font-semibold text-slate-700">Live Preview</h2>
            <span className="text-xs text-slate-400">
              <span className="font-semibold text-slate-700">{preview.changed}</span> of {preview.n} sample leads change tier
            </span>
          </div>
          <p className="text-xs text-slate-400 mb-4">
            How this sample re-tiers under the edited config vs. defaults — updates as you type, not saved. (Approximate: relationship signal is neutral here.)
          </p>
          <div className="space-y-2.5">
            {(['default', 'edited'] as const).map(which => {
              const dist = which === 'default' ? preview.base : preview.next
              const total = preview.n || 1
              return (
                <div key={which}>
                  <div className="flex justify-between text-xs mb-1">
                    <span className="text-slate-500">{which === 'default' ? 'In effect' : 'Edited'}</span>
                    <span className="text-slate-400 tabular-nums">
                      {(['P1', 'P2', 'P3', 'P4'] as PriorityTier[]).map(t => `${t} ${dist[t]}`).join(' · ')}
                    </span>
                  </div>
                  <div className="flex h-2.5 rounded-full overflow-hidden bg-slate-100">
                    {(['P1', 'P2', 'P3', 'P4'] as PriorityTier[]).map(t => (
                      <div key={t} className={TIER_BAR[t]} style={{ width: `${(dist[t] / total) * 100}%` }} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Tier thresholds */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
        <h2 className="text-sm font-semibold text-slate-700 mb-1">Tier Thresholds</h2>
        <p className="text-xs text-slate-400 mb-4">Score cutoffs (0–100). A lead is P1 ≥ P1-cutoff, P2 ≥ P2-cutoff, etc.</p>
        <div className="flex flex-wrap gap-4">
          {(['p1', 'p2', 'p3'] as const).map(k => (
            <label key={k} className="text-sm">
              <span className="block text-xs text-slate-500 mb-1 uppercase">{k} ≥</span>
              <input
                type="number"
                min={0}
                max={100}
                value={th[k]}
                onChange={e => setTh(prev => ({ ...prev, [k]: e.target.value }))}
                className="w-24 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </label>
          ))}
        </div>
      </div>

      {/* Factor weights */}
      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
        <h2 className="text-sm font-semibold text-slate-700 mb-1">Factor Weights</h2>
        <p className="text-xs text-slate-400 mb-4">
          Per-factor weight for ag-spray vs. non-ag verticals. Ag-only factors default to 0 for non-ag.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                <th className="pb-2 font-medium">Factor</th>
                <th className="pb-2 font-medium text-right">Ag weight</th>
                <th className="pb-2 font-medium text-right">Non-ag weight</th>
              </tr>
            </thead>
            <tbody>
              {factors.map(f => (
                <tr key={f.key} className="border-b border-slate-50 last:border-0">
                  <td className="py-2 text-slate-700">{f.label}</td>
                  <td className="py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={agW[f.key] ?? ''}
                      onChange={e => setAgW(prev => ({ ...prev, [f.key]: e.target.value }))}
                      className="w-20 text-sm text-right border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </td>
                  <td className="py-2 text-right">
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={nonAgW[f.key] ?? ''}
                      onChange={e => setNonAgW(prev => ({ ...prev, [f.key]: e.target.value }))}
                      className="w-20 text-sm text-right border border-slate-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={save}
          disabled={busy}
          className="tap inline-flex items-center justify-center text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-4 py-2 transition-colors disabled:opacity-60 shadow-card"
        >
          {busy ? 'Saving…' : 'Save'}
        </button>
        <button
          onClick={reset}
          disabled={busy}
          className="tap inline-flex items-center justify-center text-sm border border-slate-200 hover:border-slate-400 text-slate-700 rounded-lg px-4 py-2 font-medium transition-colors disabled:opacity-60"
        >
          Reset to defaults
        </button>
      </div>
    </div>
  )
}
