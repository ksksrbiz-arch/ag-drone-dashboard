'use client'

import { useEffect, useRef, useState } from 'react'

interface Msg {
  role: 'user' | 'assistant'
  content: string
}

const SUGGESTIONS = [
  'How many P1 leads still need contacting?',
  'Which grass-seed leads in Marion County are hottest?',
  'What’s our outstanding A/R and paid revenue?',
  'How many acres of fields have we mapped?',
]

export default function AssistantPage() {
  const [messages, setMessages] = useState<Msg[]>([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

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
        body: JSON.stringify({ messages: next }),
      })
      const json = await res.json()
      if (!res.ok || json.ok === false) {
        setError(json.error ?? res.statusText)
      } else {
        setMessages(m => [...m, { role: 'assistant', content: json.reply }])
      }
    } catch (err: any) {
      setError(String(err?.message ?? err))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="p-6 md:p-8 max-w-3xl mx-auto animate-fade flex flex-col h-full min-h-[70vh]">
      <div className="mb-4 shrink-0">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Ops Assistant</h1>
        <p className="text-slate-500 text-sm mt-0.5">Ask about leads, customers, jobs, fields & finances — answered from live data</p>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto bg-white rounded-xl border border-slate-200 shadow-card p-4 space-y-4"
      >
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center gap-4">
            <div className="text-4xl">🤖</div>
            <p className="text-sm text-slate-400 max-w-sm">
              I can answer questions about your operation using live dashboard data. Try one:
            </p>
            <div className="flex flex-wrap justify-center gap-2 max-w-md">
              {SUGGESTIONS.map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="tap text-xs text-left bg-slate-50 hover:bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-slate-600 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((m, i) => (
            <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-brand-500 text-white rounded-br-sm'
                    : 'bg-slate-100 text-slate-800 rounded-bl-sm'
                }`}
              >
                {m.content}
              </div>
            </div>
          ))
        )}
        {sending && (
          <div className="flex justify-start">
            <div className="bg-slate-100 text-slate-400 rounded-2xl rounded-bl-sm px-4 py-2.5 text-sm">
              Thinking…
            </div>
          </div>
        )}
        {error && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>
        )}
      </div>

      <form
        onSubmit={e => {
          e.preventDefault()
          send(input)
        }}
        className="mt-3 flex gap-2 shrink-0"
      >
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Ask the assistant…"
          className="tap flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="tap inline-flex items-center justify-center text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-5 transition-colors disabled:opacity-60"
        >
          Send
        </button>
      </form>
    </div>
  )
}
