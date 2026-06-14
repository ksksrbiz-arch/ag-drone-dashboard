import { NextRequest, NextResponse } from 'next/server'
import { runGeocodeBackfill } from '@/lib/efb/geocode'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Backfills lat/lon for ag-spray parcels from their street address via the free
// U.S. Census batch geocoder. Triggered by the Intel Hub "Geocode parcels"
// button and (best-effort) by the daily cron.
async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const isCron = req.headers.get('x-vercel-cron') != null
  const limit = Number(new URL(req.url).searchParams.get('limit')) || undefined
  try {
    const summary = await runGeocodeBackfill({ trigger: isCron ? 'cron' : 'manual', limit })
    return NextResponse.json({ ok: true, ...summary })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 }
    )
  }
}

export const POST = handle
export const GET = handle

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (req.headers.get('x-vercel-cron') != null) return true
  if (!secret) return true
  if (process.env.ENRICHMENT_REQUIRE_SECRET !== 'true') return true
  const auth = req.headers.get('authorization')
  if (auth === `Bearer ${secret}`) return true
  if (new URL(req.url).searchParams.get('secret') === secret) return true
  return false
}
