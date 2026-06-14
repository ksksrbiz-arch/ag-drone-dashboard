import { NextRequest, NextResponse } from 'next/server'
import { runEnrichment } from '@/lib/enrichment/engine'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// On-demand enrichment for a single lead (the per-lead "Refresh intel" action).
// Next 15: route-handler `params` is async and must be awaited.
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  try {
    const summary = await runEnrichment({ trigger: 'single', leadId: id })
    return NextResponse.json({ ok: true, ...summary })
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: String(err?.message ?? err) },
      { status: 500 }
    )
  }
}
