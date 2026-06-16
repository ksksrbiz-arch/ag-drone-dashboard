import type { Lead } from '@/lib/supabase'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { draftOutreach, type OutreachChannel } from './draft'

// ─────────────────────────────────────────────────────────────────────────
// Outreach queue generation.
//
// Picks the leads the engine says to contact next — outreach-ready (haven't
// progressed past initial contact), highest priority first, reachable on the
// chosen channel — and drafts review-first outreach for each, skipping any lead
// that already has an open (draft/approved) draft so we never double-queue.
// ─────────────────────────────────────────────────────────────────────────

export interface GenerateOptions {
  limit?: number
  channel?: OutreachChannel
}

export interface GenerateResult {
  ok: boolean
  generated: number
  skipped: number
  channel: OutreachChannel
  results: { lead_id: string; name: string; reason: string; subject: string | null }[]
  error?: string
}

const DEFAULT_LIMIT = 8
const MAX_LIMIT = 20

/** Why a lead was queued — drives the badge on the outreach card. */
function reasonFor(lead: Lead): string {
  if (lead.loi_status === 'contacted') return 'followup'
  if (lead.priority_tier === 'P1') return 'new_p1'
  return 'priority'
}

export async function generateOutreachBatch(opts: GenerateOptions = {}): Promise<GenerateResult> {
  const channel: OutreachChannel = opts.channel === 'sms' ? 'sms' : 'email'
  const limit = Math.min(MAX_LIMIT, Math.max(1, opts.limit ?? DEFAULT_LIMIT))
  const supabase = getAdminClient()

  // Candidate pool: outreach-ready, scored leads, hottest first. Pull a little
  // extra so channel-reachability + existing-draft filtering still leaves a batch.
  const { data: leadData, error } = await supabase
    .from('leads')
    .select('*')
    .in('loi_status', ['not_contacted', 'contacted'])
    .not('priority_score', 'is', null)
    .order('priority_score', { ascending: false })
    .limit(limit * 4)
  if (error) return { ok: false, generated: 0, skipped: 0, channel, results: [], error: error.message }

  const candidates = (leadData ?? []) as Lead[]
  if (!candidates.length) {
    return { ok: true, generated: 0, skipped: 0, channel, results: [] }
  }

  // Skip leads that already have an open draft (draft or approved) so the queue
  // doesn't pile up duplicates for the same lead.
  const { data: openDrafts } = await supabase
    .from('outreach_drafts')
    .select('lead_id')
    .in('status', ['draft', 'approved'])
  const alreadyQueued = new Set((openDrafts ?? []).map((d: any) => d.lead_id))

  const reachable = (l: Lead) => (channel === 'sms' ? !!l.phone : !!l.email)

  const targets: Lead[] = []
  let skipped = 0
  for (const l of candidates) {
    if (alreadyQueued.has(l.id)) {
      skipped++
      continue
    }
    if (!reachable(l)) {
      skipped++
      continue
    }
    targets.push(l)
    if (targets.length >= limit) break
  }

  const results: GenerateResult['results'] = []
  for (const lead of targets) {
    try {
      const drafted = await draftOutreach(lead, channel)
      const reason = reasonFor(lead)
      const { error: insErr } = await supabase.from('outreach_drafts').insert({
        lead_id: lead.id,
        channel,
        subject: drafted.subject,
        body: drafted.body,
        status: 'draft',
        reason,
        priority_tier: lead.priority_tier ?? null,
      })
      if (insErr) {
        skipped++
        continue
      }
      results.push({
        lead_id: lead.id,
        name: lead.business_name ?? lead.owner_name ?? 'Unknown',
        reason,
        subject: drafted.subject,
      })
    } catch {
      skipped++
    }
  }

  return { ok: true, generated: results.length, skipped, channel, results }
}
