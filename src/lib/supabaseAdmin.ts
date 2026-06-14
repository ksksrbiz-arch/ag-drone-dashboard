import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// Server-side Supabase client for the enrichment engine.
//
// Prefers the service-role key (full write access, bypasses RLS). Falls back to
// the public anon/publishable key — which already has write access under the
// project's permissive RLS (the dashboard advances LOI stages with it), so the
// engine still works before a service-role key is configured.
const url =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL

const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY

export type WriteMode = 'service_role' | 'anon' | 'none'

export const writeMode: WriteMode = serviceKey
  ? 'service_role'
  : anonKey
  ? 'anon'
  : 'none'

let cached: SupabaseClient | null = null

export function getAdminClient(): SupabaseClient {
  if (cached) return cached
  const key = serviceKey || anonKey
  if (!url || !key) {
    throw new Error(
      'Supabase is not configured (need SUPABASE_URL + a service-role or anon key)'
    )
  }
  cached = createClient(url, key, { auth: { persistSession: false } })
  return cached
}
