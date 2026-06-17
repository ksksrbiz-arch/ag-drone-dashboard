'use client'

import { useState } from 'react'
import { DISCOVERY_CATEGORIES } from '@/lib/discovery/categories'
import { CITY_SHORT } from '@/lib/business'
import { useRole } from '@/lib/auth/role'

interface Candidate {
  business_name: string
  city: string | null
  county: string | null
  website: string | null
  phone: string | null
  email: string | null
  notes: string | null
  dup: boolean
}

export default function DiscoverPage() {
  const { isStaff } = useRole()
  const [categoryKey, setCategoryKey] = useState(DISCOVERY_CATEGORIES[0].key)
  const [busy, setBusy] = useState<'preview' | 'add' | null>(null)
  const [result, setResult] = useState<any>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function run(dryRun: boolean) {
    setBusy(dryRun ? 'preview' : 'add')
    setMsg(null)
    if (dryRun) setResult(null)
    try {
      const res = await fetch('/api/discover', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: categoryKey, dryRun, limit: 10 }),
      })
      const json = await res.json()
      if (!res.ok || json.ok === false) {
        setMsg(`Failed: ${json.error ?? res.statusText}`)
      } else if (dryRun) {
        setResult(json)
        if (json.found === 0) setMsg('No prospects found — try a different category.')
      } else {
        setMsg(`Added ${json.inserted} new lead(s) — they’re queued for AI research now.`)
        setResult({ ...result, _added: true })
      }
    } catch (err: any) {
      setMsg(`Failed: ${String(err?.message ?? err)}`)
    } finally {
      setBusy(null)
    }
  }

  const candidates: Candidate[] = result?.candidates ?? []
  const newCount = result?.newCount ?? candidates.filter(c => !c.dup).length

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-5xl mx-auto animate-fade">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Discover Leads</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          AI web search finds new prospects{CITY_SHORT ? ` near ${CITY_SHORT}` : ''} · they’re auto-enriched after adding
        </p>
      </div>

      {/* Category picker */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
        {DISCOVERY_CATEGORIES.map(c => (
          <button
            key={c.key}
            onClick={() => { setCategoryKey(c.key); setResult(null); setMsg(null) }}
            className={`tap text-left rounded-xl border p-3 transition-colors ${
              categoryKey === c.key
                ? 'border-brand-400 bg-brand-50'
                : 'border-slate-200 bg-white hover:border-slate-300'
            }`}
          >
            <div className="text-sm font-medium text-slate-800">{c.label}</div>
            <div className="text-xs text-slate-400 mt-0.5">{c.vertical} · {c.tag}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        {isStaff && (
        <button
          onClick={() => run(true)}
          disabled={busy !== null}
          className="tap inline-flex items-center justify-center text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-4 py-2 transition-colors disabled:opacity-60 shadow-card"
        >
          {busy === 'preview' ? 'Searching the web…' : '🔍 Find prospects'}
        </button>
        )}
        {isStaff && newCount > 0 && !result?._added && (
          <button
            onClick={() => run(false)}
            disabled={busy !== null}
            className="tap inline-flex items-center justify-center text-sm bg-white border border-brand-300 text-brand-700 hover:bg-brand-50 font-medium rounded-lg px-4 py-2 transition-colors disabled:opacity-60"
          >
            {busy === 'add' ? 'Adding…' : `Add ${newCount} new lead${newCount === 1 ? '' : 's'}`}
          </button>
        )}
      </div>

      {msg && (
        <div className="text-sm rounded-lg border border-brand-200 bg-brand-50 text-brand-800 px-4 py-2.5 mb-4">
          {msg}
        </div>
      )}

      {busy === 'preview' && (
        <p className="text-xs text-slate-400 mb-4">Web search can take 20–40 seconds…</p>
      )}

      {candidates.length > 0 && (
        <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
          <div className="px-4 py-2.5 border-b border-slate-100 text-xs text-slate-500">
            {result?.found} found · {newCount} new · {candidates.length - newCount} already in your database
          </div>
          <div className="divide-y divide-slate-50 max-h-[60vh] overflow-y-auto">
            {candidates.map((c, i) => (
              <div key={i} className="px-4 py-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-800 truncate">{c.business_name}</span>
                    {c.dup && (
                      <span className="shrink-0 text-[11px] px-1.5 py-0.5 rounded-full bg-slate-100 text-slate-500">
                        in database
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-slate-500 truncate mt-0.5">
                    {[c.city, c.county && `${c.county} Co.`].filter(Boolean).join(', ') || '—'}
                    {c.phone ? ` · ${c.phone}` : ''}
                  </div>
                  {c.notes && <div className="text-xs text-slate-400 mt-1 line-clamp-2">{c.notes}</div>}
                </div>
                {c.website && (
                  <a
                    href={c.website.startsWith('http') ? c.website : `https://${c.website}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="tap inline-flex items-center text-xs text-brand-600 hover:text-brand-700 shrink-0"
                  >
                    site ↗
                  </a>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
