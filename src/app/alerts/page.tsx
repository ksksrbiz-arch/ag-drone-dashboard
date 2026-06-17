'use client'

import { useCallback, useEffect, useState } from 'react'
import { supabase, type Alert } from '@/lib/supabase'
import { useRole } from '@/lib/auth/role'

const SEVERITY_META: Record<
  Alert['severity'],
  { dot: string; chip: string }
> = {
  critical: { dot: 'bg-red-500', chip: 'bg-red-100 text-red-700' },
  warning: { dot: 'bg-orange-400', chip: 'bg-orange-100 text-orange-700' },
  info: { dot: 'bg-blue-400', chip: 'bg-blue-100 text-blue-700' },
}

export default function AlertsPage() {
  const { isStaff } = useRole()
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'unread' | 'all'>('unread')
  const [digestMsg, setDigestMsg] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('alerts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    setAlerts((data ?? []) as Alert[])
  }, [])

  useEffect(() => {
    load().finally(() => setLoading(false))
    let channel: ReturnType<typeof supabase.channel> | null = null
    try {
      channel = supabase
        .channel('alerts')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, load)
        .subscribe()
    } catch {
      /* realtime optional */
    }
    return () => {
      if (channel) supabase.removeChannel(channel)
    }
  }, [load])

  async function markRead(id: string) {
    await supabase.from('alerts').update({ read: true }).eq('id', id)
    setAlerts(prev => prev.map(a => (a.id === id ? { ...a, read: true } : a)))
  }

  async function markAllRead() {
    const ids = alerts.filter(a => !a.read).map(a => a.id)
    if (!ids.length) return
    await supabase.from('alerts').update({ read: true }).in('id', ids)
    setAlerts(prev => prev.map(a => ({ ...a, read: true })))
  }

  async function sendDigest() {
    setSending(true)
    setDigestMsg(null)
    try {
      const res = await fetch('/api/digest', { method: 'POST' })
      const json = await res.json()
      if (!res.ok || json.ok === false) setDigestMsg(`Failed: ${json.error ?? res.statusText}`)
      else setDigestMsg(json.sent ? 'Digest posted to Slack ✓' : 'Digest built (no Slack webhook configured)')
    } catch (err: any) {
      setDigestMsg(`Failed: ${String(err?.message ?? err)}`)
    } finally {
      setSending(false)
    }
  }

  const unreadCount = alerts.filter(a => !a.read).length
  const shown = tab === 'unread' ? alerts.filter(a => !a.read) : alerts

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-4xl mx-auto animate-fade">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Alerts</h1>
          <p className="text-slate-500 text-sm mt-0.5">
            Urgent lead transitions + the daily ops digest
          </p>
        </div>
        {isStaff && (
        <button
          onClick={sendDigest}
          disabled={sending}
          className="tap inline-flex items-center justify-center text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-4 py-2 transition-colors disabled:opacity-60 shadow-card"
        >
          {sending ? 'Sending…' : '📨 Send digest now'}
        </button>
        )}
      </div>

      {digestMsg && (
        <div className="text-sm rounded-lg border border-brand-200 bg-brand-50 text-brand-800 px-4 py-2.5 mb-4">
          {digestMsg}
        </div>
      )}

      <div className="flex items-center justify-between mb-4">
        <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
          {(['unread', 'all'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`tap inline-flex items-center justify-center text-xs px-3 py-1 rounded-md font-medium transition-colors ${
                tab === t ? 'bg-slate-800 text-white' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t === 'unread' ? `Unread (${unreadCount})` : 'All'}
            </button>
          ))}
        </div>
        {isStaff && unreadCount > 0 && (
          <button
            onClick={markAllRead}
            className="tap inline-flex items-center text-xs text-slate-500 hover:text-slate-700"
          >
            Mark all read
          </button>
        )}
      </div>

      {loading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-16 skeleton" />)}
        </div>
      ) : shown.length === 0 ? (
        <div className="bg-white rounded-xl border border-slate-200 shadow-card p-8 text-center text-sm text-slate-400">
          {tab === 'unread' ? 'No unread alerts. You’re all caught up. 🎉' : 'No alerts yet — they appear as the engine flags urgent leads.'}
        </div>
      ) : (
        <div className="space-y-2">
          {shown.map(alert => {
            const m = SEVERITY_META[alert.severity] ?? SEVERITY_META.info
            return (
              <div
                key={alert.id}
                className={`bg-white rounded-xl border shadow-card p-4 flex items-start gap-3 ${
                  alert.read ? 'border-slate-200 opacity-70' : 'border-slate-300'
                }`}
              >
                <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${m.dot}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-slate-900">{alert.title}</span>
                    <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-medium ${m.chip}`}>
                      {alert.type.replace('_', ' ')}
                    </span>
                  </div>
                  {alert.body && <div className="text-xs text-slate-500 mt-0.5">{alert.body}</div>}
                  <div className="text-[11px] text-slate-400 mt-1">
                    {new Date(alert.created_at).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
                {!alert.read && (
                  <button
                    onClick={() => markRead(alert.id)}
                    className="tap inline-flex items-center text-xs text-slate-400 hover:text-slate-700 shrink-0"
                  >
                    Mark read
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
