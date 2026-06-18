'use client'

import { useState } from 'react'
import { DISCOVERY_CATEGORIES } from '@/lib/discovery/categories'
import { CITY_SHORT, APOLLO_PROSPECTING_ENABLED } from '@/lib/business'
import { useRole } from '@/lib/auth/role'

interface Candidate {
  business_name: string
  city: string | null
  county?: string | null
  state?: string | null
  website: string | null
  phone: string | null
  email?: string | null
  industry?: string | null
  notes: string | null
  dup: boolean
}

type Source = 'web' | 'apollo'

export default function DiscoverPage() {
  const { isStaff } = useRole()
  const [categoryKey, setCategoryKey] = useState(DISCOVERY_CATEGORIES[0].key)
  const [source, setSource] = useState<Source>('web')
  const [busy, setBusy] = useState<'preview' | 'add' | null>(null)
  const [result, setResult] = useState<any>(null)
  const [msg, setMsg] = useState<string | null>(null)

  async function run(dryRun: boolean) {
    setBusy(dryRun ? 'preview' : 'add')
    setMsg(null)
    if (dryRun) setResult(null)
    try {
      const endpoint = source === 'apollo' ? '/api/discover/apollo' : '/api/discover'
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: categoryKey, dryRun, limit: source === 'apollo' ? 25 : 10 }),
      })
      const json = await res.json()
      if (!res.ok || json.ok === false) {
        setMsg(`Failed: ${json.error ?? res.statusText}`)
      } else if (dryRun) {
        setResult(json)
        if (json.found === 0) {
          const d = json._diag
          if (source === 'apollo' && d) {
            setMsg(
              d.error
                ? `Apollo: ${d.error}${d.status ? ` (HTTP ${d.status})` : ''}`
                : `Apollo returned ${d.total ?? 0} match${d.total === 1 ? '' : 'es'} for this category/location — try a broader category or a different location.`
            )
          } else {
            setMsg('No prospects found — try a different category.')
          }
        }
      } else {
        setMsg(`Added ${json.inserted} new lead(s) — they’re queued for AI research now.`)
        setResult((r: any) => ({ ...r, _added: true }))
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
      <div className="mb-5 flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Discover Leads</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            {source === 'apollo'
              ? `Pull prospects from Apollo's B2B database${CITY_SHORT ? ` near ${CITY_SHORT}` : ''}`
              : `AI web search finds new prospects${CITY_SHORT ? ` near ${CITY_SHORT}` : ''}`}{' '}
            · they’re auto-enriched after adding
          </p>
        </div>
        {isStaff && APOLLO_PROSPECTING_ENABLED && (
          <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5 text-xs font-medium">
            {(['web', 'apollo'] as const).map(s => (
              <button
                key={s}
                onClick={() => { setSource(s); setResult(null); setMsg(null) }}
                className={`tap px-3 py-1.5 rounded-md transition-colors ${source === s ? 'bg-brand-500 text-white' : 'text-slate-500 hover:text-slate-700'}`}
              >
                {s === 'web' ? '🔍 Web' : '🚀 Apollo'}
              </button>
            ))}
          </div>
        )}
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
          {busy === 'preview' ? (source === 'apollo' ? 'Searching Apollo…' : 'Searching the web…') : (source === 'apollo' ? '🚀 Find in Apollo' : '🔍 Find prospects')}
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

      {busy === 'preview' && source === 'web' && (
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
                    {[c.city, c.county ? `${c.county} Co.` : c.state].filter(Boolean).join(', ') || '—'}
                    {c.phone ? ` · ${c.phone}` : ''}
                  </div>
                  {(c.notes || c.industry) && <div className="text-xs text-slate-400 mt-1 line-clamp-2">{c.notes ?? c.industry}</div>}
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
