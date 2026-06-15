'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { getSidekickFocus } from '@/lib/assistant/context'

interface Msg {
  role: 'user' | 'assistant'
  content: string
}
interface ClientAction {
  type: 'navigate' | 'refresh' | 'toast'
  path?: string
}

// Page-aware starter prompts — what's most useful given where the user is.
const DEFAULT_SUGGESTIONS = [
  'Show me Marion P1 leads',
  'Tag all stale P1 hazelnut leads follow-up',
  'Recompute EFB risk',
  'Any new alerts?',
]
const PAGE_SUGGESTIONS: Record<string, string[]> = {
  '/leads': ['Which leads are hottest right now?', 'How many grass-seed leads in Polk County?', 'Tag all stale P1 leads follow-up'],
  '/pipeline': ['What’s ready to contact?', 'Move all meeting-scheduled hazelnut leads to LOI sent', 'How many LOIs signed?'],
  '/customers': ['Show active customers', 'Who did we convert recently?'],
  '/jobs': ['What jobs are scheduled?', 'How much revenue is unpaid?', 'Show completed jobs'],
  '/fields': ['How many acres have we mapped?', 'Map field boundaries', 'Largest fields by acreage'],
  '/field-ops': ['What needs treatment now?', 'Recompute EFB risk'],
  '/intel': ['Which parcels are TREAT NOW?', 'Recompute EFB risk', 'Open the risk map'],
  '/finance': ['What’s our unpaid invoice total?', 'Revenue collected this month'],
  '/knowledge': ['What reference docs do we have?', 'What’s our per-acre rate?', 'Summarize the EFB treatment protocol'],
  '/alerts': ['Any new alerts?', 'What needs attention?'],
}
function suggestionsFor(pathname: string): string[] {
  for (const [prefix, list] of Object.entries(PAGE_SUGGESTIONS))
    if (pathname === prefix || pathname.startsWith(prefix + '/')) return list
  return DEFAULT_SUGGESTIONS
}

const SparkIcon = ({ s = 18 }: { s?: number }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a7 7 0 0 1 7 7c0 2.4-1.2 4-2.5 5.2-.6.6-1 1.2-1.2 2H8.7c-.2-.8-.6-1.4-1.2-2C6.2 13 5 11.4 5 9a7 7 0 0 1 7-7Z" strokeLinejoin="round"/><path d="M9 21h6M10 18h4" strokeLinecap="round"/></svg>
)

export default function Sidekick() {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastUndo, setLastUndo] = useState<any>(null)
  const [nudge, setNudge] = useState<string | null>(null)
  const [badge, setBadge] = useState(0)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending, status])

  // Restore / persist the conversation.
  useEffect(() => {
    try {
      const saved = localStorage.getItem('sidekick:chat')
      if (saved) setMessages(JSON.parse(saved).slice(-30))
    } catch {}
  }, [])
  useEffect(() => {
    try {
      localStorage.setItem('sidekick:chat', JSON.stringify(messages.slice(-30)))
    } catch {}
  }, [messages])

  // Proactive nudge (badge + greeting).
  useEffect(() => {
    fetch('/api/assistant/nudge')
      .then(r => r.json())
      .then(j => {
        if (j?.ok) {
          setBadge(j.badge ?? 0)
          setNudge(j.text ?? null)
        }
      })
      .catch(() => {})
  }, [])

  // ⌘K / Ctrl-K toggles the panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen(o => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (pathname.startsWith('/login') || pathname.startsWith('/auth')) return null

  function runActions(actions: ClientAction[] | undefined) {
    if (!Array.isArray(actions)) return
    let navigated = false
    for (const a of actions) if (a.type === 'navigate' && a.path) { router.push(a.path); navigated = true }
    if (!navigated && actions.some(a => a.type === 'refresh')) router.refresh()
  }

  async function send(text: string) {
    const q = text.trim()
    if (!q || sending) return
    setError(null)
    setStatus(null)
    const next = [...messages, { role: 'user' as const, content: q }]
    setMessages([...next, { role: 'assistant', content: '' }]) // streaming placeholder
    setInput('')
    setSending(true)
    setBadge(0)

    const appendToken = (t: string) =>
      setMessages(m => {
        const copy = [...m]
        const last = copy[copy.length - 1]
        if (last?.role === 'assistant') copy[copy.length - 1] = { ...last, content: last.content + t }
        return copy
      })

    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next, context: { path: pathname, focus: getSidekickFocus() }, stream: true }),
      })
      if (!res.ok || !res.body) throw new Error(`Request failed (${res.status})`)

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop() ?? ''
        for (const line of lines) {
          const t = line.trim()
          if (!t.startsWith('data:')) continue
          let e: any
          try { e = JSON.parse(t.slice(5).trim()) } catch { continue }
          if (e.type === 'token') { setStatus(null); appendToken(e.text) }
          else if (e.type === 'status') setStatus(e.text)
          else if (e.type === 'error') setError(e.error)
          else if (e.type === 'done') { setLastUndo(e.undo ?? null); runActions(e.actions); setStatus(null) }
        }
      }
    } catch (err: any) {
      setError(String(err?.message ?? err))
    } finally {
      setSending(false)
      setStatus(null)
    }
  }

  async function undoLast() {
    if (!lastUndo || sending) return
    const undo = lastUndo
    setLastUndo(null)
    setSending(true)
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ undo, context: { path: pathname } }),
      })
      const json = await res.json()
      if (res.ok && json.ok !== false) {
        setMessages(m => [...m, { role: 'assistant', content: json.reply }])
        runActions(json.actions)
      } else setError(json.error ?? res.statusText)
    } catch (err: any) {
      setError(String(err?.message ?? err))
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open Sidekick"
          className="fixed bottom-5 right-5 z-[1000] inline-flex items-center gap-2 rounded-full bg-brand-500 hover:bg-brand-600 text-white shadow-lg px-4 py-3 transition-colors"
        >
          <SparkIcon />
          <span className="text-sm font-medium">Sidekick</span>
          {badge > 0 && (
            <span className="ml-0.5 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[11px] font-bold rounded-full bg-white text-brand-600">{badge}</span>
          )}
        </button>
      )}

      {open && (
        <div className="fixed inset-0 z-[1000] sm:inset-auto sm:bottom-5 sm:right-5">
          <div className="absolute inset-0 bg-black/30 sm:hidden" onClick={() => setOpen(false)} />
          <div className="absolute right-0 bottom-0 sm:static flex flex-col w-full sm:w-[380px] h-[88vh] sm:h-[600px] max-h-screen bg-white sm:rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-800 text-white">
              <div className="flex items-center gap-2"><SparkIcon s={16} /><span className="text-sm font-semibold">Sidekick</span></div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && <button onClick={() => { setMessages([]); setLastUndo(null) }} className="tap-sq text-slate-300 hover:text-white text-xs px-2">Clear</button>}
                <button onClick={() => setOpen(false)} aria-label="Close" className="tap-sq text-slate-300 hover:text-white text-xl leading-none">×</button>
              </div>
            </div>

            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-4">
                  {nudge && (
                    <div className="text-sm text-slate-700 bg-white border border-slate-200 rounded-xl px-3.5 py-2.5 text-left w-full">{nudge}</div>
                  )}
                  <p className="text-sm text-slate-500">I can pull up data, navigate, and take actions. Try:</p>
                  <div className="flex flex-col gap-1.5 w-full">
                    {suggestionsFor(pathname).map(s => (
                      <button key={s} onClick={() => send(s)} className="tap text-xs text-left bg-white hover:bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-slate-600 transition-colors">{s}</button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    {m.content || m.role === 'user' ? (
                      <div className={`max-w-[88%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-brand-500 text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'}`}>
                        {m.content}
                        {m.role === 'assistant' && i === messages.length - 1 && sending && <span className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-slate-400 animate-pulse" />}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
              {status && (
                <div className="flex justify-start"><div className="bg-white border border-slate-200 text-slate-400 rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm italic">{status}</div></div>
              )}
              {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
              {lastUndo && !sending && (
                <div className="flex justify-start">
                  <button onClick={undoLast} className="tap inline-flex items-center gap-1.5 text-xs border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 rounded-full px-3 py-1 transition-colors">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    Undo {String(lastUndo.label ?? 'last action')}
                  </button>
                </div>
              )}
            </div>

            <form onSubmit={e => { e.preventDefault(); send(input) }} className="p-2.5 border-t border-slate-100 flex gap-2">
              <input value={input} onChange={e => setInput(e.target.value)} placeholder="Ask or tell Sidekick…" className="tap flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500" />
              <button type="submit" disabled={sending || !input.trim()} className="tap inline-flex items-center justify-center text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-4 transition-colors disabled:opacity-60">Send</button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
