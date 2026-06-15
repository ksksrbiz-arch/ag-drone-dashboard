// ─────────────────────────────────────────────────────────────────────────
// Recovery for Groq's "tool_use_failed" error.
//
// The Llama models occasionally render a tool call as *text* instead of a
// structured `tool_calls` entry — e.g. `<function=navigate{"page":"leads"}>`
// or a Hermes-style `<tool_call>{"name":...,"arguments":{...}}</tool_call>`.
// Groq's server rejects this with HTTP 400 `tool_use_failed`, returning the
// offending text in `error.failed_generation`.
//
// Rather than discard the user's intent, we parse that text back into proper
// tool calls so the agent loop can still run them (navigate, fetch data, act).
// ─────────────────────────────────────────────────────────────────────────

export interface RecoveredCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

/** Pull the `failed_generation` text out of a Groq error body, if present. */
function extractFailedGeneration(body: string): string | null {
  try {
    const json = JSON.parse(body)
    const fg = json?.error?.failed_generation
    return typeof fg === 'string' && fg.trim() ? fg : null
  } catch {
    return null
  }
}

/** Read a balanced JSON object starting at `start` (which must be a `{`). */
function readJsonObject(text: string, start: number): { json: string; end: number } | null {
  if (text[start] !== '{') return null
  let depth = 0
  let inStr = false
  let esc = false
  for (let i = start; i < text.length; i++) {
    const c = text[i]
    if (inStr) {
      if (esc) esc = false
      else if (c === '\\') esc = true
      else if (c === '"') inStr = false
      continue
    }
    if (c === '"') inStr = true
    else if (c === '{') depth++
    else if (c === '}') {
      depth--
      if (depth === 0) return { json: text.slice(start, i + 1), end: i + 1 }
    }
  }
  return null // truncated / unbalanced
}

/**
 * Parse leaked text-format tool calls out of a Groq error body.
 * Returns null if nothing recoverable is found.
 */
export function recoverToolCalls(body: string): RecoveredCall[] | null {
  const text = extractFailedGeneration(body)
  if (!text) return null

  const calls: RecoveredCall[] = []

  // Form A: <function=NAME{...}> or <function=NAME>{...}
  const fnRe = /<function\s*=\s*([a-zA-Z_][\w]*)\s*>?\s*(\{)/g
  let m: RegExpExecArray | null
  while ((m = fnRe.exec(text))) {
    const name = m[1]
    const braceAt = m.index + m[0].length - 1 // position of the `{`
    const obj = readJsonObject(text, braceAt)
    if (!obj) continue
    try {
      JSON.parse(obj.json) // validate
      calls.push({ id: `recovered_${calls.length}`, type: 'function', function: { name, arguments: obj.json } })
    } catch {
      /* unparseable args — skip */
    }
  }

  // Form B: <tool_call>{"name":"NAME","arguments":{...}}</tool_call>
  const tcRe = /<tool_call>\s*(\{)/g
  while ((m = tcRe.exec(text))) {
    const obj = readJsonObject(text, m.index + m[0].length - 1)
    if (!obj) continue
    try {
      const parsed = JSON.parse(obj.json)
      const name = parsed?.name
      if (typeof name !== 'string') continue
      const args = parsed?.arguments ?? parsed?.parameters ?? {}
      calls.push({
        id: `recovered_${calls.length}`,
        type: 'function',
        function: { name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
      })
    } catch {
      /* skip */
    }
  }

  return calls.length ? calls : null
}
