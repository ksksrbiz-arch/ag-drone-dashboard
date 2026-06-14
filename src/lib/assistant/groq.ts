import { TOOLS, runTool } from './tools'

// ─────────────────────────────────────────────────────────────────────────
// Groq inference provider for the ops assistant — OpenAI-compatible chat
// completions with tool calling. Reuses the same read-only data tools and
// runTool executor as the Claude path; only the wire format differs.
//
// Fast + cheap (open models like Llama 3.3 70B) for the interactive assistant,
// while enrichment research stays on Claude (needs Anthropic's web-search tool).
// ─────────────────────────────────────────────────────────────────────────

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL = process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
const MAX_TURNS = 6

// Our tool defs are in Anthropic shape ({name, description, input_schema});
// Groq/OpenAI want {type:'function', function:{name, description, parameters}}.
const OPENAI_TOOLS = TOOLS.map(t => ({
  type: 'function' as const,
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}))

export function groqConfigured(): boolean {
  return Boolean(process.env.GROQ_API_KEY)
}

export async function runGroqAssistant(
  userMessages: { role: string; content: string }[],
  system: string
): Promise<string> {
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
        const result = await runTool(call.function?.name, args)
        messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify(result).slice(0, 12000),
        })
      }
      continue
    }

    return (msg.content || '').trim() || 'I wasn’t able to answer that — try rephrasing?'
  }

  return 'I wasn’t able to answer that — try rephrasing?'
}
