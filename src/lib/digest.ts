import { getAdminClient } from '@/lib/supabaseAdmin'
import { fetchSprayWindows } from '@/lib/weather'
import { cheapComplete, aiConfigured } from '@/lib/ai/llm'
import { BRAND_NAME, BUSINESS } from '@/lib/business'
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

  // v4 intelligence views — best-effort (null if not migrated yet).
  const { data: followupData } = await supabase
    .from('lead_followups')
    .select('business_name,owner_name,city,loi_status,days_in_stage,next_best_action')
  const followups = (followupData ?? []) as any[]
  const { count: heatingCount } = await supabase
    .from('lead_heating_up')
    .select('id', { count: 'exact', head: true })
  const { data: coolingData } = await supabase
    .from('lead_cooling_off')
    .select('business_name,owner_name,city,priority_tier,drop_3,next_best_action')
  const cooling = (coolingData ?? []) as any[]

  const p1 = leads.filter(l => l.priority_tier === 'P1')
  const treatNow = leads.filter(l => l.action_recommendation === 'TREAT_NOW')
  const needsEnrichment = leads.filter(
    l => !l.enrichment_status || ['pending', 'stale', 'failed'].includes(l.enrichment_status)
  )
  // Priority momentum since the last scoring run.
  const risenP1 = leads.filter(
    l => l.priority_tier === 'P1' && (l.priority_trend === 'up' || l.priority_trend === 'new')
  )
  const topGainers = leads
    .filter(l => l.priority_delta != null && (l.priority_delta as number) > 0)
    .sort((a, b) => (b.priority_delta as number) - (a.priority_delta as number))
    .slice(0, 3)

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
    new_p1: risenP1.length,
    treat_now: treatNow.length,
    needs_enrichment: needsEnrichment.length,
    followups_due: followups.length,
    heating_up: heatingCount ?? 0,
    at_risk: cooling.length,
    scheduled_today: scheduledToday.length,
    outstanding_ar: Math.round(outstandingAR),
  }

  const lines: string[] = [
    `🚁 *${BRAND_NAME} Daily Ops Digest* — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}`,
    '',
    `🌤️ ${sprayLine}`,
    `🔴 Treat-now leads: *${counts.treat_now}*`,
    `⭐ P1 priority leads: *${counts.p1}*${counts.new_p1 ? ` (📈 ${counts.new_p1} newly risen)` : ''}`,
    `⏰ Follow-ups due: *${counts.followups_due}*${counts.heating_up ? ` · 🔥 ${counts.heating_up} heating up` : ''}${counts.at_risk ? ` · ⚠️ ${counts.at_risk} at risk` : ''}`,
    `📅 Jobs scheduled today: *${counts.scheduled_today}*`,
    `🤖 Leads awaiting research: *${counts.needs_enrichment}*`,
    `💵 Outstanding A/R: *$${counts.outstanding_ar.toLocaleString()}*`,
  ]

  if (followups.length) {
    lines.push('', '*Follow-ups due:*')
    for (const f of followups.slice(0, 5)) {
      lines.push(
        `• ${f.business_name ?? f.owner_name ?? 'Lead'} — ${f.days_in_stage}d in ${String(f.loi_status ?? '').replace(/_/g, ' ')}${
          f.next_best_action ? ` · ${f.next_best_action}` : ''
        }`.trim()
      )
    }
  }

  if (topGainers.length) {
    lines.push('', '*Biggest priority gains:*')
    for (const l of topGainers) {
      lines.push(
        `• ${l.business_name ?? l.owner_name ?? 'Lead'} — +${l.priority_delta} → ${l.priority_score} (${l.priority_tier})`
      )
    }
  }

  if (cooling.length) {
    lines.push('', '*⚠️ At risk (cooling off):*')
    for (const c of cooling.slice(0, 5)) {
      lines.push(
        `• ${c.business_name ?? c.owner_name ?? 'Lead'} — −${c.drop_3} (${c.priority_tier ?? '—'})${
          c.next_best_action ? ` · ${c.next_best_action}` : ''
        }`.trim()
      )
    }
  }

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

/**
 * Rewrite the structured digest into a short, friendly morning briefing using
 * the configured cheap LLM (Groq / OpenRouter / Claude). Falls back to the
 * template text if no provider is set or the call fails.
 */
export async function narrateDigest(d: Digest): Promise<string> {
  if (!aiConfigured()) return d.text
  try {
    const narrative = await cheapComplete({
      system: `You are the operations chief of staff for a drone-spraying ag-services business${
        BUSINESS.city ? ` in ${BUSINESS.city}` : ''
      }. Write a brief, friendly morning ops briefing from the data. 4-7 short lines, plain text, concrete and action-oriented. Keep emoji light. Do not invent numbers — only use what is given.`,
      user: `Here is today's data:\n${d.text}\n\nWrite the briefing.`,
      maxTokens: 400,
      temperature: 0.5,
    })
    return narrative || d.text
  } catch {
    return d.text
  }
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
