// Shared types for the Lead Intelligence Engine.

/** Structured output of the AI web-research + reasoning pass for one lead. */
export interface ResearchResult {
  business_name: string | null
  owner_name: string | null
  contact_name: string | null
  primary_crop: string | null
  crop_types: string[] | null
  phone: string | null
  email: string | null
  website: string | null
  est_acreage: number | null
  /** "best options for us specifically" — how we should approach this lead. */
  recommended_approach: string | null
  best_contact_method: string | null
  research_summary: string | null
  /** 0..1 — how confident the research is overall. */
  confidence: number
  /** field name -> source URL / citation that backs the value. */
  field_sources: Record<string, string>
  /** Number of model calls the research pass consumed (for cost accounting). */
  ai_calls: number
}

/** Capabilities of the engine in the current environment (no secrets). */
export interface EngineCapabilities {
  aiEnabled: boolean
  apolloEnabled: boolean
  writeMode: 'service_role' | 'anon' | 'none'
  modelVersion: string
  staleDays: number
  batchSize: number
  concurrency: number
}

/** Per-lead result of one enrichment cycle. */
export interface LeadEnrichmentOutcome {
  id: string
  ok: boolean
  researched: boolean
  fieldsUpdated: string[]
  priority_score: number
  priority_tier: string
  data_completeness: number
  error?: string
}

/** Summary of a full engine run. */
export interface EngineRunSummary {
  runId: string | null
  trigger: 'cron' | 'manual' | 'single'
  leadsProcessed: number
  leadsEnriched: number
  leadsFailed: number
  aiCalls: number
  aiEnabled: boolean
  durationMs: number
  outcomes: LeadEnrichmentOutcome[]
}
