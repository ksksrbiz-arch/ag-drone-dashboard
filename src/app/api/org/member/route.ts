import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { getAdminClient, writeMode } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ASSIGNABLE_ROLES = ['partner', 'affiliate'] // owner can't be reassigned here

// Owner-only guard returning the caller's org.
async function requireOwner() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 }) }
  const { data: me } = await supabase.from('profiles').select('id, role, org_id').eq('id', user.id).single()
  if (!me || me.role !== 'owner') {
    return { error: NextResponse.json({ ok: false, error: 'Owner only.' }, { status: 403 }) }
  }
  return { me }
}

// Verify a target profile is a non-owner member of the caller's org.
async function loadTarget(admin: ReturnType<typeof getAdminClient>, id: string, orgId: string) {
  const { data } = await admin.from('profiles').select('id, role, org_id').eq('id', id).single()
  if (!data || data.org_id !== orgId) return { error: 'Member not found in your org.' as const }
  if (data.role === 'owner') return { error: 'The owner cannot be changed here.' as const }
  return { target: data }
}

// PATCH /api/org/member { id, role } → change a teammate's role.
export async function PATCH(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 }) }
  const id = String(body?.id ?? '')
  const role = body?.role
  if (!id || !ASSIGNABLE_ROLES.includes(role)) {
    return NextResponse.json({ ok: false, error: 'id and a valid role (partner|affiliate) required' }, { status: 400 })
  }
  const gate = await requireOwner()
  if ('error' in gate) return gate.error
  if (id === gate.me.id) return NextResponse.json({ ok: false, error: 'You cannot change your own role.' }, { status: 400 })

  const admin = getAdminClient()
  const t = await loadTarget(admin, id, gate.me.org_id)
  if ('error' in t) return NextResponse.json({ ok: false, error: t.error }, { status: 400 })

  const { error } = await admin.from('profiles').update({ role }).eq('id', id)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, id, role })
}

// DELETE /api/org/member?id=... → remove a teammate (deletes their account).
export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id') ?? ''
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
  const gate = await requireOwner()
  if ('error' in gate) return gate.error
  if (id === gate.me.id) return NextResponse.json({ ok: false, error: 'You cannot remove yourself.' }, { status: 400 })
  if (writeMode !== 'service_role') {
    return NextResponse.json({ ok: false, error: 'Removing members requires SUPABASE_SERVICE_ROLE_KEY.' }, { status: 503 })
  }

  const admin = getAdminClient()
  const t = await loadTarget(admin, id, gate.me.org_id)
  if ('error' in t) return NextResponse.json({ ok: false, error: t.error }, { status: 400 })

  const { error } = await (admin.auth.admin as any).deleteUser(id)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  // Explicitly drop the profile too, in case it isn't cascaded from auth.users.
  await admin.from('profiles').delete().eq('id', id)
  return NextResponse.json({ ok: true, removed: id })
}
