// ─────────────────────────────────────────────────────────────────────────
// Groq model selection for the Sidekick assistant.
//
// Prefers a faster model (llama-3.3-70b speculative decoding, ~6x throughput)
// but falls back to the rock-solid versatile build if the fast one isn't
// available on the account/region (Groq deprecates models). The first model
// that actually works is cached so we don't pay a failed round-trip each time.
//
// Override the whole order with GROQ_MODEL.
// ─────────────────────────────────────────────────────────────────────────

const FAST = 'llama-3.3-70b-specdec'
const STABLE = 'llama-3.3-70b-versatile'

let working: string | null = null

export function modelCandidates(): string[] {
  const ordered = [working, process.env.GROQ_MODEL, FAST, STABLE]
  return [...new Set(ordered.filter((m): m is string => !!m))]
}

export function noteWorkingModel(m: string) {
  working = m
}

/** True when an error response means the model itself is unavailable. */
export function isModelError(status: number, body: string): boolean {
  if (status !== 400 && status !== 404) return false
  return /model|decommission|does not exist|not found|deprecat|unavailable/i.test(body)
}
