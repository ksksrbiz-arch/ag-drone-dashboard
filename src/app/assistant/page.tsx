'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { streamAssistant, speechSupported, type ChatAttachment, type EntityCard } from '@/lib/assistant/streamClient'
import { extractText, isSupportedFile, ATTACH_EXT } from '@/lib/files/extractText'
import { matchSlash, resolveSlash, type SlashCommand } from '@/lib/assistant/slashCommands'
import { SlashMenu } from '@/components/assistant/SlashMenu'
import { EntityChips } from '@/components/assistant/EntityChips'
import { ASSISTANT_NAME } from '@/lib/business'

interface Msg {
  role: 'user' | 'assistant'
  content: string
  cards?: EntityCard[]
}
interface ClientAction {
  type: 'navigate' | 'refresh' | 'toast'
  path?: string
}

const SUGGESTIONS = [
  'How many P1 leads still need contacting?',
  'Break down leads by crop type',
  'What’s our outstanding A/R and paid revenue?',
  'How many acres by crop have we mapped?',
]

export default function AssistantPage() {
  const router = useRouter()
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [lastUndo, setLastUndo] = useState<any>(null)
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

  async function runStream(history: Msg[]) {
    setError(null)
    setStatus(null)
    setMessages([...history, { role: 'assistant', content: '' }])
    setSending(true)
    const ac = new AbortController()
    abortRef.current = ac
    const sentAttachment = attachment
    await streamAssistant(
      { messages: history, context: { path: '/assistant' }, attachment: sentAttachment, signal: ac.signal },
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
    if (sentAttachment) setAttachment(null)
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
    if (listening) { recogRef.current?.stop(); return }
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
    try { await navigator.clipboard.writeText(text) } catch {}
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
        body: JSON.stringify({ undo, context: { path: '/assistant' } }),
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
    <div className="p-4 sm:p-6 md:p-8 max-w-3xl mx-auto animate-fade flex flex-col h-full min-h-[70vh]">
      <div className="mb-4 shrink-0 flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{ASSISTANT_NAME}</h1>
          <p className="text-slate-500 text-sm mt-0.5">Ask about leads, customers, jobs, fields &amp; finances — or tell me to take an action. Answered from live data.</p>
        </div>
        {messages.length > 0 && (
          <button onClick={() => { setMessages([]); setLastUndo(null) }} className="tap text-xs text-slate-400 hover:text-slate-700 shrink-0 mt-1">Clear</button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto bg-white rounded-xl border border-slate-200 shadow-card p-4 space-y-4">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-4">
            <div className="text-4xl">🤖</div>
            <p className="text-sm text-slate-400 max-w-sm">I can answer from live data, navigate the app, take actions, and read a file you attach. Try one:</p>
            <div className="flex flex-wrap justify-center gap-2 max-w-md">
              {SUGGESTIONS.map(s => (
                <button key={s} onClick={() => send(s)} className="tap text-xs text-left bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-slate-600 transition-colors">{s}</button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => {
            const isLastAssistant = m.role === 'assistant' && i === messages.length - 1
            return (
              <div key={i} className={`group flex flex-col ${m.role === 'user' ? 'items-end' : 'items-start'}`}>
                {m.content || m.role === 'user' ? (
                  <div className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${m.role === 'user' ? 'bg-brand-500 text-white rounded-br-sm' : 'bg-slate-100 text-slate-800 rounded-bl-sm'}`}>
                    {m.content}
                    {isLastAssistant && sending && <span className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-slate-400 animate-pulse" />}
                  </div>
                ) : null}
                {m.role === 'assistant' && <EntityChips cards={m.cards} />}
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
          <div className="flex justify-start"><div className="bg-slate-100 text-slate-400 rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm italic">{status}</div></div>
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
        <div className="mt-2">
          <span className="inline-flex items-center gap-1.5 text-xs bg-brand-50 border border-brand-200 text-brand-700 rounded-full px-2.5 py-1">
            <span>📎</span>
            <span className="truncate max-w-[240px]">{attachment.name}</span>
            <button onClick={() => setAttachment(null)} aria-label="Remove attachment" className="text-brand-400 hover:text-brand-700">×</button>
          </span>
        </div>
      )}

      {matchSlash(input).length > 0 && (
        <div className="mt-2"><SlashMenu items={matchSlash(input)} onPick={pickSlash} /></div>
      )}

      <form onSubmit={e => { e.preventDefault(); send(input) }} className="mt-3 flex items-center gap-1.5 shrink-0">
        <input ref={fileRef} type="file" accept={['.pdf', ...ATTACH_EXT.filter(e => e !== 'pdf').map(e => '.' + e)].join(',')} onChange={e => onAttach(e.target.files)} className="hidden" />
        <button type="button" onClick={() => fileRef.current?.click()} aria-label="Attach a file" title="Attach a file for context" className="tap-sq text-slate-400 hover:text-slate-700 shrink-0">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" strokeLinecap="round" strokeLinejoin="round"/></svg>
        </button>
        {mounted && speechSupported() && (
          <button type="button" onClick={toggleVoice} aria-label="Voice input" title="Voice input" className={`tap-sq shrink-0 ${listening ? 'text-red-500 animate-pulse' : 'text-slate-400 hover:text-slate-700'}`}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" strokeLinecap="round" strokeLinejoin="round"/></svg>
          </button>
        )}
        <input ref={inputRef} value={input} onChange={e => setInput(e.target.value)} placeholder={listening ? 'Listening…' : 'Ask the assistant, or “/” for commands…'} className="tap flex-1 min-w-0 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500" />
        {sending ? (
          <button type="button" onClick={stop} className="tap inline-flex items-center justify-center text-sm bg-slate-200 hover:bg-slate-300 text-slate-700 font-medium rounded-lg px-4 py-2 transition-colors shrink-0" title="Stop">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>
          </button>
        ) : (
          <button type="submit" disabled={!input.trim()} className="tap inline-flex items-center justify-center text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-5 py-2 transition-colors disabled:opacity-60 shrink-0">Send</button>
        )}
      </form>
    </div>
  )
}
