'use client'

import { useEffect, useRef, useState } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { getSidekickFocus } from '@/lib/assistant/context'
import { ASSISTANT_NAME } from '@/lib/business'
import { streamAssistant, speechSupported, type ChatAttachment, type EntityCard } from '@/lib/assistant/streamClient'
import { extractText, isSupportedFile, ATTACH_EXT } from '@/lib/files/extractText'
import { matchSlash, resolveSlash, type SlashCommand } from '@/lib/assistant/slashCommands'
import { SlashMenu } from '@/components/assistant/SlashMenu'
import { EntityChips } from '@/components/assistant/EntityChips'
import { RichMessage } from '@/components/assistant/RichMessage'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  cards?: EntityCard[]
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
  '/leads': ['Which leads are hottest right now?', 'Break down leads by crop', 'Tag all stale P1 leads follow-up'],
  '/pipeline': ['What’s ready to contact?', 'Move all meeting-scheduled hazelnut leads to LOI sent', 'How many LOIs signed?'],
  '/customers': ['Show active customers', 'Who did we convert recently?'],
  '/jobs': ['What jobs are scheduled?', 'How much revenue is unpaid?', 'Show completed jobs'],
  '/fields': ['How many acres by crop have we mapped?', 'Map field boundaries', 'Largest fields by acreage'],
  '/field-ops': ['What needs treatment now?', 'Recompute EFB risk'],
  '/intel': ['Which parcels are TREAT NOW?', 'Recompute EFB risk', 'Open the risk map'],
  '/finance': ['What’s our outstanding A/R?', 'Revenue collected this month'],
  '/knowledge': ['What reference docs do we have?', 'What’s our per-acre rate?', 'Summarize the EFB treatment protocol'],
  '/alerts': ['Any new alerts?', 'Clear my alerts'],
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
  const [pendingAsk, setPendingAsk] = useState<string | null>(null)
  const [attachment, setAttachment] = useState<ChatAttachment | null>(null)
  const [listening, setListening] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const scrollRef = useRef<HTMLDivElement>(null)
  const abortRef = useRef<AbortController | null>(null)
  const recogRef = useRef<any>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)

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

  // Other parts of the app can ask Sidekick something:
  //   window.dispatchEvent(new CustomEvent('sidekick:ask', { detail: { query } }))
  useEffect(() => {
    const onAsk = (e: Event) => {
      const q = (e as CustomEvent).detail?.query
      if (typeof q === 'string' && q.trim()) {
        setOpen(true)
        setPendingAsk(q.trim())
      }
    }
    window.addEventListener('sidekick:ask', onAsk as EventListener)
    return () => window.removeEventListener('sidekick:ask', onAsk as EventListener)
  }, [])

  // Fire a queued ask once the panel is open and idle (avoids stale closures).
  useEffect(() => {
    if (pendingAsk && open && !sending) {
      const q = pendingAsk
      setPendingAsk(null)
      void send(q)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAsk, open, sending])

  if (pathname.startsWith('/login') || pathname.startsWith('/auth') || pathname.startsWith('/quote')) return null

  function runActions(actions: ClientAction[] | undefined) {
    if (!Array.isArray(actions)) return
    let navigated = false
    for (const a of actions) if (a.type === 'navigate' && a.path) { router.push(a.path); navigated = true }
    if (!navigated && actions.some(a => a.type === 'refresh')) router.refresh()
  }

  const appendToken = (t: string) =>
    setMessages(m => {
      const copy = [...m]
      const last = copy[copy.length - 1]
      if (last?.role === 'assistant') copy[copy.length - 1] = { ...last, content: last.content + t }
      return copy
    })

  // Core: stream one assistant turn for a history that ends with a user message.
  async function runStream(history: Msg[]) {
    setError(null)
    setStatus(null)
    setBadge(0)
    setMessages([...history, { role: 'assistant', content: '' }]) // streaming placeholder
    setSending(true)
    const ac = new AbortController()
    abortRef.current = ac
    const sentAttachment = attachment
    await streamAssistant(
      {
        messages: history,
        context: { path: pathname, focus: getSidekickFocus() },
        attachment: sentAttachment,
        signal: ac.signal,
      },
      {
        onToken: t => { setStatus(null); appendToken(t) },
        onStatus: s => setStatus(s),
        onError: e => setError(e),
        onDone: (actions, undo, cards) => {
          setLastUndo(undo ?? null)
          if (cards?.length) setMessages(m => {
            const copy = [...m]
            const last = copy[copy.length - 1]
            if (last?.role === 'assistant') copy[copy.length - 1] = { ...last, cards }
            return copy
          })
          runActions(actions)
          setStatus(null)
        },
      }
    )
    setSending(false)
    setStatus(null)
    abortRef.current = null
    if (sentAttachment) setAttachment(null) // attachment is consumed by the turn
  }

  function send(text: string) {
    const q = resolveSlash(text).trim()
    if (!q || sending) return
    setInput('')
    void runStream([...messages, { role: 'user', content: q }])
  }

  function pickSlash(c: SlashCommand) {
    if (c.run) {
      send(c.template)
    } else {
      setInput(c.template)
      inputRef.current?.focus()
    }
  }

  function stop() {
    abortRef.current?.abort()
    abortRef.current = null
    setSending(false)
    setStatus(null)
  }

  function regenerate() {
    if (sending) return
    const hist = [...messages]
    while (hist.length && hist[hist.length - 1].role === 'assistant') hist.pop()
    if (!hist.length) return
    void runStream(hist)
  }

  function toggleVoice() {
    if (!speechSupported()) return
    if (listening) {
      recogRef.current?.stop()
      return
    }
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    const r = new SR()
    r.lang = 'en-US'
    r.interimResults = true
    r.continuous = false
    r.onresult = (e: any) => {
      let s = ''
      for (let i = 0; i < e.results.length; i++) s += e.results[i][0].transcript
      setInput(s)
    }
    r.onend = () => setListening(false)
    r.onerror = () => setListening(false)
    recogRef.current = r
    setListening(true)
    r.start()
  }

  async function onAttach(files: FileList | null) {
    const f = files?.[0]
    if (f) {
      try {
        if (!isSupportedFile(f.name)) throw new Error('Use a PDF or text file.')
        setError(null)
        setStatus(`Reading ${f.name}…`)
        const text = await extractText(f)
        setAttachment({ name: f.name, text })
        setStatus(null)
      } catch (e: any) {
        setError(String(e?.message ?? e))
        setStatus(null)
      }
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text)
    } catch {}
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
          aria-label={`Open ${ASSISTANT_NAME}`}
          className="fixed bottom-5 right-5 z-[1000] inline-flex items-center gap-2 rounded-full bg-brand-500 hover:bg-brand-600 text-white shadow-lg px-4 py-3 transition-colors"
        >
          <SparkIcon />
          <span className="text-sm font-medium">{ASSISTANT_NAME}</span>
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
              <div className="flex items-center gap-2"><SparkIcon s={16} /><span className="text-sm font-semibold">{ASSISTANT_NAME}</span></div>
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
                messages.map((m, i) => {
                  const isLastAssistant = m.role === 'assistant' && i === messages.length - 1
                  return (
                    <div key={i} className={`group flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                      {m.content || m.role === 'user' ? (
                        <div className={`max-w-[88%] rounded-2xl px-3.5 py-2 text-sm ${m.role === 'user' ? 'bg-brand-500 text-white rounded-br-sm whitespace-pre-wrap' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-sm'}`}>
                          {m.role === 'assistant' && !(isLastAssistant && sending)
                            ? <RichMessage content={m.content} />
                            : <span className="whitespace-pre-wrap">{m.content}</span>}
                          {isLastAssistant && sending && <span className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-slate-400 animate-pulse" />}
                        </div>
                      ) : null}
                      {m.role === 'assistant' && <EntityChips cards={m.cards} onNavigate={() => setOpen(false)} />}
                      {m.role === 'assistant' && m.content && !(isLastAssistant && sending) && (
                        <div className="flex items-center gap-2 mt-1 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button onClick={() => copy(m.content)} className="text-[11px] text-slate-400 hover:text-slate-700">Copy</button>
                          {isLastAssistant && <button onClick={regenerate} className="text-[11px] text-slate-400 hover:text-slate-700">Regenerate</button>}
                        </div>
                      )}
                    </div>
                  )
                })
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

            {attachment && (
              <div className="px-2.5 pt-2 -mb-1">
                <span className="inline-flex items-center gap-1.5 text-xs bg-brand-50 border border-brand-200 text-brand-700 rounded-full px-2.5 py-1 max-w-full">
                  <span>📎</span>
                  <span className="truncate">{attachment.name}</span>
                  <button onClick={() => setAttachment(null)} aria-label="Remove attachment" className="text-brand-400 hover:text-brand-700">×</button>
                </span>
              </div>
            )}

            {matchSlash(input).length > 0 && (
              <div className="px-2.5"><SlashMenu items={matchSlash(input)} onPick={pickSlash} /></div>
            )}

            <form onSubmit={e => { e.preventDefault(); send(input) }} className="p-2.5 border-t border-slate-100 flex items-center gap-1.5">
              <input ref={fileRef} type="file" accept={['.pdf', ...ATTACH_EXT.filter(e => e !== 'pdf').map(e => '.' + e)].join(',')} onChange={e => onAttach(e.target.files)} className="hidden" />
              <button type="button" onClick={() => fileRef.current?.click()} aria-label="Attach a file" title="Attach a file for context" className="tap-sq text-slate-400 hover:text-slate-700 shrink-0">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" strokeLinecap="round" strokeLinejoin="round"/></svg>
              </button>
              {mounted && speechSupported() && (
                <button type="button" onClick={toggleVoice} aria-label="Voice input" title="Voice input" className={`tap-sq shrink-0 ${listening ? 'text-red-500 animate-pulse' : 'text-slate-400 hover:text-slate-700'}`}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" strokeLinecap="round" strokeLinejoin="round"/></svg>
                </button>
              )}
              <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)} placeholder={listening ? 'Listening…' : 'Ask, tell, or “/” for commands…'} className="tap flex-1 min-w-0 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500" />
              {sending ? (
                <button type="button" onClick={stop} className="tap inline-flex items-center justify-center text-sm bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium rounded-lg px-3 py-2 transition-colors shrink-0" title="Stop">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
                </button>
              ) : (
                <button type="submit" disabled={!input.trim()} className="tap inline-flex items-center justify-center text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-4 py-2 transition-colors disabled:opacity-60 shrink-0">Send</button>
              )}
            </form>
          </div>
        </div>
      )}
    </>
  )
}
