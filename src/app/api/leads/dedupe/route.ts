import { NextRequest, NextResponse } from 'next/server'
import { findDuplicateClusters, mergeLeads } from '@/lib/enrichment/dedupe'
import { requireStaffOrCron } from '@/lib/auth/guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// GET — read-only duplicate detection. Returns clusters of likely-duplicate
// leads (matched on phone / email / name+city) for review in the dashboard.
export async function GET() {
  try {
    const clusters = await findDuplicateClusters()
    return NextResponse.json({
      ok: true,
      clusters,
      clusterCount: clusters.length,
      duplicateCount: clusters.reduce((n, c) => n + (c.members.length - 1), 0),
    })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 }
    )
  }
}

// POST — non-destructive merge. Body: { primaryId, mergeIds: string[] }.
// Backfills the primary's empty fields + unions tags, then marks the duplicates
// (does not delete them). Guarded: staff session or cron secret.
export async function POST(req: NextRequest) {
  const gate = await requireStaffOrCron(req)
  if (!gate.ok) return gate.response

  let body: any
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const primaryId = String(body?.primaryId ?? '')
  const mergeIds: string[] = Array.isArray(body?.mergeIds) ? body.mergeIds.map(String) : []
  if (!primaryId || !mergeIds.length) {
    return NextResponse.json(
      { ok: false, error: 'primaryId and a non-empty mergeIds[] are required' },
      { status: 400 }
    )
  }

  try {
    const result = await mergeLeads(primaryId, mergeIds)
    return NextResponse.json(result, { status: result.ok ? 200 : 400 })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 }
    )
  }
}
