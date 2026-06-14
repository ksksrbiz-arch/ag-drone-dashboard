// Browser Supabase client (cookie-based session via @supabase/ssr).
// Replaces the bare createClient() in src/lib/supabase.ts so the anon
// session is carried in cookies and visible to middleware + server.
//
//   npm install @supabase/ssr
//
// Keep your existing TYPE exports (Lead, Job, ...) in src/lib/supabase.ts
// and either (a) move the client here and re-export, or (b) replace the
// client-creation lines in src/lib/supabase.ts with createBrowserClient.
import { createBrowserClient } from '@supabase/ssr'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
const key = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
             process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY)!

export const supabase = createBrowserClient(url, key)
