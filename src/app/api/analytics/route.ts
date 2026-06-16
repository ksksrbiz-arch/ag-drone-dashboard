import { NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// ─────────────────────────────────────────────────────────────────────────
// Engine & pipeline analytics — one server-side aggregation pass over the data
// the intelligence system now captures (enrichment runs, leads, jobs) so the
// /analytics page can render without pulling every row to the browser.
// ─────────────────────────────────────────────────────────────────────────

const FUNNEL_STAGES: { key: string; label: string }[] = [
  { key: 'not_contacted', label: 'Not contacted' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'meeting_scheduled', label: 'Meeting scheduled' },
  { key: 'loi_sent', label: 'LOI sent' },
  { key: 'loi_signed', label: 'LOI signed' },
]

export async function GET() {
  const supabase = getAdminClient()

  const [runsRes, leadsRes, jobsRes, customersRes] = await Promise.all([
    supabase
      .from('enrichment_runs')
      .select('started_at,leads_processed,leads_enriched,ai_calls,ai_tokens,duration_ms,status')
      .order('started_at', { ascending: true }),
    supabase.from('leads').select('priority_score,priority_tier,loi_status,primary_crop,enrichment_status'),
    supabase.from('jobs').select('status,paid_amount,invoice_amount'),
    supabase.from('customers').select('id', { count: 'exact', head: true }),
  ])

  const runs = (runsRes.data ?? []) as any[]
  const leads = (leadsRes.data ?? []) as any[]
  const jobs = (jobsRes.data ?? []) as any[]
  const customers = customersRes.count ?? 0

  // ── Engine performance (per-run series + all-time cost) ──────────────────
  const runSeries = runs.slice(-14).map(r => ({
    date: r.started_at,
    leadsProcessed: r.leads_processed ?? 0,
    leadsEnriched: r.leads_enriched ?? 0,
    aiCalls: r.ai_calls ?? 0,
    aiTokens: r.ai_tokens ?? 0,
    durationMs: r.duration_ms ?? 0,
  }))
  const aiTokensTotal = runs.reduce((s, r) => s + (r.ai_tokens ?? 0), 0)
  const aiCallsTotal = runs.reduce((s, r) => s + (r.ai_calls ?? 0), 0)

  // ── Lead aggregates: tiers, avg priority, funnel ─────────────────────────
  const tiers = { P1: 0, P2: 0, P3: 0, P4: 0 } as Record<string, number>
  let scoreSum = 0
  let scoreN = 0
  let enriched = 0
  const stageCounts: Record<string, number> = {}
  for (const l of leads) {
    if (l.priority_tier && tiers[l.priority_tier] != null) tiers[l.priority_tier]++
    if (typeof l.priority_score === 'number') {
      scoreSum += l.priority_score
      scoreN++
    }
    if (l.enrichment_status === 'enriched') enriched++
    if (l.loi_status) stageCounts[l.loi_status] = (stageCounts[l.loi_status] ?? 0) + 1
  }
  const totalLeads = leads.length
  const avgPriority = scoreN ? Math.round(scoreSum / scoreN) : null
  const signed = stageCounts['loi_signed'] ?? 0

  const funnel = FUNNEL_STAGES.map(s => ({
    stage: s.key,
    label: s.label,
    count: stageCounts[s.key] ?? 0,
    pct: totalLeads ? Math.round(((stageCounts[s.key] ?? 0) / totalLeads) * 100) : 0,
  }))
  const declined = stageCounts['declined'] ?? 0

  // ── Top crops by lead count (with average priority) ──────────────────────
  const cropMap = new Map<string, { count: number; sum: number; n: number }>()
  for (const l of leads) {
    const crop = (l.primary_crop ?? '').trim()
    if (!crop) continue
    const e = cropMap.get(crop) ?? { count: 0, sum: 0, n: 0 }
    e.count++
    if (typeof l.priority_score === 'number') {
      e.sum += l.priority_score
      e.n++
    }
    cropMap.set(crop, e)
  }
  const topCrops = [...cropMap.entries()]
    .map(([crop, e]) => ({ crop, count: e.count, avgPriority: e.n ? Math.round(e.sum / e.n) : null }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8)

  // ── Jobs / revenue ───────────────────────────────────────────────────────
  const jobsByStatus: Record<string, number> = {}
  let paidRevenue = 0
  let outstandingAR = 0
  for (const j of jobs) {
    if (j.status) jobsByStatus[j.status] = (jobsByStatus[j.status] ?? 0) + 1
    if (j.status === 'paid') paidRevenue += j.paid_amount ?? 0
    if (j.status === 'invoiced') outstandingAR += (j.invoice_amount ?? 0) - (j.paid_amount ?? 0)
  }
  const paidJobs = jobsByStatus['paid'] ?? 0

  return NextResponse.json({
    ok: true,
    generatedAt: new Date().toISOString(),
    totals: {
      leads: totalLeads,
      enriched,
      enrichedPct: totalLeads ? Math.round((enriched / totalLeads) * 100) : 0,
      avgPriority,
      signed,
      declined,
      customers,
      paidRevenue: Math.round(paidRevenue),
      outstandingAR: Math.round(outstandingAR),
      paidJobs,
      runs: runs.length,
      aiTokensTotal,
      aiCallsTotal,
    },
    tiers,
    funnel,
    runs: runSeries,
    topCrops,
    jobsByStatus,
    // Conversion: how the top of the funnel becomes signed business.
    conversion: {
      contactedOrBeyond: totalLeads - (stageCounts['not_contacted'] ?? 0),
      signed,
      signRatePct: totalLeads ? Math.round((signed / totalLeads) * 100) : 0,
      paidJobs,
    },
  })
}
