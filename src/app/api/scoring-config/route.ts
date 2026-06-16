import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireStaffOrCron } from '@/lib/auth/guard'
import { SCORING_FACTORS, DEFAULT_THRESHOLDS, type ScoringConfig } from '@/lib/enrichment/priority'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET — current overrides + the built-in defaults (so the UI can render the
// full factor list and show defaults as placeholders).
export async function GET() {
  let config: ScoringConfig = {}
  try {
    const supabase = getAdminClient()
    const { data } = await supabase
      .from('scoring_config')
      .select('config')
      .eq('id', 'singleton')
      .maybeSingle()
    config = (data?.config ?? {}) as ScoringConfig
  } catch {
    /* table not migrated yet — fall back to empty (defaults in effect) */
  }
  return NextResponse.json({
    ok: true,
    config,
    defaults: { factors: SCORING_FACTORS, thresholds: DEFAULT_THRESHOLDS },
  })
}

const VALID_KEYS = new Set(SCORING_FACTORS.map(f => f.key))

function cleanWeights(w: any): Record<string, number> | undefined {
  if (!w || typeof w !== 'object') return undefined
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(w)) {
    if (VALID_KEYS.has(k) && typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v
  }
  return Object.keys(out).length ? out : undefined
}

function cleanThresholds(t: any): { p1: number; p2: number; p3: number } | undefined {
  if (!t || typeof t !== 'object') return undefined
  const n = (x: any) => (typeof x === 'number' && Number.isFinite(x) ? Math.max(0, Math.min(100, x)) : undefined)
  const p1 = n(t.p1), p2 = n(t.p2), p3 = n(t.p3)
  if (p1 == null || p2 == null || p3 == null) return undefined
  // Keep them ordered so tiers stay monotonic.
  if (!(p1 >= p2 && p2 >= p3)) return undefined
  return { p1, p2, p3 }
}

// PUT — save overrides (staff/cron guarded). Body: { config }. An empty config
// (e.g. {}) resets to the built-in defaults.
export async function PUT(req: NextRequest) {
  const gate = await requireStaffOrCron(req)
  if (!gate.ok) return gate.response

  let body: any
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const raw = body?.config ?? {}
  const cleaned: ScoringConfig = {}
  const ag = cleanWeights(raw.agWeights)
  const nonag = cleanWeights(raw.nonAgWeights)
  const th = cleanThresholds(raw.thresholds)
  if (ag) cleaned.agWeights = ag
  if (nonag) cleaned.nonAgWeights = nonag
  if (th) cleaned.thresholds = th

  try {
    const supabase = getAdminClient()
    const { error } = await supabase
      .from('scoring_config')
      .upsert({ id: 'singleton', config: cleaned })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, config: cleaned })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 })
  }
}
