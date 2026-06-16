import { TOOLS, runTool, type ToolContext, type ClientAction, type UndoSpec, type EntityCard } from './tools'
import { modelCandidates, noteWorkingModel, shouldTryNextModel } from './groqModel'
import { recoverToolCalls } from './recover'

// ─────────────────────────────────────────────────────────────────────────
// Groq inference provider for the Sidekick assistant — OpenAI-compatible chat
// completions with tool calling. Reuses the same tools + runTool executor as
// the Claude path. Returns the reply plus any client actions (navigation /
// refresh) the tools queued, so the UI can drive itself.
//
// Free + fast (Llama 3.3 70B). Used by default since it needs no Anthropic credits.
// ─────────────────────────────────────────────────────────────────────────

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
// Generous turn budget so the agent can chain several tools (look up → act →
// verify) within one request instead of stopping short.
const MAX_TURNS = 10
const MAX_TOKENS = 2048

const OPENAI_TOOLS = TOOLS.map(t => ({
  type: 'function' as const,
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}))

export function groqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY)
}

/**
 * Last-resort answer with NO tools attached, so a model that keeps fumbling
 * tool calls (tool_use_failed) can still respond in plain language or ask a
 * clarifying question instead of dead-ending. Returns '' if even this fails.
 */
export async function answerWithoutTools(key: string, messages: any[]): Promise<string> {
  const msgs = [
    ...messages,
    {
      role: 'user',
      content:
        'Answer my last request directly, in plain language. If it needed data you could not retrieve, say what you can do or ask one short clarifying question. Do not mention tools or functions.',
    },
  ]
  for (const model of modelCandidates()) {
    const res = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, messages: msgs, max_tokens: MAX_TOKENS, temperature: 0.3 }),
    })
    if (res.ok) {
      const json = await res.json()
      noteWorkingModel(model)
      return String(json?.choices?.[0]?.message?.content ?? '').trim()
    }
    const body = await res.text().catch(() => '')
    if (!shouldTryNextModel(res.status, body)) break
  }
  return ''
}

export async function runGroqAssistant(
  userMessages: { role: string; content: string }[],
  system: string,
  ctx: ToolContext
): Promise<{ reply: string; actions: ClientAction[]; undo: UndoSpec | null; cards: EntityCard[] }> {
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
    let res: Response | null = null
    let lastErr = ''
    let lastBody = ''
    for (const model of modelCandidates()) {
      res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, tools: OPENAI_TOOLS, tool_choice: 'auto', max_tokens: MAX_TOKENS, temperature: 0.2 }),
      })
      if (res.ok) {
        noteWorkingModel(model)
        break
      }
      lastBody = await res.text()
      lastErr = `Groq ${res.status}: ${lastBody.slice(0, 300)}`
      // A model that's unavailable or fumbled the tool call — try the next
      // candidate. Anything else is a real error.
      if (!shouldTryNextModel(res.status, lastBody)) throw new Error(lastErr)
    }

    let msg: any
    if (res && res.ok) {
      const json = await res.json()
      msg = json?.choices?.[0]?.message
      if (!msg) throw new Error('Groq returned no message')
    } else {
      // Every candidate failed — most likely tool_use_failed, where the model
      // leaked a text-format tool call. Recover it so the user's intent (open a
      // page, fetch data, run an action) still happens.
      const recovered = recoverToolCalls(lastBody)
      if (!recovered) {
        console.error('[groq] all model candidates failed:', lastErr)
        // If earlier turns already queued actions (e.g. navigation), confirm those.
        if (ctx.actions.some(a => a.type === 'navigate')) return { reply: 'Opening that for you.', actions: ctx.actions, undo: ctx.undo ?? null, cards: ctx.cards ?? [] }
        if (ctx.actions.length) return { reply: 'Done.', actions: ctx.actions, undo: ctx.undo ?? null, cards: ctx.cards ?? [] }
        // Otherwise make one tool-free attempt so a malformed tool call doesn't dead-end.
        const text = await answerWithoutTools(key, messages).catch(() => '')
        return {
          reply: text || 'Sorry, I had trouble with that one — try rephrasing it?',
          actions: ctx.actions,
          undo: ctx.undo ?? null,
          cards: ctx.cards ?? [],
        }
      }
      msg = { role: 'assistant', content: null, tool_calls: recovered }
    }
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
    return { reply, actions: ctx.actions, undo: ctx.undo ?? null, cards: ctx.cards ?? [] }
  }

  return { reply: 'I wasn’t able to finish that — try rephrasing?', actions: ctx.actions, undo: ctx.undo ?? null, cards: ctx.cards ?? [] }
}
