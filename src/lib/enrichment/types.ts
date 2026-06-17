// Shared types for the Lead Intelligence Engine.

import type { PriorityTrend } from '@/lib/supabase'

/** Structured output of the AI analysis + reasoning pass for one lead. */
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
  /** v3: the single most useful concrete next step for this lead. */
  next_best_action: string | null
  /** v3: 2–4 short, grounded points to raise in outreach. */
  talking_points: string[] | null
  /** 0..1 — how confident the analysis is overall. */
  confidence: number
  /** field name -> source URL / citation that backs the value. */
  field_sources: Record<string, string>
  /** Number of model calls the research pass consumed (for cost accounting). */
  ai_calls: number
  /** v3: total tokens the research pass consumed (for cost accounting). */
  ai_tokens: number
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
  /** v3: per-lead retry attempts on transient research/write failures. */
  retries: number
  /** Active AI provider + model used for analysis (null if none configured). */
  aiProvider?: string | null
  aiModel?: string | null
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
  /** v3: momentum vs. the previous run. */
  priority_trend: PriorityTrend
  priority_delta: number | null
  /** v3: true when this run moved the lead into P1 from a lower tier. */
  became_p1: boolean
  error?: string
}

/** A notable priority move within a run (for the summary + dashboard). */
export interface PriorityMover {
  id: string
  name: string
  delta: number
  score: number
  tier: string
}

/** Summary of a full engine run. */
export interface EngineRunSummary {
  runId: string | null
  trigger: 'cron' | 'manual' | 'single'
  leadsProcessed: number
  leadsEnriched: number
  leadsFailed: number
  aiCalls: number
  /** v3: total tokens consumed across the batch. */
  aiTokens: number
  aiEnabled: boolean
  durationMs: number
  /** v3: count of leads that rose into P1 this run. */
  newP1s: number
  /** v3: the biggest priority swings this run (gainers + decliners). */
  movers: PriorityMover[]
  outcomes: LeadEnrichmentOutcome[]
}
