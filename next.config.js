/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Public Supabase keys — safe to commit (anon key is restricted by RLS)
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://wgwuotfbowyfbskttisb.supabase.co',
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_s5iYkJMhmWefjizYsltj9w_UE-knXpb',
  },
}

module.exports = nextConfig
