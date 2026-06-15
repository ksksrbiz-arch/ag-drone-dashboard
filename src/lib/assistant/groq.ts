import { TOOLS, runTool, type ToolContext, type ClientAction, type UndoSpec } from './tools'

// ─────────────────────────────────────────────────────────────────────────
// Groq inference provider for the Sidekick assistant — OpenAI-compatible chat
// completions with tool calling. Reuses the same tools + runTool executor as
// the Claude path. Returns the reply plus any client actions (navigation /
// refresh) the tools queued, so the UI can drive itself.
//
// Free + fast (Llama 3.3 70B). Used by default since it needs no Anthropic credits.
// ─────────────────────────────────────────────────────────────────────────

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
const MAX_TURNS = 6

const OPENAI_TOOLS = TOOLS.map(t => ({
  type: 'function' as const,
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}))

export function groqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY)
}

export async function runGroqAssistant(
  userMessages: { role: string; content: string }[],
  system: string,
  ctx: ToolContext
): Promise<{ reply: string; actions: ClientAction[]; undo: UndoSpec | null }> {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY is not set')

  const messages: any[] = [
    { role: 'system', content: system },
    ...userMessages.slice(-12).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content ?? ''),
    })),
  ]

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: GROQ_MODEL,
        messages,
        tools: OPENAI_TOOLS,
        tool_choice: 'auto',
        max_tokens: 1500,
        temperature: 0.2,
      }),
    })

    if (!res.ok) {
      const body = await res.text()
      throw new Error(`Groq ${res.status}: ${body.slice(0, 300)}`)
    }

    const json = await res.json()
    const msg = json?.choices?.[0]?.message
    if (!msg) throw new Error('Groq returned no message')
    messages.push(msg)

    const toolCalls = msg.tool_calls
    if (Array.isArray(toolCalls) && toolCalls.length > 0) {
      for (const call of toolCalls) {
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(call.function?.arguments || '{}')
        } catch {
          /* malformed args — pass empty */
        }
        const result = await runTool(call.function?.name, args, ctx)
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result).slice(0, 12000),
        })
      }
      continue
    }

    let reply = (msg.content || '').trim()
    if (!reply) {
      // The model occasionally returns no text after a tool call — synthesize a
      // confirmation so the user never sees an empty bubble.
      reply = ctx.actions.some(a => a.type === 'navigate')
        ? 'Opening that for you.'
        : 'Done.'
    }
    return { reply, actions: ctx.actions, undo: ctx.undo ?? null }
  }

  return { reply: 'I wasn’t able to finish that — try rephrasing?', actions: ctx.actions, undo: ctx.undo ?? null }
}
