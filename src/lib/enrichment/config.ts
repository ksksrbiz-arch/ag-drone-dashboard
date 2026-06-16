import { writeMode } from '@/lib/supabaseAdmin'
import type { EngineCapabilities } from './types'

// Model + engine tuning, all overridable via environment variables so the
// pipeline can be dialed in from Vercel without code changes.
// Enrichment now runs SSOT-grounded analysis on the free, OpenAI-compatible
// models (Groq / OpenRouter) via src/lib/ai/llm.ts — no web search, no
// Anthropic credits required. ENRICHMENT_MODEL is kept for display/compat.
export const MODEL = process.env.ENRICHMENT_MODEL || 'free (groq/openrouter)'
export const MODEL_VERSION = 'lead-intel-v4'

export const EFFORT = (process.env.ENRICHMENT_EFFORT || 'medium') as
  | 'low'
  | 'medium'
  | 'high'

export const BATCH_SIZE = intEnv('ENRICHMENT_BATCH_SIZE', 6, 1, 50)
export const CONCURRENCY = intEnv('ENRICHMENT_CONCURRENCY', 3, 1, 8)
export const STALE_DAYS = intEnv('ENRICHMENT_STALE_DAYS', 7, 1, 365)
// Per-lead retry attempts on a transient research/write failure (v3).
export const RETRIES = intEnv('ENRICHMENT_RETRIES', 2, 0, 5)

// Enrichment runs whenever ANY chat provider is configured — the free Groq /
// OpenRouter models are preferred (see src/lib/ai/llm.ts), Anthropic optional.
export const AI_ENABLED = Boolean(
  process.env.GROQ_API_KEY ||
    process.env.OPENROUTER_API_KEY ||
    process.env.ANTHROPIC_API_KEY
)
export const APOLLO_ENABLED = Boolean(process.env.APOLLO_API_KEY)

/** Manual ("Run Now") triggers require the cron secret only when this is true. */
export const REQUIRE_SECRET_FOR_MANUAL =
  process.env.ENRICHMENT_REQUIRE_SECRET === 'true'

// Business context the AI researcher reasons about — sourced from the central,
// env-configurable business profile (src/lib/business.ts). Nothing is hard-coded.
export { BUSINESS_CONTEXT as COMPANY_CONTEXT } from '@/lib/business'

export function capabilities(): EngineCapabilities {
  return {
    aiEnabled: AI_ENABLED,
    apolloEnabled: APOLLO_ENABLED,
    writeMode,
    modelVersion: MODEL_VERSION,
    staleDays: STALE_DAYS,
    batchSize: BATCH_SIZE,
    concurrency: CONCURRENCY,
    retries: RETRIES,
  }
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = parseInt(raw, 10)
  if (Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
