'use client'

// App-wide role context. Loads the signed-in user's role once and exposes it
// to any client component for UI gating. The database (RLS) is the real
// enforcement boundary — this just hides actions a user can't perform so they
// don't click buttons that would only error.
//
//   const { isStaff, isOwner } = useRole()
//   {isStaff && <button>…</button>}
//
// Roles (app_role): owner > partner ("Admin") > affiliate. Staff = owner|partner.

import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export type AppRole = 'owner' | 'partner' | 'affiliate'

interface RoleState {
  role: AppRole | null
  isStaff: boolean
  isOwner: boolean
  loading: boolean
}

const RoleContext = createContext<RoleState>({ role: null, isStaff: false, isOwner: false, loading: true })

export function RoleProvider({ children }: { children: React.ReactNode }) {
  const [role, setRole] = useState<AppRole | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function loadRole() {
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        if (active) { setRole(null); setLoading(false) }
        return
      }
      const { data: p } = await supabase.from('profiles').select('role').eq('id', user.id).single()
      if (active) { setRole((p?.role as AppRole) ?? null); setLoading(false) }
    }
    loadRole()
    // Re-resolve on sign-in/out so the UI reflects the current user.
    const { data: sub } = supabase.auth.onAuthStateChange(() => loadRole())
    return () => { active = false; sub.subscription.unsubscribe() }
  }, [])

  const value: RoleState = {
    role,
    isStaff: role === 'owner' || role === 'partner',
    isOwner: role === 'owner',
    loading,
  }
  return <RoleContext.Provider value={value}>{children}</RoleContext.Provider>
}

export function useRole() {
  return useContext(RoleContext)
}

/** Render children only for staff (owner/partner). */
export function StaffOnly({ children }: { children: React.ReactNode }) {
  const { isStaff } = useRole()
  return isStaff ? <>{children}</> : null
}

/** Render children only for the org owner. */
export function OwnerOnly({ children }: { children: React.ReactNode }) {
  const { isOwner } = useRole()
  return isOwner ? <>{children}</> : null
}
