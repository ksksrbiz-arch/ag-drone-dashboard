import { writeMode } from '@/lib/supabaseAdmin'
import type { EngineCapabilities } from './types'

// Model + engine tuning, all overridable via environment variables so the
// pipeline can be dialed in from Vercel without code changes.
export const MODEL = process.env.ENRICHMENT_MODEL || 'claude-opus-4-8'
export const MODEL_VERSION = 'lead-intel-v1'

export const EFFORT = (process.env.ENRICHMENT_EFFORT || 'medium') as
  | 'low'
  | 'medium'
  | 'high'

export const BATCH_SIZE = intEnv('ENRICHMENT_BATCH_SIZE', 6, 1, 50)
export const CONCURRENCY = intEnv('ENRICHMENT_CONCURRENCY', 3, 1, 8)
export const STALE_DAYS = intEnv('ENRICHMENT_STALE_DAYS', 7, 1, 365)

export const AI_ENABLED = Boolean(process.env.ANTHROPIC_API_KEY)
export const APOLLO_ENABLED = Boolean(process.env.APOLLO_API_KEY)

/** Manual ("Run Now") triggers require the cron secret only when this is true. */
export const REQUIRE_SECRET_FOR_MANUAL =
  process.env.ENRICHMENT_REQUIRE_SECRET === 'true'

// Business context the AI researcher reasons about when ranking "best options".
export const COMPANY_CONTEXT = `1COMMERCE Precision Ag is a drone-services company based in Canby, Oregon
(Willamette Valley). Core service: agricultural spraying and crop scouting with
DJI Agras T50 spray drones — especially Eastern Filbert Blight (EFB) treatment
and scouting for hazelnut orchards, plus fungicide/pesticide application for
orchards, vineyards, berries, nurseries and row crops. Secondary verticals:
aerial imaging for insurance, real estate, and construction. Ideal customers are
growers and operations within roughly 60 miles of Canby with treatable acreage
and a recurring spray or scouting need.`

export function capabilities(): EngineCapabilities {
  return {
    aiEnabled: AI_ENABLED,
    apolloEnabled: APOLLO_ENABLED,
    writeMode,
    modelVersion: MODEL_VERSION,
    staleDays: STALE_DAYS,
    batchSize: BATCH_SIZE,
    concurrency: CONCURRENCY,
  }
}

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name]
  if (!raw) return fallback
  const n = parseInt(raw, 10)
  if (Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
