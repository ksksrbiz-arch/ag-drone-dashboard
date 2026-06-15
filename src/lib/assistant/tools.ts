import { getAdminClient } from '@/lib/supabaseAdmin'

// ─────────────────────────────────────────────────────────────────────────
// Tools for the Sidekick ops assistant.
//
//  • Read tools  — constrained, parameterized Supabase SELECTs (no raw SQL).
//  • Navigation  — emit a client "action" that routes the user through the app.
//  • Action tools — staff-only writes/operations wired to the existing engines
//    (advance a lead, tag, convert to customer, run automation, recompute EFB,
//    geocode, map field boundaries).
//
// runTool receives a ToolContext so navigation can queue client actions and
// write tools can enforce the caller's role (owner/partner = staff).
// ─────────────────────────────────────────────────────────────────────────

export interface ClientAction {
  type: 'navigate' | 'refresh' | 'toast'
  path?: string
  message?: string
}

export interface ToolContext {
  isStaff: boolean
  actions: ClientAction[]
}

const LEAD_COLS =
  'id,business_name,owner_name,city,county,vertical,primary_crop,est_acreage,priority_score,priority_tier,action_recommendation,loi_status,composite_efb_risk,enrichment_status,phone,email,recommended_approach'
const CUSTOMER_COLS = 'id,business_name,contact_name,city,county,status,primary_crop,phone,email'
const JOB_COLS = 'id,job_title,status,scheduled_date,city,pilot,quote_amount,invoice_amount,paid_amount'
const FIELD_COLS = 'id,name,crop,acreage,customer_id,lead_id'

const PAGES: Record<string, string> = {
  overview: '/',
  leads: '/leads',
  discover: '/discover',
  pipeline: '/pipeline',
  customers: '/customers',
  jobs: '/jobs',
  field_ops: '/field-ops',
  fields: '/fields',
  finance: '/finance',
  intel: '/intel', // EFB satellite risk map / Intelligence Hub
  alerts: '/alerts',
  automation: '/automation',
}

const LOI_STAGES = ['not_contacted', 'contacted', 'meeting_scheduled', 'loi_sent', 'loi_signed', 'declined']

const cap = (n: unknown, def: number, max: number) => {
  const v = typeof n === 'number' ? n : def
  return Math.min(Math.max(1, v), max)
}

export const TOOLS = [
  {
    name: 'get_kpis',
    description:
      'Get aggregate operational KPIs across the whole business: total leads, LOIs signed, treat/scout/contact counts, average EFB risk, enrichment coverage, priority-tier counts, active jobs, and paid revenue. Use for "how many / overall / totals" questions.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'query_leads',
    description:
      'Search leads with optional filters. Returns matching rows (capped). Use min_priority_score for "hottest" leads. county/city/crop are case-insensitive partial matches. Use search to match a business or owner name.',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string', description: 'partial match on business or owner name' },
        county: { type: 'string' },
        city: { type: 'string' },
        crop: { type: 'string', description: 'partial match on primary_crop' },
        vertical: { type: 'string', enum: ['ag_spray', 'insurance', 'real_estate', 'construction'] },
        priority_tier: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4'] },
        loi_status: { type: 'string', enum: LOI_STAGES },
        action_recommendation: { type: 'string', enum: ['TREAT_NOW', 'SCOUT_NOW', 'CONTACT_NOW', 'MONITOR'] },
        enrichment_status: { type: 'string', enum: ['pending', 'researching', 'enriched', 'failed', 'stale'] },
        min_priority_score: { type: 'number' },
        limit: { type: 'number', description: 'default 15, max 50' },
      },
      required: [],
    },
  },
  {
    name: 'count_leads',
    description:
      'Count leads matching the same filters as query_leads, without returning rows. Use for "how many leads are…" questions over the full database (1000+ leads).',
    input_schema: {
      type: 'object',
      properties: {
        search: { type: 'string' },
        county: { type: 'string' },
        city: { type: 'string' },
        crop: { type: 'string' },
        vertical: { type: 'string' },
        priority_tier: { type: 'string' },
        loi_status: { type: 'string' },
        action_recommendation: { type: 'string' },
        enrichment_status: { type: 'string' },
        min_priority_score: { type: 'number' },
      },
      required: [],
    },
  },
  {
    name: 'query_customers',
    description: 'Search customers by status and/or a name/city search term.',
    input_schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['prospect', 'active', 'inactive'] },
        search: { type: 'string' },
        limit: { type: 'number', description: 'default 15, max 50' },
      },
      required: [],
    },
  },
  {
    name: 'query_jobs',
    description: 'Search jobs by status. Returns job rows with amounts and schedule.',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['quoted', 'scheduled', 'in_progress', 'completed', 'invoiced', 'paid', 'cancelled'],
        },
        limit: { type: 'number', description: 'default 15, max 50' },
      },
      required: [],
    },
  },
  {
    name: 'query_fields',
    description: 'List mapped fields with acreage and crop. Optionally filter by customer_id.',
    input_schema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string' },
        limit: { type: 'number', description: 'default 25, max 100' },
      },
      required: [],
    },
  },
  // ── Navigation — drive the user through the app ──────────────────────────
  {
    name: 'navigate',
    description:
      'Navigate the dashboard UI to a page. ALWAYS call this whenever the user asks to open / go to / show / take me to / pull up a section — never reply that a page is unavailable. Page mapping: overview (home/dashboard), leads, discover (find new leads), pipeline, customers, jobs, field_ops (weather/field conditions), fields (field boundary map), finance (revenue/AR), intel (the EFB satellite risk map / risk map / Intelligence Hub), alerts, automation (engines/run jobs).',
    input_schema: {
      type: 'object',
      properties: { page: { type: 'string', enum: Object.keys(PAGES) } },
      required: ['page'],
    },
  },
  // ── Actions (staff only) ─────────────────────────────────────────────────
  {
    name: 'update_lead_stage',
    description:
      'Advance or set a lead\'s pipeline (LOI) stage. Identify the lead by lead_id or by a name search. Staff only.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string' },
        search: { type: 'string', description: 'business/owner name if lead_id unknown' },
        loi_status: { type: 'string', enum: LOI_STAGES },
      },
      required: ['loi_status'],
    },
  },
  {
    name: 'tag_lead',
    description: 'Add one or more tags to a lead (additive, never removes existing). Staff only.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string' },
        search: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
      },
      required: ['tags'],
    },
  },
  {
    name: 'convert_lead_to_customer',
    description:
      'Convert a lead into a customer record (status prospect) and link it. Identify by lead_id or name search. Staff only.',
    input_schema: {
      type: 'object',
      properties: { lead_id: { type: 'string' }, search: { type: 'string' } },
      required: [],
    },
  },
  {
    name: 'run_operation',
    description:
      'Run a background operation. "enrichment" = research/score a batch of leads; "efb_recompute" = recompute EFB satellite risk; "geocode" = backfill missing parcel coordinates; "boundaries" = map true parcel field boundaries. Staff only.',
    input_schema: {
      type: 'object',
      properties: { operation: { type: 'string', enum: ['enrichment', 'efb_recompute', 'geocode', 'boundaries'] } },
      required: ['operation'],
    },
  },
]

type Args = Record<string, any>

function applyLeadFilters(q: any, a: Args) {
  if (a.search)
    q = q.or(`business_name.ilike.%${a.search}%,owner_name.ilike.%${a.search}%`)
  if (a.county) q = q.ilike('county', `%${a.county}%`)
  if (a.city) q = q.ilike('city', `%${a.city}%`)
  if (a.crop) q = q.ilike('primary_crop', `%${a.crop}%`)
  if (a.vertical) q = q.eq('vertical', a.vertical)
  if (a.priority_tier) q = q.eq('priority_tier', a.priority_tier)
  if (a.loi_status) q = q.eq('loi_status', a.loi_status)
  if (a.action_recommendation) q = q.eq('action_recommendation', a.action_recommendation)
  if (a.enrichment_status) q = q.eq('enrichment_status', a.enrichment_status)
  if (typeof a.min_priority_score === 'number') q = q.gte('priority_score', a.min_priority_score)
  return q
}

/** Resolve a single lead by id or by a name search; returns the row or an error. */
async function resolveLead(supabase: any, args: Args) {
  if (args.lead_id) {
    const { data } = await supabase.from('leads').select('*').eq('id', args.lead_id).limit(1)
    if (data?.[0]) return { lead: data[0] }
    return { error: `No lead with id ${args.lead_id}.` }
  }
  if (args.search) {
    const { data } = await supabase
      .from('leads')
      .select('*')
      .or(`business_name.ilike.%${args.search}%,owner_name.ilike.%${args.search}%`)
      .order('priority_score', { ascending: false, nullsFirst: false })
      .limit(5)
    if (!data?.length) return { error: `No lead matches "${args.search}".` }
    if (data.length > 1)
      return {
        error: `"${args.search}" matched ${data.length} leads (e.g. ${data
          .slice(0, 3)
          .map((l: any) => l.business_name ?? l.owner_name)
          .join(', ')}). Be more specific.`,
      }
    return { lead: data[0] }
  }
  return { error: 'Provide a lead_id or a name to search.' }
}

const staffOnly = { error: 'That action needs owner/partner access — you have read-only access.' }

export async function runTool(name: string, args: Args, ctx: ToolContext): Promise<unknown> {
  const supabase = getAdminClient()

  switch (name) {
    case 'get_kpis': {
      const { data, error } = await supabase.rpc('get_ops_kpis')
      return error ? { error: error.message } : data
    }
    case 'query_leads': {
      let q = supabase
        .from('leads')
        .select(LEAD_COLS)
        .order('priority_score', { ascending: false, nullsFirst: false })
        .limit(cap(args.limit, 15, 50))
      q = applyLeadFilters(q, args)
      const { data, error } = await q
      return error ? { error: error.message } : data
    }
    case 'count_leads': {
      let q = supabase.from('leads').select('id', { count: 'exact', head: true })
      q = applyLeadFilters(q, args)
      const { count, error } = await q
      return error ? { error: error.message } : { count }
    }
    case 'query_customers': {
      let q = supabase.from('customers').select(CUSTOMER_COLS).limit(cap(args.limit, 15, 50))
      if (args.status) q = q.eq('status', args.status)
      if (args.search)
        q = q.or(`business_name.ilike.%${args.search}%,contact_name.ilike.%${args.search}%,city.ilike.%${args.search}%`)
      const { data, error } = await q
      return error ? { error: error.message } : data
    }
    case 'query_jobs': {
      let q = supabase.from('jobs').select(JOB_COLS).limit(cap(args.limit, 15, 50))
      if (args.status) q = q.eq('status', args.status)
      const { data, error } = await q
      return error ? { error: error.message } : data
    }
    case 'query_fields': {
      let q = supabase.from('fields').select(FIELD_COLS).limit(cap(args.limit, 25, 100))
      if (args.customer_id) q = q.eq('customer_id', args.customer_id)
      const { data, error } = await q
      return error ? { error: error.message } : data
    }

    // ── navigation ─────────────────────────────────────────────────────────
    case 'navigate': {
      const path = PAGES[args.page]
      if (!path) return { error: `Unknown page "${args.page}".` }
      ctx.actions.push({ type: 'navigate', path })
      return { ok: true, navigatedTo: args.page }
    }

    // ── actions (staff only) ────────────────────────────────────────────────
    case 'update_lead_stage': {
      if (!ctx.isStaff) return staffOnly
      if (!LOI_STAGES.includes(args.loi_status)) return { error: 'Invalid loi_status.' }
      const r = await resolveLead(supabase, args)
      if (r.error) return r
      const patch: any = { loi_status: args.loi_status }
      if (args.loi_status === 'loi_sent') patch.loi_sent_at = new Date().toISOString()
      if (args.loi_status === 'loi_signed') patch.loi_signed_at = new Date().toISOString()
      const { error } = await supabase.from('leads').update(patch).eq('id', r.lead.id)
      if (error) return { error: error.message }
      ctx.actions.push({ type: 'refresh' })
      return { ok: true, lead: r.lead.business_name ?? r.lead.owner_name, loi_status: args.loi_status }
    }
    case 'tag_lead': {
      if (!ctx.isStaff) return staffOnly
      const tags = Array.isArray(args.tags) ? args.tags.filter((t: any) => typeof t === 'string' && t.trim()) : []
      if (!tags.length) return { error: 'No tags provided.' }
      const r = await resolveLead(supabase, args)
      if (r.error) return r
      const merged = Array.from(new Set([...(r.lead.tags ?? []), ...tags.map((t: string) => t.trim())]))
      const { error } = await supabase.from('leads').update({ tags: merged }).eq('id', r.lead.id)
      if (error) return { error: error.message }
      return { ok: true, lead: r.lead.business_name ?? r.lead.owner_name, tags: merged }
    }
    case 'convert_lead_to_customer': {
      if (!ctx.isStaff) return staffOnly
      const r = await resolveLead(supabase, args)
      if (r.error) return r
      const l = r.lead
      const { data: existing } = await supabase.from('customers').select('id').eq('lead_id', l.id).limit(1)
      if (existing?.[0]) return { ok: true, note: 'Already a customer.', customer_id: existing[0].id }
      const { data, error } = await supabase
        .from('customers')
        .insert({
          business_name: l.business_name,
          contact_name: l.contact_name ?? l.owner_name,
          phone: l.phone,
          email: l.email,
          address: l.address_physical,
          city: l.city,
          county: l.county,
          state: l.state,
          primary_crop: l.primary_crop,
          est_acreage: l.est_acreage,
          status: 'prospect',
          lead_id: l.id,
        })
        .select('id')
        .single()
      if (error) return { error: error.message }
      ctx.actions.push({ type: 'refresh' })
      return { ok: true, customer_id: data?.id, name: l.business_name ?? l.owner_name }
    }
    case 'run_operation': {
      if (!ctx.isStaff) return staffOnly
      try {
        switch (args.operation) {
          case 'enrichment': {
            const { runEnrichment } = await import('@/lib/enrichment/engine')
            const s = await runEnrichment({ trigger: 'manual', limit: 10 })
            ctx.actions.push({ type: 'refresh' })
            return { ok: true, operation: 'enrichment', processed: s.leadsProcessed, enriched: s.leadsEnriched }
          }
          case 'efb_recompute': {
            const { runEfbRecompute } = await import('@/lib/efb/engine')
            const s = await runEfbRecompute({ trigger: 'manual', limit: 300 })
            ctx.actions.push({ type: 'refresh' })
            return { ok: true, operation: 'efb_recompute', updated: s.parcelsUpdated, treatNow: s.treatNow }
          }
          case 'geocode': {
            const { runGeocodeBackfill } = await import('@/lib/efb/geocode')
            const s = await runGeocodeBackfill({ trigger: 'manual', limit: 500 })
            ctx.actions.push({ type: 'refresh' })
            return { ok: true, operation: 'geocode', updated: s.updated, matched: s.matched }
          }
          case 'boundaries': {
            const { runBoundaryBackfill } = await import('@/lib/fields/parcel-boundaries')
            const s = await runBoundaryBackfill({ trigger: 'manual', limit: 500 })
            ctx.actions.push({ type: 'refresh' })
            return { ok: true, operation: 'boundaries', inserted: s.inserted, matched: s.matched }
          }
          default:
            return { error: `Unknown operation "${args.operation}".` }
        }
      } catch (err: any) {
        return { error: String(err?.message ?? err) }
      }
    }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}
