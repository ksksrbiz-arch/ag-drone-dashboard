import { getAdminClient } from '@/lib/supabaseAdmin'

// ─────────────────────────────────────────────────────────────────────────
// Read-only tools for the AI ops assistant. Every tool maps to a constrained,
// parameterized Supabase SELECT — there is no arbitrary SQL and no write path,
// so the assistant can only read data the dashboard already exposes.
// ─────────────────────────────────────────────────────────────────────────

const LEAD_COLS =
  'id,business_name,owner_name,city,county,vertical,primary_crop,est_acreage,priority_score,priority_tier,action_recommendation,loi_status,composite_efb_risk,enrichment_status,phone,email,recommended_approach'
const CUSTOMER_COLS = 'id,business_name,contact_name,city,county,status,primary_crop,phone,email'
const JOB_COLS = 'id,job_title,status,scheduled_date,city,pilot,quote_amount,invoice_amount,paid_amount'
const FIELD_COLS = 'id,name,crop,acreage,customer_id,lead_id'

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
      'Search leads with optional filters. Returns matching rows (capped). Use min_priority_score for "hottest" leads. county/city/crop are case-insensitive partial matches.',
    input_schema: {
      type: 'object',
      properties: {
        county: { type: 'string' },
        city: { type: 'string' },
        crop: { type: 'string', description: 'partial match on primary_crop' },
        vertical: { type: 'string', enum: ['ag_spray', 'insurance', 'real_estate', 'construction'] },
        priority_tier: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4'] },
        loi_status: {
          type: 'string',
          enum: ['not_contacted', 'contacted', 'meeting_scheduled', 'loi_sent', 'loi_signed', 'declined'],
        },
        action_recommendation: {
          type: 'string',
          enum: ['TREAT_NOW', 'SCOUT_NOW', 'CONTACT_NOW', 'MONITOR'],
        },
        enrichment_status: {
          type: 'string',
          enum: ['pending', 'researching', 'enriched', 'failed', 'stale'],
        },
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
]

type Args = Record<string, any>

function applyLeadFilters(q: any, a: Args) {
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

export async function runTool(name: string, args: Args): Promise<unknown> {
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
      if (args.search) q = q.or(`business_name.ilike.%${args.search}%,contact_name.ilike.%${args.search}%,city.ilike.%${args.search}%`)
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
    default:
      return { error: `Unknown tool: ${name}` }
  }
}
