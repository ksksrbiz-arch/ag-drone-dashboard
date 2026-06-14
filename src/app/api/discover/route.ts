import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { categoryByKey } from '@/lib/discovery/categories'
import { discoverLeads } from '@/lib/discovery/discover'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Discover prospect businesses for a category via AI web search.
// dryRun (default true) → preview candidates; dryRun:false → insert the new ones.
export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { ok: false, error: 'Discovery runs on Claude web search — set ANTHROPIC_API_KEY.' },
      { status: 503 }
    )
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 })
  }

  const cat = categoryByKey(body?.category)
  if (!cat) return NextResponse.json({ ok: false, error: 'Unknown category' }, { status: 400 })
  const dryRun = body?.dryRun !== false
  const limit = Math.min(Math.max(1, Number(body?.limit) || 10), 20)

  const supabase = getAdminClient()

  let found
  try {
    ;({ leads: found } = await discoverLeads(cat, limit))
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 })
  }

  // Dedupe against existing leads by normalized business name.
  const { data: existing } = await supabase
    .from('leads')
    .select('business_name')
    .not('business_name', 'is', null)
  const existingSet = new Set(
    (existing ?? []).map((r: any) => String(r.business_name).toLowerCase().trim())
  )
  const seen = new Set<string>()
  const candidates = found.map(f => {
    const norm = f.business_name.toLowerCase().trim()
    const dup = existingSet.has(norm) || seen.has(norm)
    seen.add(norm)
    return { ...f, dup }
  })
  const fresh = candidates.filter(c => !c.dup)

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      category: cat.key,
      found: candidates.length,
      newCount: fresh.length,
      candidates,
    })
  }

  let inserted = 0
  if (fresh.length) {
    const rows = fresh.map(f => ({
      business_name: f.business_name,
      city: f.city,
      county: f.county,
      website: f.website,
      phone: f.phone,
      email: f.email,
      vertical: cat.vertical,
      state: 'OR',
      loi_status: 'not_contacted',
      source: 'ai_discovery',
      tags: [cat.tag],
      notes: f.notes,
    }))
    const { data, error } = await supabase.from('leads').insert(rows).select('id')
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    inserted = data?.length ?? 0
  }

  return NextResponse.json({
    ok: true,
    dryRun: false,
    category: cat.key,
    inserted,
    found: candidates.length,
    candidates,
  })
}
