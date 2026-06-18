// ─────────────────────────────────────────────────────────────────────────
// Free Groq model selection for the assistant — auto-switching, no paid models.
//
// The agent walks an ordered pool of FREE Groq models and uses the first one
// that works, automatically switching to the next on rate limits (429),
// overload (5xx), decommissioning, or a fumbled tool call. The 70B versatile
// build leads because it's the most reliable at tool calling; the rest are
// fallbacks so a rate-limited or unavailable model never dead-ends the chat.
// The first model that actually works is cached so we don't re-pay failed
// round-trips. Override the whole order with GROQ_MODEL.
// ─────────────────────────────────────────────────────────────────────────

// Ordered best-tool-caller → fast-last-resort. All free on Groq; any that are
// unavailable in a given account simply get skipped by the fallthrough logic.
const POOL = [
  'llama-3.3-70b-versatile',                       // primary — most reliable tools
  'openai/gpt-oss-120b',                           // strong reasoning + tool use
  'moonshotai/kimi-k2-instruct',                   // strong tool caller
  'meta-llama/llama-4-maverick-17b-128e-instruct', // large context fallback
  'llama-3.1-8b-instant',                          // fast last resort
]

let working: string | null = null

export function modelCandidates(): string[] {
  // Cached working model first, then any explicit override, then the pool.
  const ordered = [working, process.env.GROQ_MODEL, ...POOL]
  return [...new Set(ordered.filter((m): m is string => !!m))]
}

export function noteWorkingModel(m: string) {
  working = m
}

/**
 * True when an error response is worth retrying with a DIFFERENT free model:
 *   • 429 — rate-limited (Groq limits are per-model, so another model helps)
 *   • 500 / 503 — model overloaded/unavailable right now
 *   • 400/404 with a model/tool-call error — decommissioned model or a
 *     `tool_use_failed` a more reliable model can usually complete.
 * On any of these the agent transparently switches to the next free model.
 */
export function shouldTryNextModel(status: number, body: string): boolean {
  if (status === 429 || status === 500 || status === 503) {
    // ...unless the body says we're out of daily/account quota (no model helps).
    if (/quota|insufficient|billing|exceeded your current/i.test(body)) return false
    return true
  }
  if (status !== 400 && status !== 404) return false
  return /model|decommission|does not exist|not found|deprecat|unavailable|tool_use_failed|failed to call a function/i.test(
    body
  )
}

/** @deprecated use shouldTryNextModel */
export const isModelError = shouldTryNextModel
