'use client'

// Public lead-capture page (no app chrome). Anyone can request a quote; the
// submission lands in the org's leads as source='inbound'. Shareable as a
// "request a quote" link or embeddable via the /api/inbound/lead endpoint.

import { useState } from 'react'
import { BUSINESS, BRAND_NAME, PRODUCT_NAME } from '@/lib/business'

const INPUT = 'w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500'

const SERVICES: { value: string; label: string }[] = [
  { value: '', label: 'What do you need? (optional)' },
  { value: 'ag_spray', label: 'Ag spraying & crop scouting' },
  { value: 'mapping', label: 'Mapping & 3D modeling' },
  { value: 'inspection', label: 'Structure / asset inspection' },
  { value: 'survey', label: 'Land survey' },
  { value: 'real_estate', label: 'Real estate / aerial photo' },
  { value: 'construction', label: 'Construction site mapping' },
  { value: 'insurance', label: 'Roof / property inspection' },
  { value: 'energy', label: 'Solar / infrastructure' },
  { value: 'delivery', label: 'Drone delivery' },
]

export default function QuotePage() {
  const [form, setForm] = useState({ business_name: '', contact_name: '', email: '', phone: '', city: '', vertical: '', message: '', website_url: '' })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [k]: e.target.value }))

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError(null)
    try {
      const r = await fetch('/api/inbound/lead', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const j = await r.json()
      if (j.ok) setDone(j.message ?? 'Thanks — we got your request.')
      else setError(j.error ?? 'Something went wrong. Please try again.')
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-2.5 mb-5 justify-center">
          <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-lg shadow-sm">🚁</div>
          <div className="leading-tight">
            <div className="font-bold text-slate-900">{BRAND_NAME}</div>
            <div className="text-xs text-slate-500">{[BUSINESS.city, 'Drone services'].filter(Boolean).join(' · ')}</div>
          </div>
        </div>

        {done ? (
          <div className="bg-white rounded-2xl border border-slate-200 shadow-card p-8 text-center">
            <div className="text-3xl mb-2">✅</div>
            <h1 className="text-lg font-bold text-slate-900">Request received</h1>
            <p className="text-sm text-slate-600 mt-2">{done}</p>
          </div>
        ) : (
          <form onSubmit={submit} className="bg-white rounded-2xl border border-slate-200 shadow-card p-6 space-y-3">
            <div>
              <h1 className="text-lg font-bold text-slate-900">Request a quote</h1>
              <p className="text-sm text-slate-500">Tell us about the job and we&apos;ll get back to you.</p>
            </div>

            <input value={form.business_name} onChange={set('business_name')} placeholder="Business / farm name" className={INPUT} />
            <input value={form.contact_name} onChange={set('contact_name')} placeholder="Your name" className={INPUT} />
            <div className="grid grid-cols-2 gap-3">
              <input value={form.email} onChange={set('email')} type="email" placeholder="Email" className={INPUT} />
              <input value={form.phone} onChange={set('phone')} placeholder="Phone" className={INPUT} />
            </div>
            <input value={form.city} onChange={set('city')} placeholder="City / area" className={INPUT} />
            <select value={form.vertical} onChange={set('vertical')} className={INPUT}>
              {SERVICES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <textarea value={form.message} onChange={set('message')} rows={3} placeholder="Anything else? (acreage, timing, location…)" className={INPUT} />

            {/* Honeypot — hidden from humans, bots tend to fill it. */}
            <input value={form.website_url} onChange={set('website_url')} tabIndex={-1} autoComplete="off" aria-hidden className="hidden" />

            {error && <p className="text-sm text-red-600">{error}</p>}
            <button type="submit" disabled={busy} className="tap w-full bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg py-2.5 transition-colors disabled:opacity-60">
              {busy ? 'Sending…' : 'Request quote'}
            </button>
            <p className="text-[11px] text-slate-400 text-center">Powered by {PRODUCT_NAME}</p>
          </form>
        )}
      </div>
    </div>
  )
}
