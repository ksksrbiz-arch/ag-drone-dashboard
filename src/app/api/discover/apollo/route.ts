import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireStaffOrCron } from '@/lib/auth/guard'
import { categoryByKey } from '@/lib/discovery/categories'
import { apolloSearchOrganizations, apolloConfigured } from '@/lib/discovery/apollo'
import { BUSINESS } from '@/lib/business'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Location filter values for Apollo. From the business HQ state we pass a few
// accepted spellings (Apollo ORs them) since the exact format is finicky.
function defaultLocations(): string[] {
  const parts = (BUSINESS.city || '').split(',').map(s => s.trim()).filter(Boolean)
  const state = parts.length >= 2 ? parts[parts.length - 1] : parts[0]
  if (!state) return ['United States']
  return [state, `${state}, US`, `${state}, United States`]
}

// POST /api/discover/apollo — source prospects from Apollo's org database for a
// category. dryRun (default true) previews; dryRun:false inserts the new ones as
// source='apollo'. Staff/cron only (spends Apollo credits).
export async function POST(req: NextRequest) {
  const gate = await requireStaffOrCron(req)
  if (!gate.ok) return gate.response

  if (!apolloConfigured()) {
    return NextResponse.json({ ok: false, error: 'Apollo prospecting needs APOLLO_API_KEY.' }, { status: 503 })
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
  const limit = Math.min(Math.max(1, Number(body?.limit) || 25), 100)
  const locations = (typeof body?.location === 'string' && body.location.trim())
    ? [body.location.trim()]
    : defaultLocations()

  const { prospects: found, diag } = await apolloSearchOrganizations({ keywords: cat.queries, locations, perPage: limit })

  const supabase = getAdminClient()

  // Dedupe against existing leads by normalized business name.
  const { data: existing } = await supabase
    .from('leads')
    .select('business_name')
    .not('business_name', 'is', null)
  const existingSet = new Set((existing ?? []).map((r: any) => String(r.business_name).toLowerCase().trim()))
  const seen = new Set<string>()
  const candidates = found.map(f => {
    const norm = f.business_name.toLowerCase().trim()
    const dup = existingSet.has(norm) || seen.has(norm)
    seen.add(norm)
    return { ...f, dup }
  })
  const fresh = candidates.filter(c => !c.dup)

  if (dryRun) {
    return NextResponse.json({ ok: true, dryRun: true, category: cat.key, locations, found: candidates.length, newCount: fresh.length, candidates, _diag: diag })
  }

  let inserted = 0
  if (fresh.length) {
    const rows = fresh.map(f => ({
      business_name: f.business_name,
      website: f.website,
      phone: f.phone,
      city: f.city,
      state: f.state,
      vertical: cat.vertical,
      loi_status: 'not_contacted',
      source: 'apollo',
      tags: [cat.tag, 'apollo'],
      notes: f.industry ? `Apollo industry: ${f.industry}` : null,
    }))
    const { data, error } = await supabase.from('leads').insert(rows).select('id')
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    inserted = data?.length ?? 0
  }

  return NextResponse.json({ ok: true, dryRun: false, category: cat.key, locations, found: candidates.length, inserted, _diag: diag })
}
