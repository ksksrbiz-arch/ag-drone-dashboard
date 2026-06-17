import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import type { Vertical } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const VERTICALS: Vertical[] = [
  'ag_spray', 'insurance', 'real_estate', 'construction', 'energy',
  'mapping', 'inspection', 'survey', 'delivery',
]

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

function clip(v: unknown, max: number): string | null {
  const s = String(v ?? '').trim()
  return s ? s.slice(0, max) : null
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}

// POST /api/inbound/lead — public capture endpoint. Accepts a prospect/inquiry
// from a website form or quote page and drops it into the org's leads as
// source='inbound'. Uses the service-role client (bypasses RLS) and stamps the
// resolved org explicitly. Honeypot + basic validation guard against spam.
export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400, headers: CORS })
  }

  // Honeypot: bots fill hidden fields. Pretend success, insert nothing.
  if (clip(body?.website_url, 200) || clip(body?.company_url, 200)) {
    return NextResponse.json({ ok: true, received: true }, { headers: CORS })
  }

  const business_name = clip(body?.business_name, 200)
  const contact_name = clip(body?.contact_name, 200)
  const email = clip(body?.email, 200)
  const phone = clip(body?.phone, 50)
  const city = clip(body?.city, 120)
  const message = clip(body?.message, 2000)
  const vertical = VERTICALS.includes(body?.vertical) ? (body.vertical as Vertical) : null
  const orgSlug = clip(body?.org, 120)

  if (!business_name && !contact_name) {
    return NextResponse.json({ ok: false, error: 'A name is required.' }, { status: 400, headers: CORS })
  }
  if (!email && !phone) {
    return NextResponse.json({ ok: false, error: 'An email or phone is required.' }, { status: 400, headers: CORS })
  }
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: 'That email looks invalid.' }, { status: 400, headers: CORS })
  }

  try {
    const admin = getAdminClient()

    // Resolve the destination org: by slug, else the sole org.
    let orgId: string | null = null
    if (orgSlug) {
      const { data } = await admin.from('organizations').select('id').eq('slug', orgSlug).single()
      orgId = data?.id ?? null
      if (!orgId) return NextResponse.json({ ok: false, error: 'Unknown organization.' }, { status: 404, headers: CORS })
    } else {
      const { data } = await admin.from('organizations').select('id').limit(2)
      if ((data?.length ?? 0) === 1) orgId = data![0].id
      else return NextResponse.json({ ok: false, error: 'Organization must be specified.' }, { status: 400, headers: CORS })
    }

    // Light dedupe: same email already on file for this org → don't double-insert.
    if (email) {
      const { data: dup } = await admin.from('leads').select('id').eq('org_id', orgId).ilike('email', email).limit(1)
      if (dup?.[0]) return NextResponse.json({ ok: true, duplicate: true, message: "You're already on our list — we'll be in touch." }, { headers: CORS })
    }

    const notes = [message, '— submitted via inbound capture'].filter(Boolean).join('\n')
    const { error } = await admin.from('leads').insert({
      org_id: orgId,
      business_name,
      contact_name,
      owner_name: contact_name,
      email,
      phone,
      city,
      vertical: vertical ?? 'ag_spray',
      loi_status: 'not_contacted',
      source: 'inbound',
      tags: ['inbound'],
      notes,
    })
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500, headers: CORS })

    return NextResponse.json({ ok: true, message: "Thanks — we got your request and will be in touch shortly." }, { headers: CORS })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500, headers: CORS })
  }
}
