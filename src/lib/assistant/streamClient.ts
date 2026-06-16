// Shared client for talking to /api/assistant over SSE, used by both the
// Sidekick drawer and the full Assistant page so they behave identically
// (streaming tokens, tool status, queued client actions, undo).

export interface ChatAttachment {
  name: string
  text: string
}

export interface EntityCard {
  kind: 'lead' | 'customer' | 'job' | 'field'
  id: string
  title: string
  subtitle?: string
  href: string
}

export interface StreamHandlers {
  onToken: (t: string) => void
  onStatus: (s: string) => void
  onError: (e: string) => void
  onDone: (actions: any[] | undefined, undo: any, cards: EntityCard[]) => void
}

export interface StreamOptions {
  messages: { role: string; content: string }[]
  context?: Record<string, unknown>
  attachment?: ChatAttachment | null
  signal?: AbortSignal
}

/** Stream an assistant turn. Resolves when the stream ends (or aborts). */
export async function streamAssistant(opts: StreamOptions, h: StreamHandlers): Promise<void> {
  const context = { ...(opts.context ?? {}) }
  if (opts.attachment) (context as any).attachment = opts.attachment

  let res: Response
  try {
    res = await fetch('/api/assistant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: opts.messages, context, stream: true }),
      signal: opts.signal,
    })
  } catch (err: any) {
    if (err?.name === 'AbortError') return
    h.onError(String(err?.message ?? err))
    return
  }

  if (!res.ok || !res.body) {
    h.onError(`Request failed (${res.status})`)
    return
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  try {
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
        try {
          e = JSON.parse(t.slice(5).trim())
        } catch {
          continue
        }
        if (e.type === 'token') h.onToken(e.text)
        else if (e.type === 'status') h.onStatus(e.text)
        else if (e.type === 'error') h.onError(e.error)
        else if (e.type === 'done') h.onDone(e.actions, e.undo ?? null, Array.isArray(e.cards) ? e.cards : [])
      }
    }
  } catch (err: any) {
    if (err?.name !== 'AbortError') h.onError(String(err?.message ?? err))
  }
}

/** Web Speech API availability + a tiny recognizer wrapper for voice input. */
export function speechSupported(): boolean {
  return typeof window !== 'undefined' && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
}
