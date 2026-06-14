'use client'

import { useEffect, useState, useCallback } from 'react'
import { AlertTriangle, Bell, Check } from 'lucide-react'
import { supabase, type Alert } from '@/lib/supabase'

// Live EFB alerts feed — reads the `alerts` table (treat-now / new-p1 events
// raised by the engine + DB triggers). Degrades silently if the table is absent.

const SEV_META: Record<string, { cls: string; Icon: typeof AlertTriangle }> = {
  critical: { cls: 'bg-red-50 border-red-200 text-red-700', Icon: AlertTriangle },
  warning: { cls: 'bg-amber-50 border-amber-200 text-amber-700', Icon: Bell },
  info: { cls: 'bg-slate-50 border-slate-200 text-slate-600', Icon: Bell },
}

export default function AlertsFeed() {
  const [alerts, setAlerts] = useState<Alert[]>([])
  const [available, setAvailable] = useState(true)

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from('alerts')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(12)
    if (error) {
      setAvailable(false)
      return
    }
    setAlerts((data ?? []) as Alert[])
  }, [])

  useEffect(() => {
    load()
    let channel: ReturnType<typeof supabase.channel> | null = null
    try {
      channel = supabase
        .channel('intel-alerts')
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'alerts' }, load)
        .subscribe()
    } catch {
      /* realtime optional */
    }
    return () => {
      if (channel) supabase.removeChannel(channel)
    }
  }, [load])

  async function markRead(id: string) {
    setAlerts(a => a.filter(x => x.id !== id))
    try {
      await supabase.from('alerts').update({ read: true }).eq('id', id)
    } catch {
      /* best-effort */
    }
  }

  if (!available) return null

  const unread = alerts.filter(a => !a.read)

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
          <Bell size={15} /> Alerts Feed
        </h2>
        {unread.length > 0 && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">
            {unread.length} new
          </span>
        )}
      </div>
      {alerts.length === 0 ? (
        <p className="text-xs text-slate-400">
          No alerts. Escalations into TREAT_NOW or new P1 will appear here.
        </p>
      ) : (
        <div className="space-y-2 max-h-72 overflow-y-auto">
          {alerts.map(a => {
            const meta = SEV_META[a.severity] ?? SEV_META.info
            const Icon = meta.Icon
            return (
              <div
                key={a.id}
                className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${meta.cls} ${
                  a.read ? 'opacity-60' : ''
                }`}
              >
                <Icon size={14} className="mt-0.5 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="font-semibold truncate">{a.title}</div>
                  {a.body && <div className="text-slate-500 mt-0.5 line-clamp-2">{a.body}</div>}
                  <div className="text-slate-400 mt-0.5">
                    {new Date(a.created_at).toLocaleString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    })}
                  </div>
                </div>
                {!a.read && (
                  <button
                    onClick={() => markRead(a.id)}
                    aria-label="Mark read"
                    className="tap-sq shrink-0 text-slate-400 hover:text-slate-700"
                  >
                    <Check size={14} />
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
