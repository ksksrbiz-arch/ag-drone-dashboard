import type { Lead } from '@/lib/supabase'
import { getAdminClient, writeMode } from '@/lib/supabaseAdmin'
import { assessEfb, type EfbAssessment } from './scoring'

// ─────────────────────────────────────────────────────────────────────────
// EFB recompute engine (server-side orchestrator).
//
// Pulls ag-spray parcels that carry satellite/weather signal, runs the
// deterministic EFB assessment over each, and writes the refreshed composite
// risk, action recommendation, factor breakdown, confidence, spray-window and
// risk-trend back to the DB — so the Intel Hub always reflects the latest model.
//
// Fully additive & defensive: if the EFB-intelligence migration hasn't been
// applied, it transparently falls back to writing only the legacy columns that
// already exist, so a run is never a hard failure.
// ─────────────────────────────────────────────────────────────────────────

export interface EfbRunOptions {
  trigger: 'cron' | 'manual'
  limit?: number
  /** Recompute every parcel, not just those missing a fresh assessment. */
  full?: boolean
}

export interface EfbParcelOutcome {
  id: string
  ok: boolean
  composite: number
  action: string
  band: string
  trend: 'rising' | 'falling' | 'steady'
  error?: string
}

export interface EfbRunSummary {
  runId: string | null
  trigger: string
  parcelsProcessed: number
  parcelsUpdated: number
  treatNow: number
  alertsRaised: number
  durationMs: number
  writeMode: typeof writeMode
  outcomes: EfbParcelOutcome[]
}

const BATCH = 200

export async function runEfbRecompute(opts: EfbRunOptions): Promise<EfbRunSummary> {
  const startedAt = Date.now()
  const supabase = getAdminClient()
  const limit = Math.min(opts.limit ?? BATCH, 500)

  const { data } = await supabase
    .from('leads')
    .select('*')
    .eq('vertical', 'ag_spray')
    .order('updated_at', { ascending: true })
    .limit(limit)

  const parcels = (data ?? []) as Lead[]

  // Open an audit row (no-op if the efb_runs table isn't migrated yet).
  let runId: string | null = null
  try {
    const { data: run } = await supabase
      .from('efb_runs')
      .insert({ status: 'running', trigger: opts.trigger })
      .select('id')
      .single()
    runId = run?.id ?? null
  } catch {
    /* audit table not migrated — continue */
  }

  let parcelsUpdated = 0
  let treatNow = 0
  let alertsRaised = 0
  const outcomes: EfbParcelOutcome[] = []

  for (const parcel of parcels) {
    try {
      const assessment = assessEfb(parcel)
      const prev = parcel.composite_efb_risk
      const trend = trendOf(prev, assessment.composite)
      const flippedToTreat =
        assessment.action === 'TREAT_NOW' && parcel.action_recommendation !== 'TREAT_NOW'

      await writeAssessment(supabase, parcel.id, assessment, trend)
      parcelsUpdated++
      if (assessment.action === 'TREAT_NOW') treatNow++

      // Raise an alert on a fresh escalation into TREAT_NOW (best-effort; the DB
      // trigger may also fire, but this covers installs without the trigger).
      if (flippedToTreat) {
        const raised = await raiseAlert(supabase, parcel, assessment)
        if (raised) alertsRaised++
      }

      outcomes.push({
        id: parcel.id,
        ok: true,
        composite: assessment.composite,
        action: assessment.action,
        band: assessment.band,
        trend,
      })
    } catch (err: any) {
      outcomes.push({
        id: parcel.id,
        ok: false,
        composite: 0,
        action: 'MONITOR',
        band: 'low',
        trend: 'steady',
        error: String(err?.message ?? err),
      })
    }
  }

  const durationMs = Date.now() - startedAt

  if (runId) {
    try {
      await supabase
        .from('efb_runs')
        .update({
          status: 'completed',
          finished_at: new Date().toISOString(),
          parcels_processed: parcels.length,
          parcels_updated: parcelsUpdated,
          treat_now: treatNow,
          alerts_raised: alertsRaised,
          duration_ms: durationMs,
        })
        .eq('id', runId)
    } catch {
      /* ignore audit write failures */
    }
  }

  return {
    runId,
    trigger: opts.trigger,
    parcelsProcessed: parcels.length,
    parcelsUpdated,
    treatNow,
    alertsRaised,
    durationMs,
    writeMode,
    outcomes,
  }
}

function trendOf(prev: number | null, next: number): 'rising' | 'falling' | 'steady' {
  if (prev == null) return 'steady'
  const delta = next - prev
  if (delta >= 5) return 'rising'
  if (delta <= -5) return 'falling'
  return 'steady'
}

async function writeAssessment(
  supabase: ReturnType<typeof getAdminClient>,
  id: string,
  a: EfbAssessment,
  trend: string
): Promise<void> {
  const patch: Record<string, unknown> = {
    composite_efb_risk: a.composite,
    action_recommendation: a.action,
    efb_factors: a.factors,
    efb_confidence: a.confidence,
    spray_window_status: a.sprayWindow,
    spray_window_score: a.sprayWindowScore,
    risk_trend: trend,
    efb_recomputed_at: new Date().toISOString(),
  }

  const { error } = await supabase.from('leads').update(patch).eq('id', id)
  if (!error) return

  // New columns missing → write only the legacy ones so the run still helps.
  const legacy = {
    composite_efb_risk: a.composite,
    action_recommendation: a.action,
  }
  const { error: legacyErr } = await supabase.from('leads').update(legacy).eq('id', id)
  if (legacyErr) {
    throw new Error(
      `EFB write failed (apply the efb-intelligence migration?): ${legacyErr.message}`
    )
  }
}

async function raiseAlert(
  supabase: ReturnType<typeof getAdminClient>,
  parcel: Lead,
  a: EfbAssessment
): Promise<boolean> {
  try {
    const name = parcel.business_name ?? parcel.owner_name ?? 'Parcel'
    await supabase.from('alerts').insert({
      type: 'treat_now',
      severity: 'critical',
      lead_id: parcel.id,
      title: `${name} — treat now`,
      body: `${parcel.primary_crop ?? 'Orchard'} · EFB risk ${a.composite}/100 · ${a.summary}`,
    })
    return true
  } catch {
    return false
  }
}
