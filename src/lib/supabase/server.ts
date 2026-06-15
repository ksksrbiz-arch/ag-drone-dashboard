// Server-side Supabase client (Server Components, Route Handlers).
// Reads the user's session from cookies so RLS runs AS THE LOGGED-IN USER.
// NOTE: this is the *auth* client (anon key + user session), NOT the
// service-role admin client. Keep src/lib/supabaseAdmin.ts for trusted
// server writes that must bypass RLS (enrichment engine, cron).
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createSupabaseServer() {
  const cookieStore = await cookies()
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
               process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!

  return createServerClient(url, key, {
    cookies: {
      getAll() { return cookieStore.getAll() },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options))
        } catch { /* called from a Server Component; middleware refreshes instead */ }
      },
    },
  })
}
