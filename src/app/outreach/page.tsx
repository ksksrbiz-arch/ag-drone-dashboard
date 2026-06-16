'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { OutreachDraft, OutreachStatus, PriorityTier } from '@/lib/supabase'

// A draft row with the linked lead's display fields embedded (from the API).
type LeadEmbed = {
  business_name: string | null
  owner_name: string | null
  city: string | null
  primary_crop: string | null
  phone: string | null
  email: string | null
  priority_tier: PriorityTier | null
}
type Row = OutreachDraft & { lead: LeadEmbed | null }

const REASON_META: Record<string, { label: string; cls: string }> = {
  new_p1: { label: 'New P1', cls: 'bg-red-50 text-red-700 border-red-200' },
  followup: { label: 'Follow-up', cls: 'bg-amber-50 text-amber-700 border-amber-200' },
  priority: { label: 'Priority', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  manual: { label: 'Manual', cls: 'bg-slate-50 text-slate-600 border-slate-200' },
}

const STATUS_META: Record<OutreachStatus, string> = {
  draft: 'bg-slate-100 text-slate-600',
  approved: 'bg-green-100 text-green-700',
  sent: 'bg-blue-100 text-blue-700',
  dismissed: 'bg-slate-100 text-slate-400',
}

const TABS: (OutreachStatus | 'all')[] = ['all', 'draft', 'approved', 'sent', 'dismissed']

export default function OutreachPage() {
  const [drafts, setDrafts] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<OutreachStatus | 'all'>('draft')
  const [channel, setChannel] = useState<'email' | 'sms'>('email')
  const [generating, setGenerating] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [dirty, setDirty] = useState<Set<string>>(new Set())
  const [busyId, setBusyId] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/outreach/queue', { cache: 'no-store' })
      const json = await res.json()
      setDrafts(json.ok ? (json.drafts ?? []) : [])
    } catch {
      /* best-effort */
    }
  }, [])

  useEffect(() => {
    load().then(() => setLoading(false))
  }, [load])

  async function generate() {
    setGenerating(true)
    setMessage(null)
    try {
      const res = await fetch('/api/outreach/queue', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ channel, limit: 8 }),
      })
      const json = await res.json()
      if (!res.ok || json.ok === false) {
        setMessage(`Generate failed: ${json.error ?? res.statusText}`)
      } else {
        setMessage(
          json.generated > 0
            ? `Drafted ${json.generated} ${channel}(s)${json.skipped ? ` · ${json.skipped} skipped (already queued or unreachable)` : ''}`
            : `Nothing new to draft${json.skipped ? ` · ${json.skipped} skipped (already queued or unreachable)` : ' — no outreach-ready leads'}`
        )
        setTab('draft')
        await load()
      }
    } catch (err: any) {
      setMessage(`Generate failed: ${String(err?.message ?? err)}`)
    } finally {
      setGenerating(false)
    }
  }

  function editField(id: string, field: 'subject' | 'body', value: string) {
    setDrafts(prev => prev.map(d => (d.id === id ? { ...d, [field]: value } : d)))
    setDirty(prev => new Set(prev).add(id))
  }

  async function save(row: Row) {
    setBusyId(row.id)
    try {
      await fetch('/api/outreach/queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, subject: row.subject, body: row.body }),
      })
      setDirty(prev => {
        const next = new Set(prev)
        next.delete(row.id)
        return next
      })
    } finally {
      setBusyId(null)
    }
  }

  async function setStatus(row: Row, status: OutreachStatus) {
    setBusyId(row.id)
    try {
      const res = await fetch('/api/outreach/queue', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: row.id, status }),
      })
      if (res.ok) {
        setDrafts(prev => prev.map(d => (d.id === row.id ? { ...d, status } : d)))
      }
    } finally {
      setBusyId(null)
    }
  }

  function copy(row: Row) {
    const text = [row.subject ? `Subject: ${row.subject}` : null, row.body].filter(Boolean).join('\n\n')
    navigator.clipboard?.writeText(text)
    setMessage('Copied to clipboard')
  }

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: drafts.length }
    for (const d of drafts) c[d.status] = (c[d.status] ?? 0) + 1
    return c
  }, [drafts])

  const visible = useMemo(
    () => (tab === 'all' ? drafts : drafts.filter(d => d.status === tab)),
    [drafts, tab]
  )

  return (
    <div className="p-4 sm:p-6 md:p-8 space-y-6 max-w-5xl mx-auto animate-fade">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Outreach Queue</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Review-first drafts for the leads the engine says to contact next — edit, approve, send. Nothing is sent automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-sm">
            {(['email', 'sms'] as const).map(c => (
              <button
                key={c}
                onClick={() => setChannel(c)}
                className={`tap px-3 py-2 font-medium transition-colors ${
                  channel === c ? 'bg-brand-500 text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {c === 'email' ? '✉️ Email' : '💬 SMS'}
              </button>
            ))}
          </div>
          <button
            onClick={generate}
            disabled={generating}
            className="tap inline-flex items-center justify-center text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-4 py-2 transition-colors disabled:opacity-60 shadow-card"
          >
            {generating ? 'Drafting…' : '⚡ Generate drafts'}
          </button>
        </div>
      </div>

      {message && (
        <div className="text-sm rounded-lg border border-brand-200 bg-brand-50 text-brand-800 px-4 py-2.5">
          {message}
        </div>
      )}

      {/* Status tabs */}
      <div className="flex flex-wrap gap-2">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`tap text-sm px-3 py-1.5 rounded-lg font-medium transition-colors border ${
              tab === t ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50'
            }`}
          >
            {t === 'all' ? 'All' : t[0].toUpperCase() + t.slice(1)}
            <span className={`ml-1.5 ${tab === t ? 'text-slate-300' : 'text-slate-400'}`}>{counts[t] ?? 0}</span>
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <div key={i} className="h-40 skeleton rounded-xl" />)}
        </div>
      ) : visible.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 p-8 shadow-card text-center">
          <p className="text-sm text-slate-500">
            {tab === 'draft'
              ? 'No drafts yet. Hit “Generate drafts” to queue outreach for your top leads.'
              : `No ${tab} items.`}
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {visible.map(row => {
            const lead = row.lead
            const reason = REASON_META[row.reason ?? 'manual'] ?? REASON_META.manual
            return (
              <div key={row.id} className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
                <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-900 text-sm">
                      {lead?.business_name ?? lead?.owner_name ?? 'Unknown lead'}
                    </div>
                    <div className="text-xs text-slate-500">
                      {[lead?.city, lead?.primary_crop].filter(Boolean).join(' · ') || '—'}
                      {' · '}
                      {row.channel === 'sms' ? `💬 ${lead?.phone ?? 'no phone'}` : `✉️ ${lead?.email ?? 'no email'}`}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium border ${reason.cls}`}>{reason.label}</span>
                    {row.priority_tier && (
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-slate-100 text-slate-600">{row.priority_tier}</span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_META[row.status]}`}>{row.status}</span>
                  </div>
                </div>

                {row.channel === 'email' && (
                  <input
                    value={row.subject ?? ''}
                    onChange={e => editField(row.id, 'subject', e.target.value)}
                    placeholder="Subject"
                    className="w-full text-sm font-medium border border-slate-200 rounded-lg px-3 py-2 mb-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                )}
                <textarea
                  value={row.body}
                  onChange={e => editField(row.id, 'body', e.target.value)}
                  rows={row.channel === 'sms' ? 3 : 7}
                  className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />

                <div className="flex flex-wrap items-center gap-2 mt-3">
                  {dirty.has(row.id) && (
                    <button
                      onClick={() => save(row)}
                      disabled={busyId === row.id}
                      className="tap text-xs bg-brand-500 hover:bg-brand-600 text-white rounded-lg px-3 py-1.5 font-medium transition-colors disabled:opacity-60"
                    >
                      Save edits
                    </button>
                  )}
                  <button onClick={() => copy(row)} className="tap text-xs border border-slate-200 hover:border-slate-400 text-slate-700 rounded-lg px-3 py-1.5 font-medium transition-colors">
                    Copy
                  </button>
                  <div className="flex-1" />
                  {row.status !== 'approved' && row.status !== 'sent' && (
                    <button onClick={() => setStatus(row, 'approved')} disabled={busyId === row.id} className="tap text-xs border border-green-200 text-green-700 hover:bg-green-50 rounded-lg px-3 py-1.5 font-medium transition-colors disabled:opacity-60">
                      Approve
                    </button>
                  )}
                  {row.status !== 'sent' && (
                    <button onClick={() => setStatus(row, 'sent')} disabled={busyId === row.id} className="tap text-xs bg-blue-500 hover:bg-blue-600 text-white rounded-lg px-3 py-1.5 font-medium transition-colors disabled:opacity-60">
                      Mark sent
                    </button>
                  )}
                  {row.status !== 'dismissed' && (
                    <button onClick={() => setStatus(row, 'dismissed')} disabled={busyId === row.id} className="tap text-xs text-slate-500 hover:text-slate-700 rounded-lg px-3 py-1.5 font-medium transition-colors disabled:opacity-60">
                      Dismiss
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
