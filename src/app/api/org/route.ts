import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET /api/org → the caller's org, its members, and the caller's own role.
export async function GET() {
  try {
    const supabase = await createSupabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 })

    const { data: me } = await supabase.from('profiles').select('id, role, org_id').eq('id', user.id).single()
    if (!me) return NextResponse.json({ ok: false, error: 'No profile' }, { status: 403 })

    const { data: org } = await supabase.from('organizations').select('id, name, slug, created_at').eq('id', me.org_id).single()
    // RLS: owners see all org profiles; non-owners see only themselves.
    const { data: members } = await supabase
      .from('profiles')
      .select('id, email, full_name, role, created_at')
      .eq('org_id', me.org_id)
      .order('created_at', { ascending: true })

    return NextResponse.json({ ok: true, org, members: members ?? [], me: { id: me.id, role: me.role } })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 })
  }
}

// PATCH /api/org { name } → rename the org (owner only, enforced by RLS).
export async function PATCH(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 }) }
  const name = String(body?.name ?? '').trim()
  if (!name) return NextResponse.json({ ok: false, error: 'name required' }, { status: 400 })
  try {
    const supabase = await createSupabaseServer()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 })
    const { data: me } = await supabase.from('profiles').select('org_id').eq('id', user.id).single()
    if (!me) return NextResponse.json({ ok: false, error: 'No profile' }, { status: 403 })
    const { data, error } = await supabase
      .from('organizations')
      .update({ name, updated_at: new Date().toISOString() })
      .eq('id', me.org_id)
      .select('id, name')
      .single()
    if (error) {
      const msg = /row-level security|permission/i.test(error.message) ? 'Only the owner can rename the org.' : error.message
      return NextResponse.json({ ok: false, error: msg }, { status: 403 })
    }
    return NextResponse.json({ ok: true, org: data })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 })
  }
}
