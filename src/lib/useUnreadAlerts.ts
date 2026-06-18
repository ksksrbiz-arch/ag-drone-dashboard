'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

// Live count of unread alerts, kept current via Supabase realtime. Powers the
// sidebar nav badge so urgent transitions are visible in-app at a glance — the
// counterpart to the proactive Slack push. Degrades to 0 if the table is absent.
export function useUnreadAlerts(): number {
  const [count, setCount] = useState(0)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const { count: c, error } = await supabase
        .from('alerts')
        .select('id', { count: 'exact', head: true })
        .eq('read', false)
      if (!cancelled && !error) setCount(c ?? 0)
    }

    load()

    let channel: ReturnType<typeof supabase.channel> | null = null
    try {
      channel = supabase
        .channel('sidebar-alerts')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'alerts' }, load)
        .subscribe()
    } catch {
      /* realtime optional — the initial count still shows */
    }

    return () => {
      cancelled = true
      if (channel) supabase.removeChannel(channel)
    }
  }, [])

  return count
}
