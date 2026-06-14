import type { Lead } from '@/lib/supabase'
import { getAdminClient, writeMode } from '@/lib/supabaseAdmin'
import {
  AI_ENABLED,
  APOLLO_ENABLED,
  BATCH_SIZE,
  CONCURRENCY,
  MODEL,
  MODEL_VERSION,
  STALE_DAYS,
} from './config'
import { computeCompleteness } from './completeness'
import { computePriority } from './priority'
import { researchLead } from './research'
import { apolloEnrich } from './apollo'
import type {
  EngineRunSummary,
  LeadEnrichmentOutcome,
  ResearchResult,
} from './types'

// ─────────────────────────────────────────────────────────────────────────
// The orchestrator. Pulls a batch of leads that need attention, then for each
// lead — concurrently, with a small pool — researches it (AI + optional
// Apollo) and re-scores its priority, writing everything back to Supabase so
// the dashboard updates automatically.
// ─────────────────────────────────────────────────────────────────────────

interface RunOptions {
  trigger: 'cron' | 'manual' | 'single'
  leadId?: string // when set, enrich just this one lead
  limit?: number
}

const IDENTITY_FIELDS = [
  'business_name',
  'owner_name',
  'contact_name',
  'primary_crop',
  'phone',
  'email',
  'website',
  'est_acreage',
] as const

const HIGH_CONFIDENCE = 0.8

export async function runEnrichment(opts: RunOptions): Promise<EngineRunSummary> {
  const startedAt = Date.now()
  const supabase = getAdminClient()

  // Backend-side stale sweep (no-op until the intelligence_backend migration
  // is applied — the RPC just returns an error we ignore).
  if (!opts.leadId) {
    await supabase.rpc('mark_stale_leads', { p_days: STALE_DAYS }).then(
      () => {},
      () => {}
    )
  }

  const leads = await selectLeads(supabase, opts)

  // Open an audit row so the dashboard can show a run in progress.
  let runId: string | null = null
  try {
    const { data } = await supabase
      .from('enrichment_runs')
      .insert({
        status: 'running',
        trigger: opts.trigger,
        ai_enabled: AI_ENABLED,
        model_version: MODEL_VERSION,
      })
      .select('id')
      .single()
    runId = data?.id ?? null
  } catch {
    /* audit table not yet migrated — keep going */
  }

  const outcomes = await mapPool(leads, CONCURRENCY, lead =>
    enrichOne(supabase, lead)
  )

  const leadsEnriched = outcomes.filter(o => o.ok).length
  const leadsFailed = outcomes.filter(o => !o.ok).length
  const aiCalls = outcomes.reduce(
    (n, o) => n + ((o as any)._aiCalls ?? 0),
    0
  )
  const durationMs = Date.now() - startedAt

  if (runId) {
    try {
      await supabase
        .from('enrichment_runs')
        .update({
          status: 'completed',
          finished_at: new Date().toISOString(),
          leads_processed: leads.length,
          leads_enriched: leadsEnriched,
          leads_failed: leadsFailed,
          ai_calls: aiCalls,
          duration_ms: durationMs,
          summary: { tiers: tierCounts(outcomes) },
        })
        .eq('id', runId)
    } catch {
      /* ignore audit write failures */
    }
  }

  return {
    runId,
    trigger: opts.trigger,
    leadsProcessed: leads.length,
    leadsEnriched,
    leadsFailed,
    aiCalls,
    aiEnabled: AI_ENABLED,
    durationMs,
    outcomes: outcomes.map(stripInternal),
  }
}

// ── Lead selection ───────────────────────────────────────────────────────
async function selectLeads(
  supabase: ReturnType<typeof getAdminClient>,
  opts: RunOptions
): Promise<Lead[]> {
  if (opts.leadId) {
    const { data } = await supabase
      .from('leads')
      .select('*')
      .eq('id', opts.leadId)
      .limit(1)
    return (data ?? []) as Lead[]
  }

  const limit = opts.limit ?? BATCH_SIZE
  const staleCutoff = new Date(
    Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000
  ).toISOString()

  // Priority queue: never-enriched and failed leads first, then anything whose
  // enrichment has gone stale. `or` keeps it to a single round-trip.
  const { data } = await supabase
    .from('leads')
    .select('*')
    .or(
      `enrichment_status.is.null,enrichment_status.eq.pending,enrichment_status.eq.failed,enrichment_status.eq.stale,enriched_at.lt.${staleCutoff}`
    )
    .order('enriched_at', { ascending: true, nullsFirst: true })
    .limit(limit)

  if (data && data.length) return data as Lead[]

  // Fallback: brand-new install where the columns don't exist yet — just take
  // the oldest-touched leads so the first run still does useful work.
  const { data: fallback } = await supabase
    .from('leads')
    .select('*')
    .order('updated_at', { ascending: true })
    .limit(limit)
  return (fallback ?? []) as Lead[]
}

// ── Per-lead enrichment ──────────────────────────────────────────────────
async function enrichOne(
  supabase: ReturnType<typeof getAdminClient>,
  lead: Lead
): Promise<LeadEnrichmentOutcome & { _aiCalls?: number }> {
  const fieldsUpdated: string[] = []
  let aiCalls = 0
  let researched = false

  const patch: Record<string, unknown> = {}

  try {
    let research: ResearchResult | null = null
    if (AI_ENABLED) {
      research = await researchLead(lead)
      aiCalls += research.ai_calls
      researched = true
    }

    // Work against a merged view so completeness + priority reflect new data.
    const merged: Lead = { ...lead }
    const sources: Record<string, unknown> = {
      ...(lead.enrichment_sources ?? {}),
    }

    if (research) {
      // Optional Apollo booster fills contact gaps the web research missed.
      if (APOLLO_ENABLED) {
        const apollo = await apolloEnrich({ ...lead, ...research } as Lead)
        research = {
          ...research,
          contact_name: research.contact_name ?? apollo.contact_name,
          email: research.email ?? apollo.email,
          phone: research.phone ?? apollo.phone,
        }
        if (apollo.email || apollo.phone || apollo.contact_name) {
          sources.apollo = apollo
        }
      }

      for (const f of IDENTITY_FIELDS) {
        const incoming = (research as any)[f]
        if (incoming == null || incoming === '') continue
        const existing = (lead as any)[f]
        const isEmpty =
          existing == null || (typeof existing === 'string' && !existing.trim())
        const confidentOverride =
          !isEmpty &&
          research.confidence >= HIGH_CONFIDENCE &&
          String(existing) !== String(incoming)

        if (isEmpty || confidentOverride) {
          if (confidentOverride) sources[`prev_${f}`] = existing
          ;(merged as any)[f] = incoming
          patch[f] = incoming
          fieldsUpdated.push(f)
        }
      }

      // Advisory fields are always refreshed from the latest reasoning.
      patch.research_summary = research.research_summary
      patch.recommended_approach = research.recommended_approach
      patch.best_contact_method = research.best_contact_method
      merged.recommended_approach = research.recommended_approach

      if (research.crop_types) sources.crop_types = research.crop_types
      if (research.field_sources)
        sources.fields = research.field_sources
      patch.enrichment_confidence = research.confidence
      patch.enrichment_sources = sources
    }

    // Always recompute the algorithmic layer.
    const completeness = computeCompleteness(merged)
    const priority = computePriority(merged)

    patch.data_completeness = completeness
    patch.priority_score = priority.score
    patch.priority_tier = priority.tier
    patch.priority_factors = priority.factors
    patch.enrichment_status = 'enriched'
    patch.enriched_at = new Date().toISOString()

    // Auto-tag (additive) via the cheap inference layer (Groq/OpenRouter/Claude).
    // Best-effort — never blocks the enrichment write. Disable with ENRICHMENT_AUTOTAG=false.
    if (process.env.ENRICHMENT_AUTOTAG !== 'false') {
      try {
        const { suggestLeadTags } = await import('@/lib/ai/tagging')
        const newTags = await suggestLeadTags(merged)
        if (newTags.length) {
          patch.tags = Array.from(new Set([...((lead.tags as string[]) ?? []), ...newTags]))
          fieldsUpdated.push('tags')
        }
      } catch {
        /* tagging is best-effort */
      }
    }

    await applyPatch(supabase, lead.id, patch)

    return {
      id: lead.id,
      ok: true,
      researched,
      fieldsUpdated,
      priority_score: priority.score,
      priority_tier: priority.tier,
      data_completeness: completeness,
      _aiCalls: aiCalls,
    }
  } catch (err: any) {
    // Mark failed but still try to land an algorithmic score.
    try {
      const priority = computePriority(lead)
      await applyPatch(supabase, lead.id, {
        enrichment_status: 'failed',
        enriched_at: new Date().toISOString(),
        priority_score: priority.score,
        priority_tier: priority.tier,
        priority_factors: priority.factors,
        data_completeness: computeCompleteness(lead),
      })
      return {
        id: lead.id,
        ok: false,
        researched,
        fieldsUpdated,
        priority_score: priority.score,
        priority_tier: priority.tier,
        data_completeness: computeCompleteness(lead),
        error: String(err?.message ?? err),
        _aiCalls: aiCalls,
      }
    } catch {
      return {
        id: lead.id,
        ok: false,
        researched,
        fieldsUpdated,
        priority_score: 0,
        priority_tier: 'P4',
        data_completeness: 0,
        error: String(err?.message ?? err),
        _aiCalls: aiCalls,
      }
    }
  }
}

// Write the patch; if newly-added columns don't exist yet (migration not run),
// retry with only the columns that predate this feature so the run still helps.
async function applyPatch(
  supabase: ReturnType<typeof getAdminClient>,
  id: string,
  patch: Record<string, unknown>
): Promise<void> {
  const { error } = await supabase.from('leads').update(patch).eq('id', id)
  if (!error) return

  const legacyAllowed = new Set([
    'business_name',
    'owner_name',
    'contact_name',
    'primary_crop',
    'phone',
    'email',
    'website',
    'est_acreage',
  ])
  const legacy: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(patch)) {
    if (legacyAllowed.has(k)) legacy[k] = v
  }
  if (Object.keys(legacy).length) {
    await supabase.from('leads').update(legacy).eq('id', id)
  }
  // Surface schema problems so the caller can tell the user to run the migration.
  throw new Error(
    `Supabase update failed (have you applied the lead-intelligence migration?): ${error.message}`
  )
}

// ── helpers ──────────────────────────────────────────────────────────────
function tierCounts(outcomes: LeadEnrichmentOutcome[]): Record<string, number> {
  return outcomes.reduce((acc, o) => {
    acc[o.priority_tier] = (acc[o.priority_tier] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)
}

function stripInternal(
  o: LeadEnrichmentOutcome & { _aiCalls?: number }
): LeadEnrichmentOutcome {
  const { _aiCalls, ...rest } = o
  return rest
}

/** Run `fn` over `items` with at most `size` in flight at once. */
async function mapPool<T, R>(
  items: T[],
  size: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let cursor = 0
  const workers = Array.from({ length: Math.min(size, items.length) }, async () => {
    while (true) {
      const i = cursor++
      if (i >= items.length) break
      results[i] = await fn(items[i])
    }
  })
  await Promise.all(workers)
  return results
}

export const engineMeta = { model: MODEL, modelVersion: MODEL_VERSION }
