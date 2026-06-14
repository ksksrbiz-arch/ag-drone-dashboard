'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { BRAND_NAME } from '@/lib/business'

// Magic-link sign-in. Supabase emails a one-time link that returns to
// /auth/callback, which exchanges the code for a session cookie.
function LoginInner() {
  const params = useSearchParams()
  const next = params.get('next') ?? '/'
  const authError = params.get('error')

  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(
    authError ? 'That sign-in link was invalid or expired — request a new one.' : null
  )

  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      const redirect = `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirect },
      })
      if (error) setError(error.message)
      else setSent(true)
    } catch (err: any) {
      setError(String(err?.message ?? err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-card p-7">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">{BRAND_NAME}</h1>
        <p className="text-sm text-slate-500 mt-1 mb-6">Sign in to access the dashboard.</p>

        {sent ? (
          <div className="text-sm rounded-lg border border-green-200 bg-green-50 text-green-800 px-4 py-3">
            Check your email — we sent a sign-in link to <span className="font-medium">{email}</span>.
            Open it on this device to continue.
          </div>
        ) : (
          <form onSubmit={signIn} className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Work email</span>
              <input
                type="email"
                required
                autoFocus
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
            </label>
            <button
              type="submit"
              disabled={busy || !email.trim()}
              className="tap w-full inline-flex items-center justify-center text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-4 py-2.5 transition-colors disabled:opacity-60 shadow-card"
            >
              {busy ? 'Sending link…' : 'Email me a sign-in link'}
            </button>
            {error && <p className="text-xs text-red-600">{error}</p>}
            <p className="text-xs text-slate-400 pt-1">
              We&apos;ll email you a secure magic link — no password needed.
            </p>
          </form>
        )}
      </div>
    </div>
  )
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginInner />
    </Suspense>
  )
}
