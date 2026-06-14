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

  try {
    const summary = await runEnrichment({ trigger, limit })

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

    return NextResponse.json({ ok: true, ...summary })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 }
    )
  }
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
