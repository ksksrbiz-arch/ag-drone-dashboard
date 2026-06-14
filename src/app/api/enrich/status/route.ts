import { NextResponse } from 'next/server'
import { capabilities } from '@/lib/enrichment/config'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Lightweight health/capability probe for the Automation dashboard. Reports
// engine configuration (no secrets) plus the most recent run.
export async function GET() {
  const caps = capabilities()

  let latestRun = null
  try {
    const supabase = getAdminClient()
    const { data } = await supabase
      .from('enrichment_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(1)
    latestRun = data?.[0] ?? null
  } catch {
    /* table not migrated yet */
  }

  return NextResponse.json({ capabilities: caps, latestRun })
}
