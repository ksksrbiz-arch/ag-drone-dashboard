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

export interface OutreachFilters {
  action_recommendation?: string
  priority_tier?: string
  county?: string
  city?: string
  crop?: string
  vertical?: string
  min_priority_score?: number
}

export interface GenerateOptions {
  limit?: number
  channel?: OutreachChannel
  /** Queue a single specific lead (bypasses the outreach-ready stage filter). */
  leadId?: string
  /** Narrow the candidate pool (e.g. action_recommendation = TREAT_NOW). */
  filters?: OutreachFilters
  /** Override the queued-reason badge (defaults to inferred). */
  reason?: string
}

export interface GenerateResult {
  ok: boolean
  generated: number
  skipped: number
  channel: OutreachChannel
  results: { id: string; lead_id: string; name: string; reason: string; subject: string | null }[]
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

/**
 * Build the candidate pool. A specific leadId returns just that lead (any
 * stage — the operator asked for it explicitly); otherwise the outreach-ready,
 * scored, hottest-first pool, optionally narrowed by filters.
 */
async function loadCandidates(
  supabase: ReturnType<typeof getAdminClient>,
  opts: GenerateOptions,
  limit: number
): Promise<{ data: Lead[]; error?: string }> {
  if (opts.leadId) {
    const { data, error } = await supabase.from('leads').select('*').eq('id', opts.leadId).limit(1)
    return { data: (data ?? []) as Lead[], error: error?.message }
  }
  let q = supabase
    .from('leads')
    .select('*')
    .in('loi_status', ['not_contacted', 'contacted'])
    .not('priority_score', 'is', null)
  const f = opts.filters
  if (f) {
    if (f.action_recommendation) q = q.eq('action_recommendation', f.action_recommendation)
    if (f.priority_tier) q = q.eq('priority_tier', f.priority_tier)
    if (f.county) q = q.ilike('county', `%${f.county}%`)
    if (f.city) q = q.ilike('city', `%${f.city}%`)
    if (f.crop) q = q.ilike('primary_crop', `%${f.crop}%`)
    if (f.vertical) q = q.eq('vertical', f.vertical)
    if (typeof f.min_priority_score === 'number') q = q.gte('priority_score', f.min_priority_score)
  }
  // Pull a little extra so channel-reachability + existing-draft filtering still
  // leaves a batch.
  q = q.order('priority_score', { ascending: false }).limit(limit * 4)
  const { data, error } = await q
  return { data: (data ?? []) as Lead[], error: error?.message }
}

export async function generateOutreachBatch(opts: GenerateOptions = {}): Promise<GenerateResult> {
  const channel: OutreachChannel = opts.channel === 'sms' ? 'sms' : 'email'
  const limit = Math.min(MAX_LIMIT, Math.max(1, opts.limit ?? DEFAULT_LIMIT))
  const supabase = getAdminClient()

  const { data: candidates, error } = await loadCandidates(supabase, opts, limit)
  if (error) return { ok: false, generated: 0, skipped: 0, channel, results: [], error }
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
      const reason = opts.reason ?? reasonFor(lead)
      const { data: ins, error: insErr } = await supabase
        .from('outreach_drafts')
        .insert({
          lead_id: lead.id,
          channel,
          subject: drafted.subject,
          body: drafted.body,
          status: 'draft',
          reason,
          priority_tier: lead.priority_tier ?? null,
        })
        .select('id')
        .single()
      if (insErr || !ins) {
        skipped++
        continue
      }
      results.push({
        id: ins.id,
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
