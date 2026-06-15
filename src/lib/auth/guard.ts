// Guard for API route handlers that perform writes. Use on the
// unauthenticated enrichment endpoints so they require either a logged-in
// staff user OR the cron secret (Vercel Cron).
//
//   const gate = await requireStaffOrCron(request)
//   if (!gate.ok) return gate.response
import { NextResponse } from 'next/server'
import { createSupabaseServer } from '@/lib/supabase/server'

export async function requireStaffOrCron(request: Request) {
  // 1) Vercel Cron / server-to-server: Authorization: Bearer <CRON_SECRET>
  const secret = process.env.CRON_SECRET
  const auth = request.headers.get('authorization')
  if (secret && auth === `Bearer ${secret}`) return { ok: true as const }

  // 2) Logged-in staff (owner/partner)
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    const { data: profile } = await supabase
      .from('profiles').select('role').eq('id', user.id).single()
    if (profile && (profile.role === 'owner' || profile.role === 'partner')) {
      return { ok: true as const }
    }
  }

  return {
    ok: false as const,
    response: NextResponse.json({ error: 'unauthorized' }, { status: 401 }),
  }
}
