import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { aiConfigured } from '@/lib/ai/llm'
import { generateOutreachBatch } from '@/lib/outreach/queue'
import { requireStaffOrCron } from '@/lib/auth/guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

const VALID_STATUS = new Set(['draft', 'approved', 'sent', 'dismissed'])

// GET — list outreach drafts (optionally filtered by ?status=), newest first,
// with the linked lead's display fields embedded.
export async function GET(req: NextRequest) {
  const status = new URL(req.url).searchParams.get('status')
  const supabase = getAdminClient()
  let q = supabase
    .from('outreach_drafts')
    .select(
      '*, lead:leads(business_name,owner_name,city,primary_crop,phone,email,priority_tier)'
    )
    .order('created_at', { ascending: false })
    .limit(100)
  if (status && VALID_STATUS.has(status)) q = q.eq('status', status)
  const { data, error } = await q
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, drafts: data ?? [] })
}

// POST — generate a batch of review-first drafts for the top outreach-ready
// leads. Guarded (staff session or cron secret). Body: { limit?, channel? }.
export async function POST(req: NextRequest) {
  const gate = await requireStaffOrCron(req)
  if (!gate.ok) return gate.response

  if (!aiConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'No AI provider configured (set GROQ_API_KEY, OPENROUTER_API_KEY, or ANTHROPIC_API_KEY).' },
      { status: 503 }
    )
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const channel = body?.channel === 'sms' ? 'sms' : 'email'
  const limit = Number(body?.limit) || undefined

  try {
    const result = await generateOutreachBatch({ channel, limit })
    return NextResponse.json(result, { status: result.ok ? 200 : 500 })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 })
  }
}

// PATCH — update a draft: status transition and/or edited subject/body.
// Guarded. Body: { id, status?, subject?, body? }.
export async function PATCH(req: NextRequest) {
  const gate = await requireStaffOrCron(req)
  if (!gate.ok) return gate.response

  let body: any
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const id = String(body?.id ?? '')
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })

  const patch: Record<string, unknown> = {}
  if (body.status != null) {
    if (!VALID_STATUS.has(String(body.status))) {
      return NextResponse.json({ ok: false, error: 'invalid status' }, { status: 400 })
    }
    patch.status = body.status
  }
  if (typeof body.subject === 'string') patch.subject = body.subject
  if (typeof body.body === 'string') patch.body = body.body
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ ok: false, error: 'nothing to update' }, { status: 400 })
  }

  const supabase = getAdminClient()
  const { data, error } = await supabase
    .from('outreach_drafts')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, draft: data })
}
