'use client'

import { Suspense, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { supabase } from '@/lib/supabase'
import { BRAND_NAME, PRODUCT_NAME, PRODUCT_TAGLINE } from '@/lib/business'

// Two sign-in methods:
//  • Password  — email + password (no email round-trip; not rate-limited).
//  • Magic link — emails a one-time link (subject to Supabase email rate limits).
type Mode = 'password' | 'magic'

function LoginInner() {
  const params = useSearchParams()
  const next = params.get('next') ?? '/'
  const authError = params.get('error')

  const [mode, setMode] = useState<Mode>('password')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [sent, setSent] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(
    authError ? 'That sign-in link was invalid or expired — sign in below.' : null
  )

  function reset() {
    setError(null)
    setMsg(null)
  }

  async function signInPassword(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    reset()
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      })
      if (error) setError(error.message)
      else window.location.assign(next)
    } catch (err: any) {
      setError(String(err?.message ?? err))
    } finally {
      setBusy(false)
    }
  }

  async function signUpPassword() {
    if (!email.trim() || password.length < 8) {
      setError('Enter an email and a password of at least 8 characters.')
      return
    }
    setBusy(true)
    reset()
    try {
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      })
      if (error) setError(error.message)
      else if (data.session) window.location.assign(next) // confirmations off → straight in
      else setMsg('Account created. If email confirmation is on, confirm via the link, then sign in.')
    } catch (err: any) {
      setError(String(err?.message ?? err))
    } finally {
      setBusy(false)
    }
  }

  async function sendMagicLink(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    reset()
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

  const inputCls =
    'mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-500'

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm bg-white rounded-2xl border border-slate-200 shadow-card p-7">
        <h1 className="text-xl font-bold tracking-tight text-slate-900">{PRODUCT_NAME}</h1>
        <p className="text-xs text-slate-400 mt-0.5">{PRODUCT_TAGLINE}</p>
        <p className="text-sm text-slate-500 mt-2 mb-5">Sign in to {BRAND_NAME}.</p>

        {sent ? (
          <div className="text-sm rounded-lg border border-green-200 bg-green-50 text-green-800 px-4 py-3">
            Check your email — we sent a sign-in link to <span className="font-medium">{email}</span>.
          </div>
        ) : mode === 'password' ? (
          <form onSubmit={signInPassword} className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Email</span>
              <input type="email" required autoFocus value={email}
                onChange={e => setEmail(e.target.value)} placeholder="you@company.com" className={inputCls} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Password</span>
              <input type="password" required value={password}
                onChange={e => setPassword(e.target.value)} placeholder="••••••••" className={inputCls} />
            </label>
            <button type="submit" disabled={busy || !email.trim() || !password}
              className="tap w-full inline-flex items-center justify-center text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-4 py-2.5 transition-colors disabled:opacity-60 shadow-card">
              {busy ? 'Signing in…' : 'Sign in'}
            </button>
            <div className="flex items-center justify-between pt-1">
              <button type="button" onClick={signUpPassword} disabled={busy}
                className="text-xs text-slate-500 hover:text-slate-700 disabled:opacity-60">
                Create account
              </button>
              <button type="button" onClick={() => { setMode('magic'); reset() }}
                className="text-xs text-brand-600 hover:text-brand-700">
                Use a magic link instead
              </button>
            </div>
          </form>
        ) : (
          <form onSubmit={sendMagicLink} className="space-y-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-600">Work email</span>
              <input type="email" required autoFocus value={email}
                onChange={e => setEmail(e.target.value)} placeholder="you@company.com" className={inputCls} />
            </label>
            <button type="submit" disabled={busy || !email.trim()}
              className="tap w-full inline-flex items-center justify-center text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-4 py-2.5 transition-colors disabled:opacity-60 shadow-card">
              {busy ? 'Sending link…' : 'Email me a sign-in link'}
            </button>
            <div className="text-right pt-1">
              <button type="button" onClick={() => { setMode('password'); reset() }}
                className="text-xs text-brand-600 hover:text-brand-700">
                Use a password instead
              </button>
            </div>
          </form>
        )}

        {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
        {msg && <p className="text-xs text-slate-600 mt-3">{msg}</p>}
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
