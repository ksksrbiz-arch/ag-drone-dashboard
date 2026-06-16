'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useState } from 'react'
import { BUSINESS, BRAND_NAME, PRODUCT_NAME, ASSISTANT_NAME } from '@/lib/business'
import { supabase } from '@/lib/supabase'

const navItems = [
  { href: '/',           label: 'Overview',       icon: '📊' },
  { href: '/assistant',  label: ASSISTANT_NAME,   icon: '✨' },
  { href: '/leads',      label: 'Leads',      icon: '🌾' },
  { href: '/discover',   label: 'Discover',   icon: '🔍' },
  { href: '/outreach',   label: 'Outreach',   icon: '✉️' },
  { href: '/pipeline',   label: 'Pipeline',   icon: '🔄' },
  { href: '/customers',  label: 'Customers',  icon: '🤝' },
  { href: '/jobs',       label: 'Jobs',       icon: '✈️' },
  { href: '/field-ops',  label: 'Field Ops',  icon: '🌤️' },
  { href: '/fields',     label: 'Fields',     icon: '🗺️' },
  { href: '/finance',    label: 'Finance',    icon: '💵' },
  { href: '/intel',      label: 'EFB Intel',  icon: '🧠' },
  { href: '/knowledge',  label: 'Knowledge',  icon: '📚' },
  { href: '/alerts',     label: 'Alerts',     icon: '🔔' },
  { href: '/automation', label: 'Automation', icon: '🤖' },
  { href: '/analytics',  label: 'Analytics',  icon: '📈' },
  { href: '/scoring',    label: 'Scoring',    icon: '🎚️' },
  { href: '/settings',   label: 'Settings',   icon: '⚙️' },
]

function Brand() {
  return (
    <div className="flex items-center gap-2.5">
      <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center text-white text-base shadow-sm">🚁</div>
      <div className="leading-tight">
        <div className="text-white font-bold text-sm tracking-tight">{PRODUCT_NAME}</div>
        {BRAND_NAME && <div className="text-slate-400 text-[11px]">{BRAND_NAME}</div>}
      </div>
    </div>
  )
}

function NavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname()
  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href))
  return (
    <nav className="flex-1 px-3 py-4 space-y-1">
      {navItems.map((item) => {
        const active = isActive(item.href)
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            className={`tap relative flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors
              ${active
                ? 'bg-brand-600/15 text-white font-semibold'
                : 'text-slate-300 hover:bg-white/5 hover:text-white'}`}
          >
            {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-full bg-brand-400" />}
            <span className="text-base">{item.icon}</span>
            <span>{item.label}</span>
          </Link>
        )
      })}
    </nav>
  )
}

function Footer() {
  async function signOut() {
    await supabase.auth.signOut()
    window.location.assign('/login')
  }
  return (
    <div className="px-5 py-4 border-t border-white/10">
      <div className="text-slate-400 text-xs">{[BUSINESS.city, BUSINESS.equipment].filter(Boolean).join(' · ')}</div>
      {BUSINESS.signer && <div className="text-slate-500 text-xs mt-0.5">{BUSINESS.signer} — Field Ops</div>}
      <button
        onClick={signOut}
        className="tap mt-3 inline-flex items-center gap-1.5 text-xs text-slate-300 hover:text-white transition-colors"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" strokeLinecap="round" strokeLinejoin="round"/></svg>
        Sign out
      </button>
    </div>
  )
}

const PANEL = 'bg-gradient-to-b from-slate-900 to-slate-950'

export default function Sidebar() {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  // The login / auth pages render standalone (no app chrome).
  if (pathname.startsWith('/login') || pathname.startsWith('/auth')) return null
  return (
    <>
      {/* Mobile top bar */}
      <header className={`md:hidden sticky top-0 z-30 flex items-center justify-between px-4 h-14 ${PANEL} border-b border-white/10`}>
        <Brand />
        <button
          aria-label="Open menu"
          onClick={() => setOpen(true)}
          className="tap-sq inline-flex items-center justify-center text-slate-200 -mr-2 rounded-lg hover:bg-white/10"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18M3 12h18M3 18h18" strokeLinecap="round"/></svg>
        </button>
      </header>

      {/* Mobile drawer */}
      {open && (
        <div className="md:hidden fixed inset-0 z-40" role="dialog" aria-modal="true">
          <div className="absolute inset-0 bg-black/50" onClick={() => setOpen(false)} />
          <div className={`absolute left-0 top-0 bottom-0 w-64 flex flex-col ${PANEL} shadow-2xl animate-fade`}>
            <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
              <Brand />
              <button aria-label="Close menu" onClick={() => setOpen(false)} className="tap-sq inline-flex items-center justify-center text-slate-300 text-2xl leading-none">×</button>
            </div>
            <NavLinks onNavigate={() => setOpen(false)} />
            <Footer />
          </div>
        </div>
      )}

      {/* Desktop sidebar */}
      <aside className={`hidden md:flex w-60 shrink-0 flex-col ${PANEL}`}>
        <div className="px-5 py-5 border-b border-white/10"><Brand /></div>
        <NavLinks />
        <Footer />
      </aside>
    </>
  )
}
