import type { Lead } from '@/lib/supabase'
import { cheapComplete } from '@/lib/ai/llm'
import { COMPANY_CONTEXT } from '@/lib/enrichment/config'
import { OUTREACH_SIGNOFF, INDUSTRY_DESC } from '@/lib/business'

// ─────────────────────────────────────────────────────────────────────────
// Shared outreach drafting — used by the per-lead "Draft outreach" action
// (/api/outreach/draft) and the bulk Outreach Queue (/api/outreach/queue).
//
// Grounded strictly in the lead's known facts + the engine's advisory output
// (recommended_approach, next_best_action, talking_points). Drafts only — never
// sends, never invents prices/guarantees/facts.
// ─────────────────────────────────────────────────────────────────────────

export type OutreachChannel = 'email' | 'sms'

export interface DraftedOutreach {
  channel: OutreachChannel
  subject: string | null
  body: string
  /** The raw model text (subject line still inline for email). */
  text: string
}

function leadFacts(lead: Lead): string {
  const points = Array.isArray(lead.talking_points) ? lead.talking_points : []
  return (
    [
      ['Business', lead.business_name],
      ['Owner/contact', lead.contact_name ?? lead.owner_name],
      ['City', lead.city],
      ['County', lead.county],
      ['Crop', lead.primary_crop],
      ['Est. acreage', lead.est_acreage],
      ['EFB risk (0-100)', lead.composite_efb_risk],
      ['Recommended approach', lead.recommended_approach],
      ['Next best action', lead.next_best_action],
      ['Talking points', points.length ? points.join('; ') : null],
      ['Research notes', lead.research_summary],
    ] as [string, unknown][]
  )
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')
}

/** Generate the raw outreach text for a lead (subject inline for email). */
export async function composeOutreachText(
  lead: Lead,
  channel: OutreachChannel = 'email'
): Promise<string> {
  const channelRule =
    channel === 'sms'
      ? 'Write a concise SMS under ~320 characters — friendly, direct, with a clear ask to reply or schedule a quick look.'
      : `Write a short outreach email. First line is the subject, prefixed exactly "Subject:". Then 3-5 short sentences, warm and professional, with one clear call to action. Sign off as "${OUTREACH_SIGNOFF}" — keep any bracketed placeholder (e.g. [Your name]) verbatim for the sender to fill in.`

  return cheapComplete({
    system: `You write first-touch outreach for ${INDUSTRY_DESC}. ${COMPANY_CONTEXT}\nGoal: earn a reply that leads to a job or a short call. Be specific to this lead's situation, and lean on the recommended approach / talking points when present. Never fabricate prices, guarantees, or facts not provided. ${channelRule}`,
    user: `Draft a ${channel} to this lead:\n${leadFacts(lead)}`,
    maxTokens: 500,
    temperature: 0.6,
  })
}

/** Split an email draft's inline "Subject:" line from its body. */
export function splitDraft(channel: OutreachChannel, text: string): { subject: string | null; body: string } {
  const trimmed = text.trim()
  if (channel === 'sms') return { subject: null, body: trimmed }
  const m = trimmed.match(/^\s*Subject:\s*(.+?)\s*$/im)
  if (!m) return { subject: null, body: trimmed }
  const subject = m[1].trim()
  const body = trimmed.replace(/^\s*Subject:.*$/im, '').trim()
  return { subject, body: body || trimmed }
}

/** Compose + split into a structured draft (subject/body + raw text). */
export async function draftOutreach(
  lead: Lead,
  channel: OutreachChannel = 'email'
): Promise<DraftedOutreach> {
  const text = await composeOutreachText(lead, channel)
  const { subject, body } = splitDraft(channel, text)
  return { channel, subject, body, text }
}
