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
  message?: string
}

const SUGGESTIONS = [
  'Open the EFB risk map',
  'How many P1 leads still need contacting?',
  'Recompute EFB risk',
  'Mark Stauffer Brothers as contacted',
]

export default function Sidekick() {
  const pathname = usePathname()
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUndo, setLastUndo] = useState<any>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  // Restore / persist the conversation across reloads.
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

  // Don't render on the auth pages.
  if (pathname.startsWith('/login') || pathname.startsWith('/auth')) return null

  function runActions(actions: ClientAction[] | undefined) {
    if (!Array.isArray(actions)) return
    let didNavigate = false
    for (const a of actions) {
      if (a.type === 'navigate' && a.path) {
        router.push(a.path)
        didNavigate = true
      }
    }
    if (!didNavigate && actions.some(a => a.type === 'refresh')) router.refresh()
  }

  async function send(text: string) {
    const q = text.trim()
    if (!q || sending) return
    setError(null)
    const next = [...messages, { role: 'user' as const, content: q }]
    setMessages(next)
    setInput('')
    setSending(true)
    try {
      const res = await fetch('/api/assistant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: next,
          context: { path: pathname, focus: getSidekickFocus() },
        }),
      })
      const json = await res.json()
      if (!res.ok || json.ok === false) {
        setError(json.error ?? res.statusText)
      } else {
        setMessages(m => [...m, { role: 'assistant', content: json.reply }])
        runActions(json.actions)
        setLastUndo(json.undo ?? null)
      }
    } catch (err: any) {
      setError(String(err?.message ?? err))
    } finally {
      setSending(false)
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
      } else {
        setError(json.error ?? res.statusText)
      }
    } catch (err: any) {
      setError(String(err?.message ?? err))
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open Sidekick"
          className="fixed bottom-5 right-5 z-[1000] inline-flex items-center gap-2 rounded-full bg-brand-500 hover:bg-brand-600 text-white shadow-lg px-4 py-3 transition-colors"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a7 7 0 0 1 7 7c0 2.4-1.2 4-2.5 5.2-.6.6-1 1.2-1.2 2H8.7c-.2-.8-.6-1.4-1.2-2C6.2 13 5 11.4 5 9a7 7 0 0 1 7-7Z" strokeLinejoin="round"/><path d="M9 21h6M10 18h4" strokeLinecap="round"/></svg>
          <span className="text-sm font-medium">Sidekick</span>
        </button>
      )}

      {/* Drawer */}
      {open && (
        <div className="fixed inset-0 z-[1000] sm:inset-auto sm:bottom-5 sm:right-5">
          <div className="absolute inset-0 bg-black/30 sm:hidden" onClick={() => setOpen(false)} />
          <div className="absolute right-0 bottom-0 sm:static flex flex-col w-full sm:w-[380px] h-[88vh] sm:h-[600px] max-h-screen bg-white sm:rounded-2xl border border-slate-200 shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100 bg-slate-800 text-white">
              <div className="flex items-center gap-2">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2a7 7 0 0 1 7 7c0 2.4-1.2 4-2.5 5.2-.6.6-1 1.2-1.2 2H8.7c-.2-.8-.6-1.4-1.2-2C6.2 13 5 11.4 5 9a7 7 0 0 1 7-7Z" strokeLinejoin="round"/></svg>
                <span className="text-sm font-semibold">Sidekick</span>
              </div>
              <div className="flex items-center gap-1">
                {messages.length > 0 && (
                  <button onClick={() => { setMessages([]); setLastUndo(null) }} className="tap-sq text-slate-300 hover:text-white text-xs px-2">Clear</button>
                )}
                <button onClick={() => setOpen(false)} aria-label="Close" className="tap-sq text-slate-300 hover:text-white text-xl leading-none">×</button>
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50">
              {messages.length === 0 ? (
                <div className="h-full flex flex-col items-center justify-center text-center gap-3 px-4">
                  <p className="text-sm text-slate-500">I can pull up data, navigate the app, and take actions. Try:</p>
                  <div className="flex flex-col gap-1.5 w-full">
                    {SUGGESTIONS.map(s => (
                      <button key={s} onClick={() => send(s)}
                        className="tap text-xs text-left bg-white hover:bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-slate-600 transition-colors">
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                messages.map((m, i) => (
                  <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[88%] rounded-2xl px-3.5 py-2 text-sm whitespace-pre-wrap ${
                      m.role === 'user' ? 'bg-brand-500 text-white rounded-br-sm' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'
                    }`}>
                      {m.content}
                    </div>
                  </div>
                ))
              )}
              {sending && (
                <div className="flex justify-start">
                  <div className="bg-white border border-slate-200 text-slate-400 rounded-2xl rounded-bl-sm px-3.5 py-2 text-sm">Working…</div>
                </div>
              )}
              {error && <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}
              {lastUndo && !sending && (
                <div className="flex justify-start">
                  <button onClick={undoLast}
                    className="tap inline-flex items-center gap-1.5 text-xs border border-slate-300 bg-white hover:bg-slate-100 text-slate-700 rounded-full px-3 py-1 transition-colors">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 7v6h6M3 13a9 9 0 1 0 3-7.7L3 8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                    Undo {String(lastUndo.label ?? 'last action')}
                  </button>
                </div>
              )}
            </div>

            {/* Input */}
            <form onSubmit={e => { e.preventDefault(); send(input) }} className="p-2.5 border-t border-slate-100 flex gap-2">
              <input
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder="Ask or tell Sidekick…"
                className="tap flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <button type="submit" disabled={sending || !input.trim()}
                className="tap inline-flex items-center justify-center text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-4 transition-colors disabled:opacity-60">
                Send
              </button>
            </form>
          </div>
        </div>
      )}
    </>
  )
}
