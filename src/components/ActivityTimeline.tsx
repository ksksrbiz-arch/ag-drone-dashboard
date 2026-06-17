'use client'

import { useEffect, useState } from 'react'
import { useRole } from '@/lib/auth/role'

interface Activity {
  id?: string
  kind: string
  body: string
  actor_email?: string | null
  created_at: string
}

const KIND_META: Record<string, { icon: string; label: string }> = {
  note: { icon: '📝', label: 'Note' },
  call: { icon: '📞', label: 'Call' },
  email: { icon: '✉️', label: 'Email' },
  sms: { icon: '💬', label: 'SMS' },
  meeting: { icon: '🗓️', label: 'Meeting' },
  stage: { icon: '🔄', label: 'Stage' },
  system: { icon: '⚙️', label: 'System' },
}
const ADD_KINDS = ['note', 'call', 'email', 'sms', 'meeting']

function when(ts: string): string {
  const d = new Date(ts)
  const diff = Date.now() - d.getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d ago`
  return d.toLocaleDateString()
}

export function ActivityTimeline({
  entityType,
  entityId,
}: {
  entityType: 'lead' | 'customer' | 'job'
  entityId: string
}) {
  const { isStaff } = useRole()
  const [items, setItems] = useState<Activity[]>([])
  const [loading, setLoading] = useState(true)
  const [kind, setKind] = useState('note')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setLoading(true)
    fetch(`/api/activities?entity_type=${entityType}&entity_id=${entityId}`)
      .then(r => r.json())
      .then(j => { if (active && j.ok) setItems(j.activities) })
      .catch(() => {})
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [entityType, entityId])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    if (!body.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch('/api/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_type: entityType, entity_id: entityId, kind, body }),
      })
      const j = await r.json()
      if (j.ok) {
        setItems(p => [j.activity, ...p])
        setBody('')
      } else setError(j.error ?? 'Failed to log')
    } catch (err: any) {
      setError(String(err?.message ?? err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Activity</h3>
        {items.length > 0 && <span className="text-[11px] text-slate-400">{items.length}</span>}
      </div>

      {isStaff && (
      <form onSubmit={add} className="mb-3">
        <div className="flex gap-1.5 mb-1.5">
          {ADD_KINDS.map(k => (
            <button
              key={k}
              type="button"
              onClick={() => setKind(k)}
              className={`text-[11px] px-2 py-1 rounded-full border transition-colors ${kind === k ? 'bg-brand-500 text-white border-brand-500' : 'bg-white text-slate-500 border-slate-200 hover:bg-slate-50'}`}
            >
              {KIND_META[k].icon} {KIND_META[k].label}
            </button>
          ))}
        </div>
        <div className="flex gap-1.5">
          <input
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder={`Log a ${kind}…`}
            className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
          <button type="submit" disabled={busy || !body.trim()} className="text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-3 transition-colors disabled:opacity-60">Log</button>
        </div>
        {error && <p className="text-xs text-red-600 mt-1">{error}</p>}
      </form>
      )}

      {loading ? (
        <p className="text-xs text-slate-400">Loading…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-slate-400">{isStaff ? 'No activity yet — log the first call, email, or note above.' : 'No activity yet.'}</p>
      ) : (
        <ul className="space-y-2.5">
          {items.map((a, i) => {
            const meta = KIND_META[a.kind] ?? KIND_META.note
            return (
              <li key={a.id ?? i} className="flex gap-2.5">
                <span className="text-sm shrink-0 mt-0.5" title={meta.label}>{meta.icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{a.body}</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    {meta.label} · {when(a.created_at)}
                    {a.actor_email ? ` · ${a.actor_email.split('@')[0]}` : ''}
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
