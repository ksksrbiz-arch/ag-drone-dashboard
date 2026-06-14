import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchSprayWindows } from '@/lib/weather'
import type { Lead, Job } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────
// Daily ops digest — a plain-text summary of what needs attention, posted to
// Slack (if SLACK_WEBHOOK_URL is set) and previewable via /api/digest.
// ─────────────────────────────────────────────────────────────────────────

export interface Digest {
  text: string
  counts: Record<string, number>
}

export async function buildDigest(): Promise<Digest> {
  const supabase = getAdminClient()
  const [{ data: leadsData }, { data: jobsData }] = await Promise.all([
    supabase.from('leads').select('*'),
    supabase.from('jobs').select('*'),
  ])
  const leads = (leadsData ?? []) as Lead[]
  const jobs = (jobsData ?? []) as Job[]

  const p1 = leads.filter(l => l.priority_tier === 'P1')
  const treatNow = leads.filter(l => l.action_recommendation === 'TREAT_NOW')
  const needsEnrichment = leads.filter(
    l => !l.enrichment_status || ['pending', 'stale', 'failed'].includes(l.enrichment_status)
  )

  const today = new Date().toISOString().slice(0, 10)
  const scheduledToday = jobs.filter(
    j => j.scheduled_date?.slice(0, 10) === today
  )
  const outstandingAR = jobs
    .filter(j => j.status === 'invoiced')
    .reduce((s, j) => s + ((j.invoice_amount ?? 0) - (j.paid_amount ?? 0)), 0)

  let sprayLine = 'Spray window: unavailable'
  try {
    const sw = await fetchSprayWindows()
    const t = sw[0]
    if (t) {
      sprayLine = `Spray window today (${t.label}): ${t.rating.replace('_', '-')} — ${t.windMax} mph wind, rain ${t.precipProb}%`
    }
  } catch {
    /* keep fallback */
  }

  const counts = {
    total_leads: leads.length,
    p1: p1.length,
    treat_now: treatNow.length,
    needs_enrichment: needsEnrichment.length,
    scheduled_today: scheduledToday.length,
    outstanding_ar: Math.round(outstandingAR),
  }

  const lines: string[] = [
    `🚁 *1COMMERCE Daily Ops Digest* — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`,
    '',
    `🌤️ ${sprayLine}`,
    `🔴 Treat-now leads: *${counts.treat_now}*`,
    `⭐ P1 priority leads: *${counts.p1}*`,
    `📅 Jobs scheduled today: *${counts.scheduled_today}*`,
    `🤖 Leads awaiting research: *${counts.needs_enrichment}*`,
    `💵 Outstanding A/R: *$${counts.outstanding_ar.toLocaleString()}*`,
  ]

  if (treatNow.length) {
    lines.push('', '*Treat now:*')
    for (const l of treatNow.slice(0, 5)) {
      lines.push(
        `• ${l.business_name ?? l.owner_name ?? 'Lead'} — ${l.city ?? ''} ${
          l.recommended_approach ? `· ${l.recommended_approach}` : ''
        }`.trim()
      )
    }
  }

  return { text: lines.join('\n'), counts }
}

export async function postDigestToSlack(text: string): Promise<boolean> {
  const url = process.env.SLACK_WEBHOOK_URL
  if (!url) return false
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    })
    return res.ok
  } catch {
    return false
  }
}
