import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ENTITY_TYPES = ['lead', 'customer', 'job']
const KINDS = ['note', 'call', 'email', 'sms', 'meeting', 'stage', 'system']

// GET /api/activities?entity_type=lead&entity_id=...  → recent activity for one record
export async function GET(req: NextRequest) {
  const entity_type = req.nextUrl.searchParams.get('entity_type') ?? ''
  const entity_id = req.nextUrl.searchParams.get('entity_id') ?? ''
  if (!ENTITY_TYPES.includes(entity_type) || !entity_id) {
    return NextResponse.json({ ok: false, error: 'entity_type and entity_id required' }, { status: 400 })
  }
  try {
    const supabase = await createSupabaseServer()
    const { data, error } = await supabase
      .from('activities')
      .select('id, kind, body, actor_email, created_at')
      .eq('entity_type', entity_type)
      .eq('entity_id', entity_id)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true, activities: data ?? [] })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 })
  }
}

// POST /api/activities  { entity_type, entity_id, kind?, body }  → log an activity (staff, via RLS)
export async function POST(req: NextRequest) {
  let payload: any
  try {
    payload = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 })
  }
  const entity_type = String(payload?.entity_type ?? '')
  const entity_id = String(payload?.entity_id ?? '')
  const kind = KINDS.includes(payload?.kind) ? payload.kind : 'note'
  const body = String(payload?.body ?? '').trim()
  if (!ENTITY_TYPES.includes(entity_type) || !entity_id) {
    return NextResponse.json({ ok: false, error: 'entity_type and entity_id required' }, { status: 400 })
  }
  if (!body) return NextResponse.json({ ok: false, error: 'body required' }, { status: 400 })

  try {
    const supabase = await createSupabaseServer()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    const { data, error } = await supabase
      .from('activities')
      .insert({ entity_type, entity_id, kind, body, actor_id: user?.id ?? null, actor_email: user?.email ?? null })
      .select('id, kind, body, actor_email, created_at')
      .single()
    if (error) {
      // RLS denies non-staff — surface a friendly message.
      const msg = /row-level security|permission/i.test(error.message)
        ? 'You need owner/partner access to log activity.'
        : error.message
      return NextResponse.json({ ok: false, error: msg }, { status: 403 })
    }
    return NextResponse.json({ ok: true, activity: data })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 })
  }
}
