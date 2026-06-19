import { NextRequest, NextResponse } from 'next/server'
import { runEnrichment } from '@/lib/enrichment/engine'
import { REQUIRE_SECRET_FOR_MANUAL } from '@/lib/enrichment/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // allow long web-research batches (Pro plan)

// Triggered by Vercel Cron (see vercel.json) and by the dashboard "Run Now"
// button. Runs one enrichment batch: research + (re)prioritize a slice of leads.
async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const isCron = req.headers.get('x-vercel-cron') != null
  const trigger = isCron ? 'cron' : 'manual'

  const limit = Number(new URL(req.url).searchParams.get('limit')) || undefined

  // The enrichment batch is the headline step, but the daily maintenance,
  // proactive alerts and digest must still run (and reach Slack) even if it
  // fails — a flaky research API shouldn't cost staff their morning briefing.
  let summary: Awaited<ReturnType<typeof runEnrichment>> | null = null
  let enrichError: string | null = null
  try {
    summary = await runEnrichment({ trigger, limit })
  } catch (err: any) {
    enrichError = String(err?.message ?? err)
  }

  // On the daily cron, also recompute EFB satellite risk for every parcel —
  // folded into the existing schedule so Hobby's one-cron limit still holds.
  if (isCron) {
    try {
      // Geocode any parcels still missing coordinates, then recompute EFB risk.
      const { runGeocodeBackfill } = await import('@/lib/efb/geocode')
      await runGeocodeBackfill({ trigger: 'cron', limit: 1000 })
    } catch {
      /* geocoding is best-effort on the shared cron */
    }
    try {
      const { runEfbRecompute } = await import('@/lib/efb/engine')
      await runEfbRecompute({ trigger: 'cron', limit: 500 })
    } catch {
      /* EFB recompute is best-effort on the shared cron */
    }
    try {
      // Pull true parcel boundaries for newly-geocoded leads (free county GIS).
      const { runBoundaryBackfill } = await import('@/lib/fields/parcel-boundaries')
      await runBoundaryBackfill({ trigger: 'cron', limit: 500 })
    } catch {
      /* boundary backfill is best-effort on the shared cron */
    }
  }

  // Push any *new* urgent transitions (treat-now / new P1) to Slack right
  // away — on cron and on manual "Run Now" alike — so staff hear about them
  // within seconds, not at tomorrow's digest. Deduped via alerts.notified_at.
  try {
    const { postNewAlertsToSlack } = await import('@/lib/alerts')
    await postNewAlertsToSlack()
  } catch {
    /* proactive alerts are best-effort */
  }

  // On the daily cron, post the ops digest to Slack (best-effort). Folds the
  // digest into the existing cron so we don't need a second schedule.
  if (isCron) {
    try {
      const { buildDigest, narrateDigest, postDigestToSlack } = await import('@/lib/digest')
      const digest = await buildDigest()
      await postDigestToSlack(await narrateDigest(digest))
    } catch {
      /* digest is best-effort */
    }
  }

  // Surface the enrichment error for monitoring (and the "Run Now" UI), but
  // note that the rest of the run still completed.
  if (enrichError) {
    return NextResponse.json(
      { ok: false, error: enrichError, downstream_completed: true },
      { status: 500 }
    )
  }
  return NextResponse.json({ ok: true, ...summary })
}

export const POST = handle
export const GET = handle // Vercel Cron issues GET requests

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET

  // Vercel Cron requests are always allowed.
  if (req.headers.get('x-vercel-cron') != null) return true

  // No secret configured, or manual triggers not locked down → allow.
  if (!secret) return true
  if (!REQUIRE_SECRET_FOR_MANUAL) return true

  const auth = req.headers.get('authorization')
  if (auth === `Bearer ${secret}`) return true
  if (new URL(req.url).searchParams.get('secret') === secret) return true
  return false
}
