import { NextResponse } from 'next/server'
import { writeMode } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Lightweight capability probe for the EFB engine — surfaced on the Automation
// page so ops can see at a glance whether recompute writes will land.
export async function GET() {
  return NextResponse.json({
    ok: true,
    engine: 'efb-intel-v1',
    writeMode,
    canWrite: writeMode !== 'none',
  })
}
