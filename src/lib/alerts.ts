import { getAdminClient } from '@/lib/supabaseAdmin'
import { postDigestToSlack } from '@/lib/digest'
import { BRAND_NAME } from '@/lib/business'

// ─────────────────────────────────────────────────────────────────────────
// Proactive Slack alerts.
//
// The daily digest is a once-a-day narrated summary. This pushes *individual*
// urgent transitions (treat-now / new P1) to Slack the moment the enrichment
// engine flips a lead — and stamps `notified_at` so the same alert never posts
// twice. Run on every enrichment batch (cron + manual "Run Now"), best-effort.
// ─────────────────────────────────────────────────────────────────────────

const URGENT_TYPES = ['treat_now', 'new_p1'] as const
// Don't backfill ancient alerts (e.g. the first time a Slack webhook is added).
// Proactive alerts are for things that *just* happened; the digest covers the rest.
const FRESH_WINDOW_HOURS = 24
// Keep the message scannable; summarize the overflow.
const MAX_LINES = 12

interface PendingAlert {
  id: string
  type: string
  severity: string
  title: string
  body: string | null
  created_at: string
}

/**
 * Find urgent alerts that haven't been pushed to Slack yet, post them as one
 * concise message, and mark them notified. Returns how many were delivered.
 *
 * Idempotent across runs: alerts are only stamped `notified_at` once Slack
 * confirms the post, so a failed/unconfigured webhook simply retries next run.
 */
export async function postNewAlertsToSlack(): Promise<{ posted: number; slackConfigured: boolean }> {
  const slackConfigured = !!process.env.SLACK_WEBHOOK_URL
  if (!slackConfigured) return { posted: 0, slackConfigured: false }

  const supabase = getAdminClient()
  const since = new Date(Date.now() - FRESH_WINDOW_HOURS * 3600_000).toISOString()

  const { data, error } = await supabase
    .from('alerts')
    .select('id,type,severity,title,body,created_at')
    .is('notified_at', null)
    .in('type', URGENT_TYPES as unknown as string[])
    .gte('created_at', since)
    .order('created_at', { ascending: true })
    .limit(100)

  if (error || !data || data.length === 0) return { posted: 0, slackConfigured: true }

  const pending = data as PendingAlert[]
  const text = composeAlertMessage(pending)

  const sent = await postDigestToSlack(text)
  if (!sent) return { posted: 0, slackConfigured: true }

  // Stamp only what we actually delivered, so nothing repeats.
  const ids = pending.map(a => a.id)
  await supabase.from('alerts').update({ notified_at: new Date().toISOString() }).in('id', ids)

  return { posted: pending.length, slackConfigured: true }
}

/** Build a compact Slack message — critical (treat-now) first, then new P1s. */
function composeAlertMessage(alerts: PendingAlert[]): string {
  const sevRank: Record<string, number> = { critical: 0, warning: 1, info: 2 }
  const sorted = [...alerts].sort(
    (a, b) =>
      (sevRank[a.severity] ?? 3) - (sevRank[b.severity] ?? 3) ||
      a.created_at.localeCompare(b.created_at)
  )

  const treatNow = sorted.filter(a => a.type === 'treat_now').length
  const newP1 = sorted.filter(a => a.type === 'new_p1').length
  const summary = [
    treatNow ? `${treatNow} treat-now` : '',
    newP1 ? `${newP1} new P1` : '',
  ]
    .filter(Boolean)
    .join(' · ')

  const header = `🚨 *${BRAND_NAME} — ${alerts.length} urgent lead update${alerts.length === 1 ? '' : 's'}*${
    summary ? ` (${summary})` : ''
  }`

  const lines = sorted.slice(0, MAX_LINES).map(a => {
    const icon = a.severity === 'critical' ? '🔴' : '⭐'
    return `${icon} ${a.title}${a.body ? `\n    ${a.body}` : ''}`
  })

  const overflow = sorted.length - lines.length
  const parts = [header, '', ...lines]
  if (overflow > 0) parts.push('', `…and ${overflow} more.`)

  const link = alertsLink()
  if (link) parts.push('', link)

  return parts.join('\n')
}

/** A stable deep-link to the in-app Alerts page, if we can determine the host. */
function alertsLink(): string | null {
  const base =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null)
  if (!base) return null
  return `<${base.replace(/\/$/, '')}/alerts|Open Alerts →>`
}
