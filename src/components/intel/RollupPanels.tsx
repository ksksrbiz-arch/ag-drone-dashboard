'use client'

import type { Lead } from '@/lib/supabase'
import {
  rollupByCounty,
  rollupByCrop,
  sprayWindowDistribution,
  type Rollup,
} from '@/lib/efb/analytics'
import { SPRAY_META, type SprayWindow } from '@/lib/efb/scoring'

// County / crop risk rollups + spray-window mix for the Intel Hub.

function riskBar(v: number): string {
  if (v >= 75) return 'bg-red-500'
  if (v >= 55) return 'bg-orange-400'
  if (v >= 40) return 'bg-yellow-400'
  return 'bg-green-400'
}

function RollupTable({ title, rows }: { title: string; rows: Rollup[] }) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
      <h2 className="text-sm font-semibold text-slate-700 mb-3">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-xs text-slate-400">No data.</p>
      ) : (
        <div className="space-y-2.5">
          {rows.slice(0, 8).map(r => (
            <div key={r.key}>
              <div className="flex items-center justify-between text-xs mb-1">
                <span className="font-medium text-slate-700 truncate">{r.key}</span>
                <span className="text-slate-400 shrink-0 ml-2">
                  {r.parcels} parcels · {r.acres.toLocaleString()} ac
                  {r.treatNow > 0 && (
                    <span className="ml-1.5 text-red-600 font-semibold">{r.treatNow} treat</span>
                  )}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${riskBar(r.avgRisk)}`} style={{ width: `${r.avgRisk}%` }} />
                </div>
                <span className="text-xs font-bold text-slate-600 w-8 text-right">{r.avgRisk}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function RollupPanels({ leads }: { leads: Lead[] }) {
  const counties = rollupByCounty(leads)
  const crops = rollupByCrop(leads)
  const spray = sprayWindowDistribution(leads)
  const sprayTotal = Object.values(spray).reduce((s, n) => s + n, 0)

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      <RollupTable title="Risk by County" rows={counties} />
      <RollupTable title="Risk by Crop" rows={crops} />

      <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
        <h2 className="text-sm font-semibold text-slate-700 mb-3">Spray-Window Forecast</h2>
        <p className="text-xs text-slate-400 mb-4">
          Treatability of at-risk parcels under current conditions
        </p>
        <div className="space-y-3">
          {(['optimal', 'narrowing', 'poor', 'unknown'] as SprayWindow[]).map(w => {
            const count = spray[w]
            const pct = sprayTotal ? Math.round((count / sprayTotal) * 100) : 0
            return (
              <div key={w}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span
                    className={`px-2 py-0.5 rounded-full border font-medium ${SPRAY_META[w].cls}`}
                  >
                    {SPRAY_META[w].label}
                  </span>
                  <span className="text-slate-500 font-medium">
                    {count} <span className="text-slate-400">({pct}%)</span>
                  </span>
                </div>
                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full ${
                      w === 'optimal'
                        ? 'bg-green-500'
                        : w === 'narrowing'
                        ? 'bg-amber-400'
                        : 'bg-slate-300'
                    }`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
