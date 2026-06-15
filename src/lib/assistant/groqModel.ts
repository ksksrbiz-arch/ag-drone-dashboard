// ─────────────────────────────────────────────────────────────────────────
// Groq model selection for the Sidekick assistant.
//
// The versatile build is the primary because it is the most reliable at
// tool calling — the speculative-decoding variant is faster but routinely
// emits malformed text-format tool calls that Groq rejects with a 400
// `tool_use_failed`, which breaks the agent loop. We keep the fast model as a
// last-resort fallback only. The first model that actually works is cached so
// we don't pay a failed round-trip each time.
//
// Override the whole order with GROQ_MODEL.
// ─────────────────────────────────────────────────────────────────────────

const STABLE = 'llama-3.3-70b-versatile'
const FAST = 'llama-3.3-70b-specdec'

let working: string | null = null

export function modelCandidates(): string[] {
  // STABLE first (reliable tool calling), then any explicit override, then the
  // fast model as a last resort.
  const ordered = [working, process.env.GROQ_MODEL, STABLE, FAST]
  return [...new Set(ordered.filter((m): m is string => !!m))]
}

export function noteWorkingModel(m: string) {
  working = m
}

/**
 * True when an error response is worth retrying with a different model.
 * Covers both model-unavailability (deprecated/decommissioned) and
 * `tool_use_failed` — when a model emits a malformed tool call, a more
 * reliable model in the candidate list can usually complete the same request.
 */
export function shouldTryNextModel(status: number, body: string): boolean {
  if (status !== 400 && status !== 404) return false
  return /model|decommission|does not exist|not found|deprecat|unavailable|tool_use_failed|failed to call a function/i.test(
    body
  )
}

/** @deprecated use shouldTryNextModel */
export const isModelError = shouldTryNextModel
