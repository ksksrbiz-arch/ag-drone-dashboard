'use client'

import { useMemo, useState } from 'react'
import { ArrowUpDown, ArrowUp, ArrowDown, Download } from 'lucide-react'
import type { Lead } from '@/lib/supabase'
import { effectiveRisk, assessEfb, SPRAY_META } from '@/lib/efb/scoring'
import { actionOf, downloadCsv } from '@/lib/efb/analytics'

// Sortable, searchable parcel table with CSV export for the Intel Hub.

type SortKey = 'name' | 'risk' | 'acreage' | 'crop' | 'action' | 'trend'
type Dir = 'asc' | 'desc'

const TREND_GLYPH: Record<string, string> = { rising: '▲', falling: '▼', steady: '—' }
const TREND_CLS: Record<string, string> = {
  rising: 'text-red-600',
  falling: 'text-green-600',
  steady: 'text-slate-400',
}

const ACTION_CLS: Record<string, string> = {
  TREAT_NOW: 'bg-red-50 text-red-700',
  SCOUT_NOW: 'bg-orange-50 text-orange-700',
  CONTACT_NOW: 'bg-yellow-50 text-yellow-700',
  MONITOR: 'bg-green-50 text-green-700',
}

export default function ParcelTable({
  leads,
  selected,
  onSelect,
}: {
  leads: Lead[]
  selected: Lead | null
  onSelect: (l: Lead) => void
}) {
  const [sort, setSort] = useState<SortKey>('risk')
  const [dir, setDir] = useState<Dir>('desc')
  const [q, setQ] = useState('')

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase()
    const filtered = term
      ? leads.filter(l =>
          [l.business_name, l.owner_name, l.city, l.county, l.primary_crop]
            .filter(Boolean)
            .some(s => String(s).toLowerCase().includes(term))
        )
      : leads

    const val = (l: Lead): string | number => {
      switch (sort) {
        case 'name':
          return (l.business_name ?? l.owner_name ?? '').toLowerCase()
        case 'risk':
          return effectiveRisk(l)
        case 'acreage':
          return l.est_acreage ?? 0
        case 'crop':
          return (l.primary_crop ?? '').toLowerCase()
        case 'action':
          return actionOf(l)
        case 'trend':
          return l.risk_trend ?? 'steady'
      }
    }
    return [...filtered].sort((a, b) => {
      const av = val(a)
      const bv = val(b)
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv))
      return dir === 'asc' ? cmp : -cmp
    })
  }, [leads, q, sort, dir])

  function toggleSort(key: SortKey) {
    if (sort === key) setDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSort(key)
      setDir(key === 'name' || key === 'crop' ? 'asc' : 'desc')
    }
  }

  function SortHead({ label, k, right = false }: { label: string; k: SortKey; right?: boolean }) {
    const active = sort === k
    const Icon = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown
    return (
      <th className={`pb-2 font-medium ${right ? 'text-right' : ''}`}>
        <button
          onClick={() => toggleSort(k)}
          className={`tap inline-flex items-center gap-1 ${right ? 'flex-row-reverse' : ''} ${
            active ? 'text-slate-800' : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          {label}
          <Icon size={12} />
        </button>
      </th>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="text-sm font-semibold text-slate-700">
          Parcel Risk Register{' '}
          <span className="text-xs font-normal text-slate-400">({rows.length})</span>
        </h2>
        <div className="flex items-center gap-2">
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search parcels…"
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 focus:outline-none focus:ring-2 focus:ring-brand-500 w-44"
          />
          <button
            onClick={() => downloadCsv(rows)}
            className="tap inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-slate-200 bg-white text-slate-600 hover:border-slate-400 transition-colors"
          >
            <Download size={13} /> CSV
          </button>
        </div>
      </div>

      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
              <SortHead label="Parcel" k="name" />
              <SortHead label="Crop" k="crop" />
              <SortHead label="Acres" k="acreage" right />
              <SortHead label="Risk" k="risk" right />
              <th className="pb-2 font-medium text-center">Spray</th>
              <SortHead label="Trend" k="trend" right />
              <SortHead label="Action" k="action" right />
            </tr>
          </thead>
          <tbody>
            {rows.map(l => {
              const risk = effectiveRisk(l)
              const action = actionOf(l)
              const trend = l.risk_trend ?? 'steady'
              const spray = l.spray_window_status ?? assessEfb(l).sprayWindow
              const isSel = selected?.id === l.id
              return (
                <tr
                  key={l.id}
                  onClick={() => onSelect(l)}
                  className={`border-b border-slate-50 last:border-0 cursor-pointer transition-colors ${
                    isSel ? 'bg-brand-50' : 'hover:bg-slate-50'
                  }`}
                >
                  <td className="py-2 pr-2">
                    <div className="font-medium text-slate-800 truncate max-w-[160px]">
                      {l.business_name ?? l.owner_name ?? 'Unknown'}
                    </div>
                    <div className="text-xs text-slate-400 truncate">{l.city ?? '—'}</div>
                  </td>
                  <td className="py-2 text-slate-600">{l.primary_crop ?? '—'}</td>
                  <td className="py-2 text-right text-slate-600">
                    {l.est_acreage != null ? l.est_acreage.toLocaleString() : '—'}
                  </td>
                  <td className="py-2 text-right font-bold text-slate-800">{risk}</td>
                  <td className="py-2 text-center">
                    <span className={`text-xs px-1.5 py-0.5 rounded-full border ${SPRAY_META[spray].cls}`}>
                      {SPRAY_META[spray].label}
                    </span>
                  </td>
                  <td className={`py-2 text-right font-bold ${TREND_CLS[trend]}`}>
                    {TREND_GLYPH[trend]}
                  </td>
                  <td className="py-2 text-right">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_CLS[action] ?? ''}`}>
                      {action.replace(/_/g, ' ')}
                    </span>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-xs text-slate-400">
                  No parcels match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
