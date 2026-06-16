import type { Lead, PriorityTrend } from '@/lib/supabase'
import { getAdminClient } from '@/lib/supabaseAdmin'
import {
  AI_ENABLED,
  APOLLO_ENABLED,
  BATCH_SIZE,
  CONCURRENCY,
  MODEL,
  MODEL_VERSION,
  RETRIES,
  STALE_DAYS,
} from './config'
import { computeCompleteness } from './completeness'
import { computePriority, type PrioritySignals } from './priority'
import { researchLead } from './research'
import { apolloEnrich } from './apollo'
import type {
  EngineRunSummary,
  LeadEnrichmentOutcome,
  PriorityMover,
  ResearchResult,
} from './types'

// ─────────────────────────────────────────────────────────────────────────
// The orchestrator. Pulls a batch of leads that need attention, then for each
// lead — concurrently, with a small pool — researches it (AI + optional
// Apollo) and re-scores its priority, writing everything back to Supabase so
// the dashboard updates automatically.
//
// v3 additions:
//   • per-lead retries with exponential backoff on transient research failures
//   • a batched jobs lookup that feeds the relationship (repeat-customer) signal
//   • priority momentum — stores the previous score, the delta, and a trend
//   • richer advisory write-back (next_best_action, talking_points, explanation)
//   • token / cost accounting and a richer run summary (new P1s + movers)
//   • resilient writes that degrade gracefully across migration states
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

// Minimum absolute score change that counts as a real move — shared by the
// trend label and the "movers" list so a lead flagged up/down is always a mover.
const MOVE_THRESHOLD = 2

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
  const jobSignals = await loadJobSignals(supabase, leads.map(l => l.id))
  const nameById = new Map(leads.map(l => [l.id, leadName(l)]))

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
    enrichOne(supabase, lead, jobSignals.get(lead.id) ?? { jobCount: 0, paidJobs: 0 })
  )

  const leadsEnriched = outcomes.filter(o => o.ok).length
  const leadsFailed = outcomes.filter(o => !o.ok).length
  const aiCalls = outcomes.reduce((n, o) => n + ((o as any)._aiCalls ?? 0), 0)
  const aiTokens = outcomes.reduce((n, o) => n + ((o as any)._aiTokens ?? 0), 0)
  const newP1s = outcomes.filter(o => o.became_p1).length
  const fieldsUpdated = outcomes.reduce((n, o) => n + o.fieldsUpdated.length, 0)
  const movers = topMovers(outcomes, nameById)
  const durationMs = Date.now() - startedAt

  // Snapshot each scored lead so the dashboard can trend priority over time
  // (v4 score history). Best-effort — a missing table just skips the write.
  await recordHistory(supabase, runId, outcomes)

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
          ai_tokens: aiTokens,
          duration_ms: durationMs,
          summary: {
            tiers: tierCounts(outcomes),
            new_p1s: newP1s,
            fields_updated: fieldsUpdated,
            movers,
            errors: outcomes.filter(o => !o.ok).map(o => ({ id: o.id, error: o.error })).slice(0, 10),
          },
        })
        .eq('id', runId)
    } catch {
      // Newer audit columns (ai_tokens) may not exist yet — retry without them.
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
            summary: { tiers: tierCounts(outcomes), new_p1s: newP1s, movers },
          })
          .eq('id', runId)
      } catch {
        /* ignore audit write failures */
      }
    }
  }

  return {
    runId,
    trigger: opts.trigger,
    leadsProcessed: leads.length,
    leadsEnriched,
    leadsFailed,
    aiCalls,
    aiTokens,
    aiEnabled: AI_ENABLED,
    durationMs,
    newP1s,
    movers,
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

// Pull job counts for the batch in one query → relationship (repeat-customer)
// signal. Defensive: a missing jobs table just yields no signals.
async function loadJobSignals(
  supabase: ReturnType<typeof getAdminClient>,
  leadIds: string[]
): Promise<Map<string, PrioritySignals>> {
  const map = new Map<string, PrioritySignals>()
  if (!leadIds.length) return map
  try {
    const { data } = await supabase
      .from('jobs')
      .select('lead_id,status')
      .in('lead_id', leadIds)
    for (const j of (data ?? []) as { lead_id: string | null; status: string | null }[]) {
      if (!j.lead_id) continue
      const s = map.get(j.lead_id) ?? { jobCount: 0, paidJobs: 0 }
      s.jobCount = (s.jobCount ?? 0) + 1
      if (j.status === 'paid') s.paidJobs = (s.paidJobs ?? 0) + 1
      map.set(j.lead_id, s)
    }
  } catch {
    /* jobs table optional */
  }
  return map
}

// ── Per-lead enrichment ──────────────────────────────────────────────────
async function enrichOne(
  supabase: ReturnType<typeof getAdminClient>,
  lead: Lead,
  signals: PrioritySignals
): Promise<LeadEnrichmentOutcome & { _aiCalls?: number; _aiTokens?: number }> {
  const fieldsUpdated: string[] = []
  let aiCalls = 0
  let aiTokens = 0
  let researched = false

  const patch: Record<string, unknown> = {}

  try {
    let research: ResearchResult | null = null
    if (AI_ENABLED) {
      // Retry transient research failures (rate limits, timeouts) with backoff.
      research = await withRetry(() => researchLead(lead), RETRIES)
      aiCalls += research.ai_calls
      aiTokens += research.ai_tokens
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

      // Advisory fields are refreshed from the latest reasoning.
      patch.research_summary = research.research_summary
      patch.recommended_approach = research.recommended_approach
      patch.best_contact_method = research.best_contact_method
      merged.recommended_approach = research.recommended_approach
      // New advisory fields: only overwrite when the model produced something,
      // so a sparse pass never wipes a good prior next-step / talking points.
      if (research.next_best_action) patch.next_best_action = research.next_best_action
      if (research.talking_points) patch.talking_points = research.talking_points

      if (research.crop_types) sources.crop_types = research.crop_types
      if (research.field_sources) sources.fields = research.field_sources
      patch.enrichment_confidence = research.confidence
      patch.enrichment_sources = sources
    }

    // Always recompute the algorithmic layer (with relationship signals).
    const completeness = computeCompleteness(merged)
    const priority = computePriority(merged, signals)
    const { delta, trend } = momentum(lead.priority_score, priority.score)
    const became_p1 = lead.priority_tier !== 'P1' && priority.tier === 'P1'

    patch.data_completeness = completeness
    patch.priority_score = priority.score
    patch.priority_tier = priority.tier
    patch.priority_factors = priority.factors
    patch.priority_explanation = priority.explanation
    patch.priority_score_prev = lead.priority_score ?? null
    patch.priority_delta = delta
    patch.priority_trend = trend
    patch.last_scored_at = new Date().toISOString()
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
      priority_trend: trend,
      priority_delta: delta,
      became_p1,
      _aiCalls: aiCalls,
      _aiTokens: aiTokens,
    }
  } catch (err: any) {
    // Mark failed but still try to land an algorithmic score + momentum.
    try {
      const priority = computePriority(lead, signals)
      const { delta, trend } = momentum(lead.priority_score, priority.score)
      await applyPatch(supabase, lead.id, {
        enrichment_status: 'failed',
        enriched_at: new Date().toISOString(),
        priority_score: priority.score,
        priority_tier: priority.tier,
        priority_factors: priority.factors,
        priority_explanation: priority.explanation,
        priority_score_prev: lead.priority_score ?? null,
        priority_delta: delta,
        priority_trend: trend,
        last_scored_at: new Date().toISOString(),
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
        priority_trend: trend,
        priority_delta: delta,
        became_p1: lead.priority_tier !== 'P1' && priority.tier === 'P1',
        error: String(err?.message ?? err),
        _aiCalls: aiCalls,
        _aiTokens: aiTokens,
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
        priority_trend: 'new',
        priority_delta: null,
        became_p1: false,
        error: String(err?.message ?? err),
        _aiCalls: aiCalls,
        _aiTokens: aiTokens,
      }
    }
  }
}

// Columns introduced by later migrations — when a write hits a DB that hasn't
// run them yet, we strip these and retry so the run still lands a useful score.
const V3_COLS = new Set([
  'priority_score_prev', 'priority_delta', 'priority_trend',
  'priority_explanation', 'next_best_action', 'talking_points', 'last_scored_at',
])
const V1_COLS = new Set([
  'priority_score', 'priority_tier', 'priority_factors', 'data_completeness',
  'enrichment_status', 'enriched_at', 'enrichment_confidence', 'research_summary',
  'recommended_approach', 'best_contact_method', 'enrichment_sources',
])

// Write the patch, degrading gracefully if newer columns don't exist yet:
// full patch → without v3 columns → core legacy columns only. Only throws if
// even the legacy write fails (a real permissions/connectivity problem).
async function applyPatch(
  supabase: ReturnType<typeof getAdminClient>,
  id: string,
  patch: Record<string, unknown>
): Promise<void> {
  const attempts: Record<string, unknown>[] = [
    patch,
    omit(patch, V3_COLS),
    omit(patch, V3_COLS, V1_COLS),
  ]
  let lastError: { message?: string } | null = null
  for (let i = 0; i < attempts.length; i++) {
    const p = attempts[i]
    if (Object.keys(p).length === 0) continue
    const { error } = await supabase.from('leads').update(p).eq('id', id)
    if (!error) {
      // A degraded write (i > 0) means newer columns aren't in the schema — warn
      // once so a missing migration is visible instead of silently no-op'ing.
      if (i > 0) {
        console.warn(
          `[enrichment] lead ${id}: wrote a reduced patch (dropped ${i === 1 ? 'v3' : 'v3+v1'} columns) — ` +
            `apply the lead-intelligence migrations to enable the full feature set. (${lastError?.message ?? 'schema mismatch'})`
        )
      }
      return
    }
    lastError = error
  }
  throw new Error(
    `Supabase update failed (schema/permissions — is the lead-intelligence migration applied?): ${lastError?.message}`
  )
}

// ── helpers ──────────────────────────────────────────────────────────────
function momentum(
  prev: number | null | undefined,
  next: number
): { delta: number | null; trend: PriorityTrend } {
  if (prev == null) return { delta: null, trend: 'new' }
  const delta = Math.round((next - prev) * 10) / 10
  const trend: PriorityTrend =
    delta > MOVE_THRESHOLD ? 'up' : delta < -MOVE_THRESHOLD ? 'down' : 'flat'
  return { delta, trend }
}

function topMovers(
  outcomes: (LeadEnrichmentOutcome & { _aiCalls?: number })[],
  nameById: Map<string, string>
): PriorityMover[] {
  return outcomes
    .filter(o => o.priority_delta != null && Math.abs(o.priority_delta) > MOVE_THRESHOLD)
    .sort((a, b) => Math.abs(b.priority_delta!) - Math.abs(a.priority_delta!))
    .slice(0, 5)
    .map(o => ({
      id: o.id,
      name: nameById.get(o.id) ?? 'Lead',
      delta: o.priority_delta!,
      score: o.priority_score,
      tier: o.priority_tier,
    }))
}

function leadName(l: Lead): string {
  return l.business_name ?? l.owner_name ?? l.contact_name ?? 'Unknown'
}

// Append a score snapshot per scored lead → the v4 history timeline.
async function recordHistory(
  supabase: ReturnType<typeof getAdminClient>,
  runId: string | null,
  outcomes: LeadEnrichmentOutcome[]
): Promise<void> {
  const rows = outcomes
    .filter(o => o.priority_score != null)
    .map(o => ({
      lead_id: o.id,
      run_id: runId,
      score: o.priority_score,
      tier: o.priority_tier,
      delta: o.priority_delta,
    }))
  if (!rows.length) return
  try {
    await supabase.from('lead_score_history').insert(rows)
  } catch {
    /* history table not migrated yet — skip */
  }
}

function omit(
  obj: Record<string, unknown>,
  ...sets: Set<string>[]
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    if (sets.some(s => s.has(k))) continue
    out[k] = v
  }
  return out
}

async function withRetry<T>(fn: () => Promise<T>, attempts: number, baseMs = 300): Promise<T> {
  let lastErr: unknown
  for (let i = 0; i <= attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      if (i < attempts) await sleep(baseMs * Math.pow(3, i))
    }
  }
  throw lastErr
}

const sleep = (ms: number) => new Promise(res => setTimeout(res, ms))

function tierCounts(outcomes: LeadEnrichmentOutcome[]): Record<string, number> {
  return outcomes.reduce((acc, o) => {
    acc[o.priority_tier] = (acc[o.priority_tier] ?? 0) + 1
    return acc
  }, {} as Record<string, number>)
}

function stripInternal(
  o: LeadEnrichmentOutcome & { _aiCalls?: number; _aiTokens?: number }
): LeadEnrichmentOutcome {
  const { _aiCalls, _aiTokens, ...rest } = o
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
