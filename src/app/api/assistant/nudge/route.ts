import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Proactive nudge: a deterministic "what needs attention" summary the Sidekick
// surfaces on first open. No LLM — just live counts, so it's instant and free.
export async function GET() {
  try {
    const supabase = getAdminClient()
    const [{ data: kpis }, unread, p1Uncontacted] = await Promise.all([
      supabase.rpc('get_ops_kpis'),
      supabase.from('alerts').select('id', { count: 'exact', head: true }).eq('read', false),
      supabase
        .from('leads')
        .select('id', { count: 'exact', head: true })
        .eq('priority_tier', 'P1')
        .in('loi_status', ['not_contacted', 'contacted']),
    ])

    const k: any = kpis ?? {}
    const treat = Number(k.treat_now ?? 0)
    const unreadAlerts = unread.count ?? 0
    const p1 = p1Uncontacted.count ?? 0
    const contact = Number(k.contact_now ?? 0)

    const items: string[] = []
    if (treat) items.push(`${treat} parcel${treat === 1 ? '' : 's'} flagged TREAT NOW`)
    if (unreadAlerts) items.push(`${unreadAlerts} unread alert${unreadAlerts === 1 ? '' : 's'}`)
    if (p1) items.push(`${p1} P1 lead${p1 === 1 ? '' : 's'} still in early pipeline`)
    if (contact) items.push(`${contact} lead${contact === 1 ? '' : 's'} ready to contact`)

    const text = items.length
      ? `Here's what needs attention: ${items.join(', ')}. Want me to pull any of these up?`
      : `All clear — nothing urgent right now. Ask me anything or tell me what to do.`

    // Badge count = the genuinely-urgent items.
    const badge = treat + unreadAlerts

    return NextResponse.json({ ok: true, badge, text, items })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 })
  }
}
