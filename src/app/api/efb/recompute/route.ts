import { NextRequest, NextResponse } from 'next/server'
import { runEfbRecompute } from '@/lib/efb/engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Recomputes EFB risk for ag-spray parcels. Triggered by the Intel Hub
// "Recompute risk" button and (optionally) by Vercel Cron.
async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const isCron = req.headers.get('x-vercel-cron') != null
  const url = new URL(req.url)
  const limit = Number(url.searchParams.get('limit')) || undefined
  const full = url.searchParams.get('full') === 'true'

  try {
    const summary = await runEfbRecompute({
      trigger: isCron ? 'cron' : 'manual',
      limit,
      full,
    })
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
  if (req.headers.get('x-vercel-cron') != null) return true
  if (!secret) return true
  if (process.env.ENRICHMENT_REQUIRE_SECRET !== 'true') return true
  const auth = req.headers.get('authorization')
  if (auth === `Bearer ${secret}`) return true
  if (new URL(req.url).searchParams.get('secret') === secret) return true
  return false
}
