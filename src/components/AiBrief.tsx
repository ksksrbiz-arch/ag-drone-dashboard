'use client'

// On-page AI brief: a one-tap situational summary + next-best-action for any
// record, generated from its fields and activity timeline. Puts Ace's judgment
// directly on every detail page, not just in the chat panel.

import { useState } from 'react'

interface Brief {
  summary: string
  next_action?: string
  watch_outs?: string[]
}

export function AiBrief({
  entityType,
  entityId,
}: {
  entityType: 'lead' | 'customer' | 'job'
  entityId: string
}) {
  const [brief, setBrief] = useState<Brief | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function generate() {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      const r = await fetch('/api/ai-brief', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ entity_type: entityType, entity_id: entityId }),
      })
      const j = await r.json()
      if (j.ok) setBrief(j.brief)
      else setError(j.error ?? 'Could not generate a brief.')
    } catch (err: any) {
      setError(String(err?.message ?? err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="rounded-lg border border-brand-100 bg-brand-50/50 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-700 flex items-center gap-1">
          <span aria-hidden>✨</span> AI Brief
        </h3>
        <button
          type="button"
          onClick={generate}
          disabled={busy}
          className="tap text-xs font-medium text-brand-700 hover:text-brand-800 disabled:opacity-60"
        >
          {busy ? 'Thinking…' : brief ? 'Regenerate' : 'Generate'}
        </button>
      </div>

      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}

      {!brief && !busy && !error && (
        <p className="text-xs text-slate-500 mt-1.5">Get a quick read on where this stands and what to do next.</p>
      )}

      {brief && (
        <div className="mt-2 space-y-2">
          <p className="text-sm text-slate-700 whitespace-pre-wrap">{brief.summary}</p>
          {brief.next_action && (
            <div className="text-xs text-slate-700 bg-emerald-50 border border-emerald-100 rounded-lg p-2">
              <span className="font-semibold text-emerald-700">Next:</span> {brief.next_action}
            </div>
          )}
          {Array.isArray(brief.watch_outs) && brief.watch_outs.length > 0 && (
            <ul className="list-disc pl-4 space-y-0.5 text-xs text-amber-700">
              {brief.watch_outs.map((w, i) => <li key={i}>{w}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
