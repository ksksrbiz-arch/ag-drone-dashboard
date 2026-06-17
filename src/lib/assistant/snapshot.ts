import { getAdminClient } from '@/lib/supabaseAdmin'

// ─────────────────────────────────────────────────────────────────────────
// Live ops snapshot for the assistant — a tight, always-current picture of the
// business injected into the system context every turn, so the assistant truly
// "knows what's going on" and can answer "how are we doing / what's urgent /
// what next" instantly and accurately, without a tool round-trip first.
//
// Top-line counts come from the get_ops_kpis() RPC; a few momentum/SLA counts
// come from the v4 views. Everything is best-effort — any missing piece is just
// omitted, and a total failure yields '' (the assistant simply uses tools).
// ─────────────────────────────────────────────────────────────────────────

async function headCount(
  supabase: ReturnType<typeof getAdminClient>,
  from: string,
  build?: (q: any) => any
): Promise<number | null> {
  try {
    let q = supabase.from(from).select('id', { count: 'exact', head: true })
    if (build) q = build(q)
    const { count, error } = await q
    return error ? null : count ?? null
  } catch {
    return null
  }
}

export async function buildOpsSnapshot(): Promise<string> {
  const supabase = getAdminClient()

  const [kpisRes, followups, cooling, heating, newP1] = await Promise.all([
    supabase.rpc('get_ops_kpis').then(
      r => (r.error ? null : (r.data as Record<string, number> | null)),
      () => null
    ),
    headCount(supabase, 'lead_followups'),
    headCount(supabase, 'lead_cooling_off'),
    headCount(supabase, 'lead_heating_up'),
    headCount(supabase, 'leads', q => q.eq('priority_tier', 'P1').in('priority_trend', ['up', 'new'])),
  ])

  const k = kpisRes ?? {}
  const n = (v: unknown): number | null => (typeof v === 'number' ? v : null)
  const has = (v: number | null): v is number => v != null

  const lines: string[] = []

  // Leads + priority mix.
  const total = n(k.total_leads)
  if (has(total)) {
    const tiers = [
      ['P1', n(k.priority_p1)],
      ['P2', n(k.priority_p2)],
      ['P3', n(k.priority_p3)],
      ['P4', n(k.priority_p4)],
    ].filter(([, v]) => has(v as number | null))
    const tierStr = tiers.length ? ` (${tiers.map(([t, v]) => `${t} ${v}`).join(' · ')})` : ''
    const needs = n(k.needs_enrichment)
    lines.push(`Leads: ${total}${tierStr}${has(needs) ? ` · ${needs} need research` : ''}.`)
  }

  // Urgent / momentum.
  const urgent: string[] = []
  if (has(n(k.treat_now)) && n(k.treat_now)! > 0) urgent.push(`${n(k.treat_now)} treat-now`)
  if (has(newP1) && newP1 > 0) urgent.push(`${newP1} new/risen P1`)
  if (has(followups) && followups > 0) urgent.push(`${followups} follow-ups overdue`)
  if (has(cooling) && cooling > 0) urgent.push(`${cooling} cooling off (at risk)`)
  if (has(heating) && heating > 0) urgent.push(`${heating} heating up`)
  if (urgent.length) lines.push(`Needs attention: ${urgent.join(' · ')}.`)

  // Pipeline + ops.
  const ops: string[] = []
  if (has(n(k.loi_signed))) ops.push(`${n(k.loi_signed)} LOIs signed`)
  if (has(n(k.active_jobs))) ops.push(`${n(k.active_jobs)} active jobs`)
  if (has(n(k.paid_revenue))) ops.push(`$${(n(k.paid_revenue) as number).toLocaleString()} collected`)
  if (ops.length) lines.push(`Pipeline & ops: ${ops.join(' · ')}.`)

  if (!lines.length) return ''

  const now = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
  return `\n\nLIVE OPS SNAPSHOT (current truth as of ${now} UTC — you may rely on these top-line counts to answer "how are we doing / what's urgent / what's next" right away, but still call tools to pull specific names/lists or before acting):\n- ${lines.join('\n- ')}`
}
