'use client'

import { useEffect, useState } from 'react'

interface Member {
  id: string
  email: string | null
  full_name: string | null
  role: 'owner' | 'partner' | 'affiliate'
  created_at: string
}

// 'partner' is the high-permission "Admin" seat; 'affiliate' is limited access.
const ROLE_LABEL: Record<string, string> = { owner: 'Owner', partner: 'Admin', affiliate: 'Affiliate' }
const ROLE_PILL: Record<string, string> = {
  owner: 'bg-brand-100 text-brand-700',
  partner: 'bg-indigo-100 text-indigo-700',
  affiliate: 'bg-slate-100 text-slate-600',
}

export default function SettingsPage() {
  const [org, setOrg] = useState<{ id: string; name: string } | null>(null)
  const [members, setMembers] = useState<Member[]>([])
  const [myRole, setMyRole] = useState<string>('')
  const [myId, setMyId] = useState<string>('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // org rename
  const [name, setName] = useState('')
  const [savingName, setSavingName] = useState(false)

  // invite
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState<'partner' | 'affiliate'>('partner')
  const [inviting, setInviting] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const isOwner = myRole === 'owner'

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/org')
      const j = await r.json()
      if (j.ok) {
        setOrg(j.org)
        setName(j.org?.name ?? '')
        setMembers(j.members)
        setMyRole(j.me?.role ?? '')
        setMyId(j.me?.id ?? '')
      } else setError(j.error ?? 'Failed to load')
    } catch (err: any) {
      setError(String(err?.message ?? err))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => { load() }, [])

  async function saveName() {
    if (!name.trim() || savingName || name.trim() === org?.name) return
    setSavingName(true); setError(null)
    try {
      const r = await fetch('/api/org', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) })
      const j = await r.json()
      if (j.ok) setOrg(o => (o ? { ...o, name: j.org.name } : o))
      else setError(j.error)
    } finally { setSavingName(false) }
  }

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    if (!inviteEmail.trim() || inviting) return
    setInviting(true); setError(null); setNotice(null)
    try {
      const r = await fetch('/api/org/invite', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }) })
      const j = await r.json()
      if (j.ok) { setNotice(`Invite sent to ${j.invited.email}.`); setInviteEmail(''); load() }
      else setError(j.error)
    } finally { setInviting(false) }
  }

  async function changeRole(id: string, role: 'partner' | 'affiliate') {
    setError(null)
    const r = await fetch('/api/org/member', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, role }) })
    const j = await r.json()
    if (j.ok) setMembers(ms => ms.map(m => (m.id === id ? { ...m, role } : m)))
    else setError(j.error)
  }

  async function remove(id: string, label: string) {
    if (!confirm(`Remove ${label}? This deletes their account.`)) return
    setError(null)
    const r = await fetch(`/api/org/member?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    const j = await r.json()
    if (j.ok) setMembers(ms => ms.filter(m => m.id !== id))
    else setError(j.error)
  }

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-3xl mx-auto animate-fade space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-900">Settings</h1>
        <p className="text-sm text-slate-500">Your organization and team.</p>
      </div>

      {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</div>}

      {loading ? (
        <p className="text-sm text-slate-400">Loading…</p>
      ) : (
        <>
          {/* Organization */}
          <section className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Organization</h2>
            <label className="block text-xs text-slate-400 mb-1">Name</label>
            <div className="flex gap-2">
              <input
                value={name}
                onChange={e => setName(e.target.value)}
                disabled={!isOwner}
                className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 disabled:bg-slate-50 disabled:text-slate-500"
              />
              {isOwner && (
                <button onClick={saveName} disabled={savingName || !name.trim() || name.trim() === org?.name}
                  className="tap text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-4 transition-colors disabled:opacity-60">
                  {savingName ? 'Saving…' : 'Save'}
                </button>
              )}
            </div>
            {!isOwner && <p className="text-xs text-slate-400 mt-1">Only the owner can rename the org.</p>}
          </section>

          {/* Invite (owner only) */}
          {isOwner && (
            <section className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
              <h2 className="text-sm font-semibold text-slate-700 mb-3">Invite a teammate</h2>
              <form onSubmit={invite} className="flex flex-col sm:flex-row gap-2">
                <input
                  type="email" value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
                  placeholder="name@company.com"
                  className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
                <select value={inviteRole} onChange={e => setInviteRole(e.target.value as any)}
                  className="text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500">
                  <option value="partner">Admin</option>
                  <option value="affiliate">Affiliate</option>
                </select>
                <button type="submit" disabled={inviting || !inviteEmail.trim()}
                  className="tap text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-4 py-2 transition-colors disabled:opacity-60">
                  {inviting ? 'Sending…' : 'Send invite'}
                </button>
              </form>
              {notice && <p className="text-xs text-emerald-600 mt-2">{notice}</p>}
              <p className="text-xs text-slate-400 mt-2">Admins can do everything in the app except owner-only controls (renaming the org, managing members).</p>
            </section>
          )}

          {/* Members */}
          <section className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
            <h2 className="text-sm font-semibold text-slate-700 mb-3">Members ({members.length})</h2>
            <ul className="divide-y divide-slate-100">
              {members.map(m => (
                <li key={m.id} className="py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-slate-800 truncate">{m.full_name || m.email || m.id.slice(0, 8)}{m.id === myId && <span className="text-slate-400"> (you)</span>}</p>
                    {m.full_name && m.email && <p className="text-xs text-slate-400 truncate">{m.email}</p>}
                  </div>
                  <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_PILL[m.role] ?? ''}`}>{ROLE_LABEL[m.role] ?? m.role}</span>
                  {isOwner && m.role !== 'owner' && m.id !== myId && (
                    <div className="shrink-0 flex items-center gap-1.5">
                      <select value={m.role} onChange={e => changeRole(m.id, e.target.value as any)}
                        className="text-xs border border-slate-200 rounded-lg px-1.5 py-1 focus:outline-none focus:ring-2 focus:ring-brand-500">
                        <option value="partner">Admin</option>
                        <option value="affiliate">Affiliate</option>
                      </select>
                      <button onClick={() => remove(m.id, m.full_name || m.email || 'this member')}
                        className="tap text-xs text-red-600 hover:text-red-700">Remove</button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
