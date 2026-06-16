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

  const [runsRes, leadsRes, jobsRes, customersRes, histRes] = await Promise.all([
    supabase
      .from('enrichment_runs')
      .select('started_at,leads_processed,leads_enriched,ai_calls,ai_tokens,duration_ms,status')
      .order('started_at', { ascending: true }),
    supabase.from('leads').select('priority_score,priority_tier,loi_status,primary_crop,enrichment_status,county,vertical,est_annual_revenue,lat,lon'),
    supabase.from('jobs').select('status,paid_amount,invoice_amount'),
    supabase.from('customers').select('id', { count: 'exact', head: true }),
    // Score-history snapshots for the portfolio trend (last 45 days; empty if
    // the v4 table isn't migrated yet).
    supabase
      .from('lead_score_history')
      .select('lead_id,score,tier,captured_at')
      .gte('captured_at', new Date(Date.now() - 45 * 86400000).toISOString())
      .order('captured_at', { ascending: true }),
  ])

  const runs = (runsRes.data ?? []) as any[]
  const leads = (leadsRes.data ?? []) as any[]
  const jobs = (jobsRes.data ?? []) as any[]
  const customers = customersRes.count ?? 0
  const hist = (histRes.data ?? []) as any[]

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

  // ── Portfolio trend: priority-tier mix over time (from score history) ─────
  // Dedupe to the latest snapshot per lead per day so multiple runs in a day
  // don't double-count, then aggregate the daily tier distribution + avg score.
  const latestPerLeadDay = new Map<string, { day: string; score: number | null; tier: string | null }>()
  for (const h of hist) {
    const day = String(h.captured_at).slice(0, 10)
    latestPerLeadDay.set(`${day}|${h.lead_id}`, { day, score: h.score, tier: h.tier })
  }
  const dayMap = new Map<string, { sum: number; n: number; P1: number; P2: number; P3: number; P4: number }>()
  for (const e of latestPerLeadDay.values()) {
    const d = dayMap.get(e.day) ?? { sum: 0, n: 0, P1: 0, P2: 0, P3: 0, P4: 0 }
    if (typeof e.score === 'number') { d.sum += e.score; d.n++ }
    if (e.tier && (d as any)[e.tier] != null) (d as any)[e.tier]++
    dayMap.set(e.day, d)
  }
  const scoreTrend = [...dayMap.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, d]) => ({
      date,
      avgScore: d.n ? Math.round(d.sum / d.n) : null,
      p1: d.P1, p2: d.P2, p3: d.P3, p4: d.P4,
    }))
    .slice(-30)

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

  // ── Geographic: by county (with centroid for the map) and by vertical ─────
  const countyMap = new Map<string, { count: number; signed: number; sum: number; n: number; pipeline: number; latSum: number; lonSum: number; geoN: number }>()
  const vertMap = new Map<string, { count: number; signed: number; sum: number; n: number }>()
  for (const l of leads) {
    const isSigned = l.loi_status === 'loi_signed'
    const score = typeof l.priority_score === 'number' ? l.priority_score : null

    const county = (l.county ?? '').trim()
    if (county) {
      const e = countyMap.get(county) ?? { count: 0, signed: 0, sum: 0, n: 0, pipeline: 0, latSum: 0, lonSum: 0, geoN: 0 }
      e.count++
      if (isSigned) e.signed++
      if (score != null) { e.sum += score; e.n++ }
      if (typeof l.est_annual_revenue === 'number') e.pipeline += l.est_annual_revenue
      if (typeof l.lat === 'number' && typeof l.lon === 'number') { e.latSum += l.lat; e.lonSum += l.lon; e.geoN++ }
      countyMap.set(county, e)
    }

    const vertical = l.vertical ?? 'ag_spray'
    const v = vertMap.get(vertical) ?? { count: 0, signed: 0, sum: 0, n: 0 }
    v.count++
    if (isSigned) v.signed++
    if (score != null) { v.sum += score; v.n++ }
    vertMap.set(vertical, v)
  }
  const byCounty = [...countyMap.entries()]
    .map(([county, e]) => ({
      county,
      count: e.count,
      signed: e.signed,
      avgPriority: e.n ? Math.round(e.sum / e.n) : null,
      pipeline: Math.round(e.pipeline),
      lat: e.geoN ? e.latSum / e.geoN : null,
      lon: e.geoN ? e.lonSum / e.geoN : null,
    }))
    .sort((a, b) => b.count - a.count)
  const byVertical = [...vertMap.entries()]
    .map(([vertical, e]) => ({ vertical, count: e.count, signed: e.signed, avgPriority: e.n ? Math.round(e.sum / e.n) : null }))
    .sort((a, b) => b.count - a.count)

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
    scoreTrend,
    topCrops,
    byCounty,
    byVertical,
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
