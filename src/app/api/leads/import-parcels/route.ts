import { NextRequest, NextResponse } from 'next/server'
import { importParcels } from '@/lib/leads/parcel-import'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300

// Imports qualified agricultural parcels (owner + acreage + crop + true polygon)
// from the parcel API into the leads table. Quota-aware: bills per record the
// provider returns, so keep perCountyTarget / perZipFetchCap modest.
//
//   POST /api/leads/import-parcels?counties=Clackamas,Yamhill,Polk&target=50&dryRun=true
async function handle(req: NextRequest) {
  if (!authorized(req)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }
  const url = new URL(req.url)
  const counties = url.searchParams.get('counties')?.split(',').map(s => s.trim()).filter(Boolean)
  const target = Number(url.searchParams.get('target')) || undefined
  const fetchCap = Number(url.searchParams.get('fetchCap')) || undefined
  const dryRun = url.searchParams.get('dryRun') === 'true'

  try {
    const summary = await importParcels({
      counties,
      perCountyTarget: target,
      perZipFetchCap: fetchCap,
      dryRun,
    })
    return NextResponse.json({ ok: true, ...summary })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 })
  }
}

export const POST = handle

function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return true
  if (process.env.ENRICHMENT_REQUIRE_SECRET !== 'true') return true
  const auth = req.headers.get('authorization')
  if (auth === `Bearer ${secret}`) return true
  if (new URL(req.url).searchParams.get('secret') === secret) return true
  return false
}
