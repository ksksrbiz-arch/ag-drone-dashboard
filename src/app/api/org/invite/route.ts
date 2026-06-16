import { NextRequest, NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'
import { getAdminClient, writeMode } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const INVITABLE_ROLES = ['partner', 'affiliate'] // never 'owner'

// POST /api/org/invite { email, role } → invite a teammate into the caller's
// org. Owner only. Sends a Supabase invite email and provisions their profile
// (org + role) so they land in the right tenant on first sign-in.
export async function POST(req: NextRequest) {
  let body: any
  try { body = await req.json() } catch { return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 }) }
  const email = String(body?.email ?? '').trim().toLowerCase()
  const role = INVITABLE_ROLES.includes(body?.role) ? body.role : 'partner'
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return NextResponse.json({ ok: false, error: 'A valid email is required.' }, { status: 400 })
  }

  // 1) Caller must be the org owner.
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 })
  const { data: me } = await supabase.from('profiles').select('role, org_id').eq('id', user.id).single()
  if (!me || me.role !== 'owner') {
    return NextResponse.json({ ok: false, error: 'Only the owner can invite teammates.' }, { status: 403 })
  }

  // 2) Need the service-role key to create auth users.
  if (writeMode !== 'service_role') {
    return NextResponse.json(
      { ok: false, error: 'Inviting requires SUPABASE_SERVICE_ROLE_KEY to be configured.' },
      { status: 503 }
    )
  }

  try {
    const admin = getAdminClient()
    const redirectTo = `${req.nextUrl.origin}/login`
    const { data: invited, error: inviteErr } = await (admin.auth.admin as any).inviteUserByEmail(email, { redirectTo })
    if (inviteErr || !invited?.user) {
      const msg = /already.*registered|exists/i.test(inviteErr?.message ?? '')
        ? 'That email already has an account.'
        : (inviteErr?.message ?? 'Could not send the invite.')
      return NextResponse.json({ ok: false, error: msg }, { status: 400 })
    }

    // 3) Provision their profile into this org with the chosen role. Upsert in
    // case an auth trigger already created a default profile row.
    const { error: profErr } = await admin.from('profiles').upsert(
      { id: invited.user.id, email, role, org_id: me.org_id },
      { onConflict: 'id' }
    )
    if (profErr) return NextResponse.json({ ok: false, error: profErr.message }, { status: 500 })

    return NextResponse.json({ ok: true, invited: { id: invited.user.id, email, role } })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 })
  }
}
