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

export interface UndoSpec {
  label: string
  tool: string
  args: Record<string, any>
}

/** A clickable entity the chat can render as a deep-linking chip under a reply. */
export interface EntityCard {
  kind: 'lead' | 'customer' | 'job' | 'field'
  id: string
  title: string
  subtitle?: string
  href: string
}

export interface ToolContext {
  isStaff: boolean
  actions: ClientAction[]
  /** The lead the user currently has open on screen, if any (contextual "this lead"). */
  focusLeadId?: string | null
  /** Set by a reversible write so the UI can offer an Undo. */
  undo?: UndoSpec | null
  /** Who is driving — used to attribute audit-log entries. */
  actorId?: string | null
  actorEmail?: string | null
  /** Entities surfaced by read tools, rendered as clickable chips. */
  cards?: EntityCard[]
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
  schedule: '/schedule', // dispatch board
  dispatch: '/schedule',
  field_ops: '/field-ops',
  fields: '/fields',
  finance: '/finance',
  intel: '/intel', // EFB satellite risk map / Intelligence Hub
  knowledge: '/knowledge', // knowledge base — files / folders / notes
  alerts: '/alerts',
  automation: '/automation',
}

const LOI_STAGES = ['not_contacted', 'contacted', 'meeting_scheduled', 'loi_sent', 'loi_signed', 'declined']
const JOB_STATUSES = ['quoted', 'scheduled', 'in_progress', 'completed', 'invoiced', 'paid', 'cancelled']

const cap = (n: unknown, def: number, max: number) => {
  const v = typeof n === 'number' ? n : def
  return Math.min(Math.max(1, v), max)
}

const round2 = (n: number) => Math.round(n * 100) / 100
const money = (v: unknown) => (v == null ? '' : `$${Math.round(Number(v) || 0).toLocaleString()}`)
const compact = (parts: (string | number | null | undefined)[]) =>
  parts.filter(p => p != null && p !== '').join(' · ')

/** Append clickable entity chips (deduped by kind+id, capped) for the UI. */
function pushCards(ctx: ToolContext, cards: EntityCard[]) {
  if (!cards.length) return
  const list = (ctx.cards ||= [])
  for (const c of cards) {
    if (list.length >= 8) break
    if (!list.some(x => x.kind === c.kind && x.id === c.id)) list.push(c)
  }
}

function leadCard(l: any): EntityCard {
  const name = l.business_name || l.owner_name || 'Lead'
  return {
    kind: 'lead',
    id: String(l.id),
    title: name,
    subtitle: compact([l.county, l.primary_crop, l.priority_tier, l.priority_score != null ? `score ${Math.round(l.priority_score)}` : null]),
    href: `/leads?search=${encodeURIComponent(name)}`,
  }
}
function customerCard(c: any): EntityCard {
  const name = c.business_name || c.contact_name || 'Customer'
  return { kind: 'customer', id: String(c.id), title: name, subtitle: compact([c.city, c.status, c.primary_crop]), href: '/customers' }
}
function jobCard(j: any): EntityCard {
  return {
    kind: 'job',
    id: String(j.id),
    title: j.job_title || 'Job',
    subtitle: compact([j.status, j.scheduled_date, money(j.invoice_amount ?? j.quote_amount)]),
    href: '/jobs',
  }
}

/** Return a window of `len` chars around the first query term, for snippets. */
function excerptAround(text: string, query: string, len: number): string {
  if (text.length <= len) return text
  const term = (query.split(/\s+/).find(w => w.length > 2) ?? query).toLowerCase()
  const at = text.toLowerCase().indexOf(term)
  if (at < 0) return text.slice(0, len) + '…'
  const start = Math.max(0, at - Math.floor(len / 3))
  return (start > 0 ? '…' : '') + text.slice(start, start + len) + (start + len < text.length ? '…' : '')
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
        vertical: { type: 'string', enum: ['ag_spray', 'insurance', 'real_estate', 'construction', 'energy', 'mapping', 'inspection', 'survey', 'delivery'] },
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
    name: 'breakdown_leads',
    description:
      'Group leads and count them by a dimension — crop, county, city, priority tier, pipeline stage, action, vertical, or enrichment status. Use for "report/breakdown of leads by crop", "how many leads per county", "leads by stage". Optionally pre-filter with the same filters as query_leads. Returns counts per group, largest first.',
    input_schema: {
      type: 'object',
      properties: {
        group_by: {
          type: 'string',
          enum: ['primary_crop', 'county', 'city', 'priority_tier', 'loi_status', 'action_recommendation', 'vertical', 'enrichment_status'],
          description: 'the dimension to group by (e.g. primary_crop for "by crop type")',
        },
        county: { type: 'string' }, city: { type: 'string' }, crop: { type: 'string' },
        vertical: { type: 'string' }, priority_tier: { type: 'string' },
        action_recommendation: { type: 'string' }, loi_status: { type: 'string' },
        enrichment_status: { type: 'string' }, min_priority_score: { type: 'number' },
      },
      required: ['group_by'],
    },
  },
  {
    name: 'aggregate_leads',
    description:
      'Compute an exact statistic over a numeric lead field across filtered leads — sum, average, min, max, or count of non-null values. Use this instead of eyeballing rows for "average deal size", "total est. revenue of P1s", "biggest acreage", "average priority score in Marion". Optional group_by breaks the stat out per crop/county/tier/etc. Same filters as query_leads. Always prefer this for any math over many leads.',
    input_schema: {
      type: 'object',
      properties: {
        field: {
          type: 'string',
          enum: ['est_annual_revenue', 'est_acreage', 'priority_score', 'lead_score', 'composite_efb_risk', 'data_completeness'],
          description: 'the numeric field to aggregate',
        },
        op: { type: 'string', enum: ['sum', 'avg', 'min', 'max', 'count'], description: 'statistic to compute (default avg)' },
        group_by: {
          type: 'string',
          enum: ['primary_crop', 'county', 'city', 'priority_tier', 'loi_status', 'action_recommendation', 'vertical', 'enrichment_status'],
          description: 'optional — break the stat out per group, largest first',
        },
        county: { type: 'string' }, city: { type: 'string' }, crop: { type: 'string' },
        vertical: { type: 'string' }, priority_tier: { type: 'string' },
        action_recommendation: { type: 'string' }, loi_status: { type: 'string' },
        enrichment_status: { type: 'string' }, min_priority_score: { type: 'number' },
      },
      required: ['field'],
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
    name: 'get_customer_detail',
    description:
      'Get the full profile of ONE customer — contact info, location, crop/acreage, status, and notes. Identify by customer_id or a name search. Use before answering detailed questions about a customer.',
    input_schema: {
      type: 'object',
      properties: { customer_id: { type: 'string' }, search: { type: 'string', description: 'business/contact name' } },
      required: [],
    },
  },
  {
    name: 'update_customer_status',
    description:
      'Set a customer\'s status (prospect / active / inactive). Identify by customer_id or a name search. Staff only.',
    input_schema: {
      type: 'object',
      properties: {
        customer_id: { type: 'string' },
        search: { type: 'string' },
        status: { type: 'string', enum: ['prospect', 'active', 'inactive'] },
      },
      required: ['status'],
    },
  },
  {
    name: 'add_customer_note',
    description:
      'Append a dated note to a customer record (keeps existing notes). Identify by customer_id or a name search. Staff only.',
    input_schema: {
      type: 'object',
      properties: { customer_id: { type: 'string' }, search: { type: 'string' }, note: { type: 'string' } },
      required: ['note'],
    },
  },
  {
    name: 'log_activity',
    description:
      'Log an activity to a record\'s timeline — a call, email, SMS, meeting, or note. Use for "log a call with X: …", "note that …", "record that I emailed …". Identify the record by entity_type plus a name search (or the lead currently open). Staff only.',
    input_schema: {
      type: 'object',
      properties: {
        entity_type: { type: 'string', enum: ['lead', 'customer', 'job'], description: 'what the activity is about' },
        search: { type: 'string', description: 'business/owner/customer/job name' },
        id: { type: 'string', description: 'record id if known' },
        kind: { type: 'string', enum: ['note', 'call', 'email', 'sms', 'meeting'], description: 'default note' },
        body: { type: 'string', description: 'what happened' },
      },
      required: ['entity_type', 'body'],
    },
  },
  {
    name: 'get_activity',
    description:
      'Get the recent activity timeline for one record (lead, customer, or job) — calls, emails, notes, stage changes. Use for "what\'s the history with X", "recent activity on …".',
    input_schema: {
      type: 'object',
      properties: {
        entity_type: { type: 'string', enum: ['lead', 'customer', 'job'] },
        search: { type: 'string' },
        id: { type: 'string' },
        limit: { type: 'number', description: 'default 15, max 50' },
      },
      required: ['entity_type'],
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
    name: 'get_finance_summary',
    description:
      'Get a money overview across all jobs: total quoted, invoiced, collected (paid), and outstanding (invoiced minus paid), plus job counts and dollar amounts by status, and open pipeline value (quoted + scheduled). Use for "how much have we collected / what\'s outstanding / revenue / unpaid invoices" questions.',
    input_schema: { type: 'object', properties: {}, required: [] },
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
  {
    name: 'get_fields_summary',
    description:
      'Summarize mapped fields: total acreage, number of fields, and a breakdown of acres by crop. Use for "how many acres have we mapped", "acres by crop", "total mapped area". More accurate than listing fields for totals.',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  // ── Navigation — drive the user through the app ──────────────────────────
  {
    name: 'navigate',
    description:
      'Navigate the dashboard UI to a page, optionally pre-filtering it. ALWAYS call this whenever the user asks to open / go to / show / take me to / pull up a section or a filtered view — never reply that a page is unavailable. Page mapping: overview, leads, discover, pipeline, customers, jobs, schedule (dispatch board / scheduling / calendar), field_ops, fields (field boundary map), finance, intel (EFB satellite risk map / risk map / Intelligence Hub), alerts, automation. For requests like "show me Marion P1 leads" or "hazelnut treat-now leads", navigate to "leads" and set the matching filters. IMPORTANT: place names like Marion, Clackamas, Yamhill, Polk, Linn, Washington, Benton are COUNTIES — put them in the county filter, not city. Use city only for towns (Canby, Woodburn, Aurora, Dallas, etc.).',
    input_schema: {
      type: 'object',
      properties: {
        page: { type: 'string', enum: Object.keys(PAGES) },
        filters: {
          type: 'object',
          description: 'Optional filters applied on the leads page.',
          properties: {
            search: { type: 'string' },
            county: { type: 'string' },
            city: { type: 'string' },
            crop: { type: 'string' },
            vertical: { type: 'string', enum: ['ag_spray', 'insurance', 'real_estate', 'construction', 'energy', 'mapping', 'inspection', 'survey', 'delivery'] },
            priority_tier: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4'] },
            action_recommendation: { type: 'string', enum: ['TREAT_NOW', 'SCOUT_NOW', 'CONTACT_NOW', 'MONITOR'] },
            loi_status: { type: 'string', enum: LOI_STAGES },
            min_priority_score: { type: 'number' },
          },
        },
      },
      required: ['page'],
    },
  },
  {
    name: 'query_alerts',
    description: 'List the most recent alerts (TREAT_NOW / new P1 / system). Use for "any new alerts / what needs attention".',
    input_schema: {
      type: 'object',
      properties: { unread_only: { type: 'boolean' }, limit: { type: 'number', description: 'default 10, max 30' } },
      required: [],
    },
  },
  {
    name: 'get_recent_activity',
    description:
      'List the most recent actions YOU (the assistant) have taken on the user\'s behalf — stage changes, tags, conversions, jobs, customer updates, knowledge saves. Use for "what did you change / do today", "what have you done", "recent activity".',
    input_schema: { type: 'object', properties: { limit: { type: 'number', description: 'default 10, max 30' } }, required: [] },
  },
  // ── Knowledge base — staff-curated reference material ────────────────────
  {
    name: 'search_knowledge',
    description:
      "Search the team's knowledge base — uploaded files, folders, and notes (pricing sheets, SOPs, call scripts, agronomy references, contract terms). Use this whenever the user asks a company-specific or reference question whose answer is NOT in the leads/jobs/fields data (e.g. \"what's our per-acre rate\", \"what's the EFB treatment protocol\", \"how do we pitch hazelnut growers\"). Returns matching documents with excerpts; answer from them and don't invent.",
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'what to look for' },
        folder: { type: 'string', description: 'optional: restrict to one folder' },
        limit: { type: 'number', description: 'default 4, max 8' },
      },
      required: ['query'],
    },
  },
  {
    name: 'list_knowledge',
    description: 'List what is in the knowledge base — folders and document titles. Use when the user asks what reference material / files / docs are available, or to discover what to search.',
    input_schema: { type: 'object', properties: { folder: { type: 'string' } }, required: [] },
  },
  {
    name: 'add_to_knowledge',
    description:
      'Save a note to the knowledge base so the team (and you) can use it later. Use when the user says "remember that…", "save this as…", "add this to the knowledge base / as an SOP / pricing / script". Re-saving the same title+folder updates it in place. Staff only.',
    input_schema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'short document title' },
        content: { type: 'string', description: 'the text to store' },
        folder: { type: 'string', description: 'optional folder, defaults to General' },
      },
      required: ['title', 'content'],
    },
  },
  // ── Deeper read + drafting ───────────────────────────────────────────────
  {
    name: 'get_lead_detail',
    description:
      'Get the full profile of ONE lead — contact info, crop/acreage, EFB risk, priority, pipeline stage, tags, research summary and recommended approach. Identify by lead_id, by name search, or the lead currently open on screen. Use before answering detailed questions about a specific grower or drafting outreach.',
    input_schema: {
      type: 'object',
      properties: { lead_id: { type: 'string' }, search: { type: 'string', description: 'business/owner name' } },
      required: [],
    },
  },
  {
    name: 'draft_outreach',
    description:
      'Draft (do NOT send) a personalized first-touch email or SMS for a lead, grounded in their crop, acreage and EFB risk. Identify the lead by lead_id, name search, or on-screen focus. Returns the draft for the user to review/copy.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string' },
        search: { type: 'string' },
        channel: { type: 'string', enum: ['email', 'sms'], description: 'default email' },
      },
      required: [],
    },
  },
  {
    name: 'queue_outreach',
    description:
      'Draft review-first outreach and ADD it to the Outreach queue (this does NOT send) — for ONE lead (lead_id, name search, or the lead on screen) or a BATCH matching filters (e.g. all TREAT_NOW accounts, a county, a crop, a tier). The team then reviews, edits, approves and sends from the Outreach page. Leads that already have an open draft are skipped, so it never double-queues. Use for "queue outreach for the treat-now leads", "draft and queue a follow-up to Acme Farms", "queue emails for P1 hazelnut growers". With no lead and no filters it queues the top outreach-ready leads. Staff only; batch capped at 20.',
    input_schema: {
      type: 'object',
      properties: {
        lead_id: { type: 'string', description: 'queue a single lead by id' },
        search: { type: 'string', description: 'queue a single lead by business/owner name' },
        channel: { type: 'string', enum: ['email', 'sms'], description: 'default email' },
        limit: { type: 'number', description: 'batch size, default 8, max 20' },
        action_recommendation: { type: 'string', enum: ['TREAT_NOW', 'SCOUT_NOW', 'CONTACT_NOW', 'MONITOR'], description: 'batch filter, e.g. TREAT_NOW' },
        priority_tier: { type: 'string', enum: ['P1', 'P2', 'P3', 'P4'], description: 'batch filter' },
        county: { type: 'string', description: 'batch filter (partial match)' },
        city: { type: 'string', description: 'batch filter (partial match)' },
        crop: { type: 'string', description: 'batch filter on primary_crop (partial match)' },
        vertical: { type: 'string', enum: ['ag_spray', 'insurance', 'real_estate', 'construction', 'energy', 'mapping', 'inspection', 'survey', 'delivery'], description: 'batch filter' },
        min_priority_score: { type: 'number', description: 'batch filter: only leads at/above this score' },
      },
      required: [],
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
  {
    name: 'create_lead',
    description:
      'Create a new lead — use to capture a prospect from a call or referral ("add a lead: Johnson Farms, hazelnuts in Marion, 80 acres"). business_name is required; everything else is optional. Staff only.',
    input_schema: {
      type: 'object',
      properties: {
        business_name: { type: 'string' },
        owner_name: { type: 'string' },
        city: { type: 'string' },
        county: { type: 'string' },
        primary_crop: { type: 'string' },
        est_acreage: { type: 'number' },
        phone: { type: 'string' },
        email: { type: 'string' },
        vertical: { type: 'string', enum: ['ag_spray', 'insurance', 'real_estate', 'construction', 'energy', 'mapping', 'inspection', 'survey', 'delivery'] },
      },
      required: ['business_name'],
    },
  },
  {
    name: 'mark_alerts_read',
    description:
      'Mark alerts as read — clear the inbox. By default marks ALL unread alerts read; pass alert_id to mark just one. Use for "clear my alerts / mark alerts read / dismiss alerts". Staff only.',
    input_schema: {
      type: 'object',
      properties: { all: { type: 'boolean', description: 'mark every unread alert read (default true)' }, alert_id: { type: 'string' } },
      required: [],
    },
  },
  {
    name: 'update_job_status',
    description:
      'Set a job\'s status (quoted/scheduled/in_progress/completed/invoiced/paid/cancelled). Identify the job by job_id or by a job-title/customer name search. Marking it "paid" records full payment; "completed" stamps the completion date. Staff only.',
    input_schema: {
      type: 'object',
      properties: {
        job_id: { type: 'string' },
        search: { type: 'string', description: 'job title or customer name' },
        status: { type: 'string', enum: JOB_STATUSES },
      },
      required: ['status'],
    },
  },
  {
    name: 'create_job',
    description:
      'Create a new job for a customer (or lead). Provide a job_title and identify the customer by customer_search or the lead by lead_search. Optionally set scheduled_date (YYYY-MM-DD) and quote_amount. Staff only.',
    input_schema: {
      type: 'object',
      properties: {
        job_title: { type: 'string' },
        customer_search: { type: 'string', description: 'customer business/contact name' },
        lead_search: { type: 'string', description: 'lead business/owner name (if no customer yet)' },
        scheduled_date: { type: 'string', description: 'YYYY-MM-DD' },
        quote_amount: { type: 'number' },
      },
      required: ['job_title'],
    },
  },
  // ── Multi-step bulk actions (staff only, capped at 100) ──────────────────
  {
    name: 'bulk_tag_leads',
    description:
      'Add tag(s) to EVERY lead matching the given filters at once (county/city/crop/vertical/priority_tier/action_recommendation/loi_status/enrichment_status/min_priority_score). Use for plans like "tag all stale P1 hazelnut leads follow-up". Staff only; affects up to 100 leads.',
    input_schema: {
      type: 'object',
      properties: {
        tags: { type: 'array', items: { type: 'string' } },
        county: { type: 'string' }, city: { type: 'string' }, crop: { type: 'string' },
        vertical: { type: 'string' }, priority_tier: { type: 'string' },
        action_recommendation: { type: 'string' }, loi_status: { type: 'string' },
        enrichment_status: { type: 'string' }, min_priority_score: { type: 'number' },
      },
      required: ['tags'],
    },
  },
  {
    name: 'bulk_update_stage',
    description:
      'Set the pipeline (LOI) stage on EVERY lead matching the filters at once. Staff only; affects up to 100 leads. The loi_status here is the TARGET stage to set, not a filter.',
    input_schema: {
      type: 'object',
      properties: {
        loi_status: { type: 'string', enum: LOI_STAGES },
        county: { type: 'string' }, city: { type: 'string' }, crop: { type: 'string' },
        vertical: { type: 'string' }, priority_tier: { type: 'string' },
        action_recommendation: { type: 'string' }, enrichment_status: { type: 'string' },
        min_priority_score: { type: 'number' },
      },
      required: ['loi_status'],
    },
  },
]

type Args = Record<string, any>

// Filter keys that turn queue_outreach into a batch (vs. a single named lead).
const BATCH_FILTER_KEYS = ['action_recommendation', 'priority_tier', 'county', 'city', 'crop', 'vertical', 'min_priority_score']
const hasBatchFilters = (a: Args) => BATCH_FILTER_KEYS.some(k => a[k] != null && a[k] !== '')

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

/** Resolve a single lead by id, by name search, or by the on-screen focus. */
async function resolveLead(supabase: any, args: Args, ctx: ToolContext) {
  const id = args.lead_id || (!args.search ? ctx.focusLeadId : null)
  if (id) {
    const { data } = await supabase.from('leads').select('*').eq('id', id).limit(1)
    if (data?.[0]) return { lead: data[0] }
    return { error: `No lead with id ${id}.` }
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
  return { error: 'No lead specified — open a lead or give me a name.' }
}

/** Resolve a single job by id or by a job-title / customer-name search. */
async function resolveJob(supabase: any, args: Args) {
  if (args.job_id) {
    const { data } = await supabase.from('jobs').select('*').eq('id', args.job_id).limit(1)
    if (data?.[0]) return { job: data[0] }
    return { error: `No job with id ${args.job_id}.` }
  }
  if (args.search) {
    const { data } = await supabase
      .from('jobs')
      .select('*')
      .or(`job_title.ilike.%${args.search}%,city.ilike.%${args.search}%`)
      .order('created_at', { ascending: false })
      .limit(5)
    if (!data?.length) return { error: `No job matches "${args.search}".` }
    if (data.length > 1)
      return { error: `"${args.search}" matched ${data.length} jobs (e.g. ${data.slice(0, 3).map((j: any) => j.job_title).join(', ')}). Be more specific.` }
    return { job: data[0] }
  }
  return { error: 'Which job? Give me a job title or customer name.' }
}

/** Resolve a single customer by id or by a business/contact name search. */
async function resolveCustomer(supabase: any, args: Args) {
  if (args.customer_id) {
    const { data } = await supabase.from('customers').select('*').eq('id', args.customer_id).limit(1)
    if (data?.[0]) return { customer: data[0] }
    return { error: `No customer with id ${args.customer_id}.` }
  }
  if (args.search) {
    const { data } = await supabase
      .from('customers')
      .select('*')
      .or(`business_name.ilike.%${args.search}%,contact_name.ilike.%${args.search}%`)
      .limit(5)
    if (!data?.length) return { error: `No customer matches "${args.search}".` }
    if (data.length > 1)
      return { error: `"${args.search}" matched ${data.length} customers (e.g. ${data.slice(0, 3).map((c: any) => c.business_name ?? c.contact_name).join(', ')}). Be more specific.` }
    return { customer: data[0] }
  }
  return { error: 'Which customer? Give me a name.' }
}

/** Resolve any timeline entity to { id, name } from id, name search, or focus. */
async function resolveEntity(
  supabase: any,
  entityType: string,
  args: Args,
  ctx: ToolContext
): Promise<{ id?: string; name?: string; error?: string }> {
  if (entityType === 'lead') {
    const r = await resolveLead(supabase, { lead_id: args.id, search: args.search }, ctx)
    return r.error ? { error: r.error } : { id: r.lead.id, name: r.lead.business_name ?? r.lead.owner_name }
  }
  if (entityType === 'customer') {
    const r = await resolveCustomer(supabase, { customer_id: args.id, search: args.search })
    return r.error ? { error: r.error } : { id: r.customer.id, name: r.customer.business_name ?? r.customer.contact_name }
  }
  if (entityType === 'job') {
    const r = await resolveJob(supabase, { job_id: args.id, search: args.search })
    return r.error ? { error: r.error } : { id: r.job.id, name: r.job.job_title }
  }
  return { error: `Unknown entity type "${entityType}".` }
}

/** Idempotency cooldown: true if a run row for `table` started within `secs`. */
async function ranRecently(supabase: any, table: string, secs: number): Promise<boolean> {
  const since = new Date(Date.now() - secs * 1000).toISOString()
  const { count } = await supabase
    .from(table)
    .select('id', { count: 'exact', head: true })
    .gte('started_at', since)
  return (count ?? 0) > 0
}

const staffOnly = { error: 'That action needs owner/partner access — you have read-only access.' }

// Write tools whose successful runs we record in the audit log.
const MUTATING = new Set([
  'update_lead_stage', 'tag_lead', 'convert_lead_to_customer', 'run_operation',
  'bulk_tag_leads', 'bulk_update_stage', 'add_to_knowledge',
  'update_job_status', 'create_job', 'update_customer_status', 'add_customer_note',
  'create_lead', 'mark_alerts_read', 'log_activity', 'queue_outreach',
])

/** Human-readable one-liner for an audit-log entry. */
function summarizeAction(name: string, _args: Args, r: any): string {
  switch (name) {
    case 'update_lead_stage': return `Set ${r.lead}'s stage to ${r.loi_status}`
    case 'tag_lead': return `Tagged ${r.lead} (${(r.tags ?? []).join(', ')})`
    case 'convert_lead_to_customer': return `Converted ${r.name} to a customer`
    case 'run_operation': return `Ran ${r.operation}`
    case 'bulk_tag_leads': return `Tagged ${r.tagged} leads (${(r.tags ?? []).join(', ')})`
    case 'bulk_update_stage': return `Set ${r.updated} leads to ${r.loi_status}`
    case 'add_to_knowledge': return `${r.updated ? 'Updated' : 'Saved'} knowledge doc "${r.title}" in ${r.folder}`
    case 'update_job_status': return `Set job ${r.job} to ${r.status}`
    case 'create_job': return `Created job "${r.job}" (${r.status})`
    case 'update_customer_status': return `Set ${r.customer} to ${r.status}`
    case 'add_customer_note': return `Added a note to ${r.customer}`
    case 'create_lead': return `Created lead "${r.lead}"`
    case 'mark_alerts_read': return `Marked ${r.marked} alert${r.marked === 1 ? '' : 's'} read`
    case 'log_activity': return `Logged a ${r.kind} on ${r.entity}`
    case 'queue_outreach': return r.lead ? `Queued ${r.channel} outreach for ${r.lead}` : `Queued ${r.queued} outreach draft${r.queued === 1 ? '' : 's'}`
    default: return `Ran ${name}`
  }
}

/** Best-effort timeline entry for an automated change. Never throws. */
async function logTimeline(supabase: any, ctx: ToolContext, entityType: string, entityId: string, kind: string, body: string) {
  try {
    await supabase.from('activities').insert({
      entity_type: entityType,
      entity_id: entityId,
      kind,
      body,
      actor_id: ctx.actorId ?? null,
      actor_email: ctx.actorEmail ?? null,
    })
  } catch {
    /* timeline logging is non-critical */
  }
}

/** Best-effort audit log — never blocks or throws into the tool result. */
async function logAction(ctx: ToolContext, name: string, args: Args, result: any) {
  try {
    await getAdminClient()
      .from('assistant_actions')
      .insert({
        actor_id: ctx.actorId ?? null,
        actor_email: ctx.actorEmail ?? null,
        tool: name,
        summary: summarizeAction(name, args, result),
        detail: { args, result },
      })
  } catch {
    /* logging is non-critical */
  }
}

export async function runTool(name: string, args: Args, ctx: ToolContext): Promise<unknown> {
  const result = await execTool(name, args, ctx)
  // Record successful, non-noop writes for the audit trail.
  if (MUTATING.has(name)) {
    const r = result as any
    if (r && r.ok && !r.noop && !r.error) await logAction(ctx, name, args, r)
  }
  return result
}

async function execTool(name: string, args: Args, ctx: ToolContext): Promise<unknown> {
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
      if (error) return { error: error.message }
      pushCards(ctx, (data ?? []).slice(0, 6).map(leadCard))
      return data
    }
    case 'count_leads': {
      let q = supabase.from('leads').select('id', { count: 'exact', head: true })
      q = applyLeadFilters(q, args)
      const { count, error } = await q
      return error ? { error: error.message } : { count }
    }
    case 'breakdown_leads': {
      const DIMS = ['primary_crop', 'county', 'city', 'priority_tier', 'loi_status', 'action_recommendation', 'vertical', 'enrichment_status']
      const dim = DIMS.includes(args.group_by) ? args.group_by : 'primary_crop'
      let q = supabase.from('leads').select(dim).limit(5000)
      q = applyLeadFilters(q, args)
      const { data, error } = await q
      if (error) return { error: error.message }
      const counts: Record<string, number> = {}
      for (const row of (data ?? []) as any[]) {
        const key = row[dim] == null || row[dim] === '' ? '(none)' : String(row[dim])
        counts[key] = (counts[key] ?? 0) + 1
      }
      const groups = Object.entries(counts)
        .map(([value, count]) => ({ value, count }))
        .sort((a, b) => b.count - a.count)
      return { group_by: dim, total: data?.length ?? 0, groups }
    }
    case 'aggregate_leads': {
      const FIELDS = ['est_annual_revenue', 'est_acreage', 'priority_score', 'lead_score', 'composite_efb_risk', 'data_completeness']
      const DIMS = ['primary_crop', 'county', 'city', 'priority_tier', 'loi_status', 'action_recommendation', 'vertical', 'enrichment_status']
      const field = FIELDS.includes(args.field) ? args.field : 'priority_score'
      const op = ['sum', 'avg', 'min', 'max', 'count'].includes(args.op) ? args.op : 'avg'
      const dim = DIMS.includes(args.group_by) ? args.group_by : null
      const cols = dim ? `${field}, ${dim}` : field
      let q = supabase.from('leads').select(cols).limit(5000)
      q = applyLeadFilters(q, args)
      const { data, error } = await q
      if (error) return { error: error.message }
      const rows = (data ?? []) as any[]

      // Compute one statistic over a set of numeric values (nulls ignored).
      const stat = (vals: number[]): number | null => {
        if (op === 'count') return vals.length
        if (!vals.length) return null
        if (op === 'sum') return round2(vals.reduce((s, v) => s + v, 0))
        if (op === 'avg') return round2(vals.reduce((s, v) => s + v, 0) / vals.length)
        if (op === 'min') return Math.min(...vals)
        if (op === 'max') return Math.max(...vals)
        return null
      }
      const numbersOf = (rs: any[]) => rs.map(r => Number(r[field])).filter(v => Number.isFinite(v))

      if (!dim) {
        const vals = numbersOf(rows)
        return { field, op, n: vals.length, value: stat(vals) }
      }
      const buckets: Record<string, number[]> = {}
      for (const r of rows) {
        const key = r[dim] == null || r[dim] === '' ? '(none)' : String(r[dim])
        ;(buckets[key] ||= []).push(Number(r[field]))
      }
      const groups = Object.entries(buckets)
        .map(([value, vals]) => {
          const nums = vals.filter(v => Number.isFinite(v))
          return { value, n: nums.length, [op]: stat(nums) as number | null }
        })
        .sort((a, b) => (Number(b[op] ?? -Infinity)) - (Number(a[op] ?? -Infinity)))
      return { field, op, group_by: dim, total_rows: rows.length, groups }
    }
    case 'query_customers': {
      let q = supabase.from('customers').select(CUSTOMER_COLS).limit(cap(args.limit, 15, 50))
      if (args.status) q = q.eq('status', args.status)
      if (args.search)
        q = q.or(`business_name.ilike.%${args.search}%,contact_name.ilike.%${args.search}%,city.ilike.%${args.search}%`)
      const { data, error } = await q
      if (error) return { error: error.message }
      pushCards(ctx, (data ?? []).slice(0, 6).map(customerCard))
      return data
    }
    case 'get_customer_detail': {
      const r = await resolveCustomer(supabase, args)
      if (r.error) return r
      const c = r.customer
      pushCards(ctx, [customerCard(c)])
      return {
        customer: {
          id: c.id,
          business_name: c.business_name,
          contact_name: c.contact_name,
          phone: c.phone,
          email: c.email,
          city: c.city,
          county: c.county,
          state: c.state,
          primary_crop: c.primary_crop,
          est_acreage: c.est_acreage,
          status: c.status,
          notes: c.notes,
        },
      }
    }
    case 'update_customer_status': {
      if (!ctx.isStaff) return staffOnly
      if (!['prospect', 'active', 'inactive'].includes(args.status)) return { error: 'Invalid status.' }
      const r = await resolveCustomer(supabase, args)
      if (r.error) return r
      const c = r.customer
      const name = c.business_name ?? c.contact_name
      if (c.status === args.status) {
        return { ok: true, noop: true, customer: name, status: args.status, message: `${name} is already ${args.status}.` }
      }
      const { error } = await supabase.from('customers').update({ status: args.status }).eq('id', c.id)
      if (error) return { error: error.message }
      ctx.actions.push({ type: 'refresh' })
      ctx.undo = { label: `${name}'s status (back to ${c.status})`, tool: '_revert_customer', args: { id: c.id, patch: { status: c.status } } }
      await logTimeline(supabase, ctx, 'customer', c.id, 'stage', `Status → ${args.status}`)
      return { ok: true, customer: name, status: args.status }
    }
    case 'add_customer_note': {
      if (!ctx.isStaff) return staffOnly
      const note = String(args.note ?? '').trim()
      if (!note) return { error: 'No note text provided.' }
      const r = await resolveCustomer(supabase, args)
      if (r.error) return r
      const c = r.customer
      const name = c.business_name ?? c.contact_name
      const stamp = new Date().toISOString().slice(0, 10)
      const prev: string = c.notes ?? ''
      const next = (prev ? prev + '\n' : '') + `[${stamp}] ${note}`
      const { error } = await supabase.from('customers').update({ notes: next }).eq('id', c.id)
      if (error) return { error: error.message }
      ctx.undo = { label: `note on ${name}`, tool: '_revert_customer', args: { id: c.id, patch: { notes: prev } } }
      return { ok: true, customer: name, note }
    }
    case 'query_jobs': {
      let q = supabase.from('jobs').select(JOB_COLS).limit(cap(args.limit, 15, 50))
      if (args.status) q = q.eq('status', args.status)
      const { data, error } = await q
      if (error) return { error: error.message }
      pushCards(ctx, (data ?? []).slice(0, 6).map(jobCard))
      return data
    }
    case 'log_activity': {
      if (!ctx.isStaff) return staffOnly
      const body = String(args.body ?? '').trim()
      if (!body) return { error: 'What happened? Give me the note text.' }
      const e = await resolveEntity(supabase, args.entity_type, args, ctx)
      if (e.error) return e
      const kind = ['note', 'call', 'email', 'sms', 'meeting'].includes(args.kind) ? args.kind : 'note'
      const { error } = await supabase.from('activities').insert({
        entity_type: args.entity_type,
        entity_id: e.id,
        kind,
        body,
        actor_id: ctx.actorId ?? null,
        actor_email: ctx.actorEmail ?? null,
      })
      if (error) return { error: error.message }
      ctx.actions.push({ type: 'refresh' })
      return { ok: true, entity: e.name, kind, logged: body }
    }
    case 'get_activity': {
      const e = await resolveEntity(supabase, args.entity_type, args, ctx)
      if (e.error) return e
      const { data, error } = await supabase
        .from('activities')
        .select('kind, body, actor_email, created_at')
        .eq('entity_type', args.entity_type)
        .eq('entity_id', e.id)
        .order('created_at', { ascending: false })
        .limit(cap(args.limit, 15, 50))
      if (error) return { error: error.message }
      return { entity: e.name, activity: data ?? [] }
    }
    case 'get_finance_summary': {
      const { data, error } = await supabase.from('jobs').select('status, quote_amount, invoice_amount, paid_amount').limit(2000)
      if (error) return { error: error.message }
      const rows = (data ?? []) as any[]
      const num = (v: any) => (typeof v === 'number' ? v : Number(v) || 0)
      let quoted = 0, invoiced = 0, collected = 0, pipeline = 0
      const byStatus: Record<string, { count: number; amount: number }> = {}
      for (const r of rows) {
        quoted += num(r.quote_amount)
        invoiced += num(r.invoice_amount)
        collected += num(r.paid_amount)
        if (r.status === 'quoted' || r.status === 'scheduled') pipeline += num(r.quote_amount)
        const s = r.status ?? 'unknown'
        byStatus[s] ||= { count: 0, amount: 0 }
        byStatus[s].count++
        byStatus[s].amount += num(r.invoice_amount) || num(r.quote_amount)
      }
      return {
        jobs: rows.length,
        total_quoted: Math.round(quoted),
        total_invoiced: Math.round(invoiced),
        collected: Math.round(collected),
        outstanding: Math.round(invoiced - collected),
        open_pipeline_value: Math.round(pipeline),
        by_status: byStatus,
      }
    }
    case 'query_fields': {
      let q = supabase.from('fields').select(FIELD_COLS).limit(cap(args.limit, 25, 100))
      if (args.customer_id) q = q.eq('customer_id', args.customer_id)
      const { data, error } = await q
      return error ? { error: error.message } : data
    }
    case 'get_fields_summary': {
      const { data, error } = await supabase.from('fields').select('acreage, crop').limit(5000)
      if (error) return { error: error.message }
      const rows = (data ?? []) as any[]
      const num = (v: any) => (typeof v === 'number' ? v : Number(v) || 0)
      let totalAcres = 0
      const byCrop: Record<string, { fields: number; acres: number }> = {}
      for (const r of rows) {
        const acres = num(r.acreage)
        totalAcres += acres
        const crop = r.crop || '(unspecified)'
        byCrop[crop] ||= { fields: 0, acres: 0 }
        byCrop[crop].fields++
        byCrop[crop].acres += acres
      }
      const by_crop = Object.entries(byCrop)
        .map(([crop, v]) => ({ crop, fields: v.fields, acres: Math.round(v.acres) }))
        .sort((a, b) => b.acres - a.acres)
      return { field_count: rows.length, total_acres: Math.round(totalAcres), by_crop }
    }

    case 'query_alerts': {
      let q = supabase
        .from('alerts')
        .select('created_at,type,severity,title,body,read')
        .order('created_at', { ascending: false })
        .limit(cap(args.limit, 10, 30))
      if (args.unread_only) q = q.eq('read', false)
      const { data, error } = await q
      return error ? { error: error.message } : data
    }

    case 'get_recent_activity': {
      const { data, error } = await supabase
        .from('assistant_actions')
        .select('tool, summary, actor_email, created_at')
        .order('created_at', { ascending: false })
        .limit(cap(args.limit, 10, 30))
      if (error) return { error: error.message }
      return (data ?? []).map((a: any) => ({ summary: a.summary, by: a.actor_email, at: a.created_at }))
    }

    // ── knowledge base ──────────────────────────────────────────────────────
    case 'search_knowledge': {
      const query = String(args.query ?? '').trim()
      if (!query) return { error: 'No search query.' }
      const limit = cap(args.limit, 4, 8)
      const cols = 'id,title,folder,content'
      // Full-text first (handles word stems), then ilike fallback for partials.
      let rows: any[] = []
      let q1 = supabase.from('knowledge_documents').select(cols).textSearch('fts', query, { type: 'websearch' }).limit(limit)
      if (args.folder) q1 = q1.eq('folder', args.folder)
      const r1 = await q1
      if (!r1.error && r1.data?.length) rows = r1.data
      if (!rows.length) {
        let q2 = supabase
          .from('knowledge_documents')
          .select(cols)
          .or(`title.ilike.%${query}%,content.ilike.%${query}%`)
          .limit(limit)
        if (args.folder) q2 = q2.eq('folder', args.folder)
        const r2 = await q2
        if (r2.error) return { error: r2.error.message }
        rows = r2.data ?? []
      }
      if (!rows.length) return { results: [], message: 'Nothing in the knowledge base matches that.' }
      return {
        results: rows.map((d: any) => ({
          title: d.title,
          folder: d.folder,
          excerpt: excerptAround(String(d.content ?? ''), query, 700),
        })),
      }
    }
    case 'list_knowledge': {
      let q = supabase.from('knowledge_documents').select('title,folder').order('folder').order('title').limit(200)
      if (args.folder) q = q.eq('folder', args.folder)
      const { data, error } = await q
      if (error) return { error: error.message }
      const byFolder: Record<string, string[]> = {}
      for (const d of (data ?? []) as any[]) (byFolder[d.folder] ||= []).push(d.title)
      const folders = Object.entries(byFolder).map(([folder, titles]) => ({ folder, documents: titles }))
      return { folders, total: data?.length ?? 0 }
    }
    case 'add_to_knowledge': {
      if (!ctx.isStaff) return staffOnly
      const title = String(args.title ?? '').trim()
      const content = String(args.content ?? '').trim()
      const folder = String(args.folder ?? 'General').trim() || 'General'
      if (!title || !content) return { error: 'Need both a title and content to save.' }
      // Idempotent upsert on (folder, lower(title)).
      const { data: existing } = await supabase
        .from('knowledge_documents')
        .select('id')
        .eq('folder', folder)
        .ilike('title', title)
        .limit(1)
      const row = { title, folder, content, source: 'note', byte_size: content.length, updated_at: new Date().toISOString() }
      if (existing?.[0]) {
        const { error } = await supabase.from('knowledge_documents').update(row).eq('id', existing[0].id)
        if (error) return { error: error.message }
        return { ok: true, updated: true, title, folder }
      }
      const { error } = await supabase.from('knowledge_documents').insert(row)
      if (error) return { error: error.message }
      return { ok: true, created: true, title, folder }
    }

    // ── deeper read + drafting ──────────────────────────────────────────────
    case 'get_lead_detail': {
      const r = await resolveLead(supabase, args, ctx)
      if (r.error) return r
      const l = r.lead
      pushCards(ctx, [leadCard(l)])
      return {
        lead: {
          id: l.id,
          business_name: l.business_name,
          owner_name: l.owner_name ?? l.contact_name,
          phone: l.phone,
          email: l.email,
          city: l.city,
          county: l.county,
          vertical: l.vertical,
          primary_crop: l.primary_crop,
          est_acreage: l.est_acreage,
          priority_tier: l.priority_tier,
          priority_score: l.priority_score,
          action_recommendation: l.action_recommendation,
          loi_status: l.loi_status,
          composite_efb_risk: l.composite_efb_risk,
          tags: l.tags ?? [],
          recommended_approach: l.recommended_approach,
          research_summary: l.research_summary,
          enrichment_status: l.enrichment_status,
        },
      }
    }
    case 'draft_outreach': {
      const r = await resolveLead(supabase, args, ctx)
      if (r.error) return r
      const l = r.lead
      const channel: 'email' | 'sms' = args.channel === 'sms' ? 'sms' : 'email'
      const { aiConfigured, cheapComplete } = await import('@/lib/ai/llm')
      if (!aiConfigured()) return { error: 'No AI provider configured for drafting.' }
      const { COMPANY_CONTEXT } = await import('@/lib/enrichment/config')
      const { OUTREACH_SIGNOFF, INDUSTRY_DESC } = await import('@/lib/business')
      const facts = (
        [
          ['Business', l.business_name],
          ['Owner/contact', l.contact_name ?? l.owner_name],
          ['City', l.city],
          ['County', l.county],
          ['Crop', l.primary_crop],
          ['Est. acreage', l.est_acreage],
          ['EFB risk (0-100)', l.composite_efb_risk],
          ['Recommended approach', l.recommended_approach],
          ['Research notes', l.research_summary],
        ] as [string, unknown][]
      )
        .filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n')
      const channelRule =
        channel === 'sms'
          ? 'Write a concise SMS under ~320 characters — friendly, direct, with a clear ask to reply or schedule a quick look.'
          : `Write a short outreach email. First line is the subject, prefixed exactly "Subject:". Then 3-5 short sentences, warm and professional, with one clear call to action. Sign off as "${OUTREACH_SIGNOFF}" — keep any bracketed placeholder verbatim.`
      try {
        const draft = await cheapComplete({
          system: `You write first-touch outreach for ${INDUSTRY_DESC}. ${COMPANY_CONTEXT}\nGoal: earn a reply that leads to a job or a short call. Be specific to this lead's situation. Never fabricate prices, guarantees, or facts not provided. ${channelRule}`,
          user: `Draft a ${channel} to this lead:\n${facts}`,
          maxTokens: 500,
          temperature: 0.6,
        })
        return { ok: true, channel, lead: l.business_name ?? l.owner_name, draft }
      } catch (err: any) {
        return { error: String(err?.message ?? err) }
      }
    }
    case 'queue_outreach': {
      if (!ctx.isStaff) return staffOnly
      const { aiConfigured } = await import('@/lib/ai/llm')
      if (!aiConfigured()) return { error: 'No AI provider configured for drafting.' }
      const { generateOutreachBatch } = await import('@/lib/outreach/queue')
      const channel: 'email' | 'sms' = args.channel === 'sms' ? 'sms' : 'email'
      const contactLabel = channel === 'sms' ? 'phone' : 'email'

      // Single named lead (id / search / on-screen focus) vs. a filtered batch.
      const single = args.lead_id || args.search || (!hasBatchFilters(args) && ctx.focusLeadId)
      if (single) {
        const r = await resolveLead(supabase, args, ctx)
        if (r.error) return r
        const l = r.lead
        const name = l.business_name ?? l.owner_name
        const reachable = channel === 'sms' ? !!l.phone : !!l.email
        if (!reachable) return { error: `${name} has no ${contactLabel} on file — try the other channel or add contact info first.` }
        const res = await generateOutreachBatch({ channel, leadId: l.id, reason: 'manual' })
        if (!res.ok) return { error: res.error ?? 'Could not queue outreach.' }
        if (!res.generated) return { ok: true, noop: true, lead: name, message: `${name} already has an open draft in the outreach queue.` }
        ctx.actions.push({ type: 'refresh' })
        ctx.undo = { label: `queued draft for ${name}`, tool: '_dismiss_drafts', args: { ids: res.results.map(d => d.id) } }
        return { ok: true, queued: res.generated, channel, lead: name, subject: res.results[0]?.subject ?? null }
      }

      // Batch — draft for every matching outreach-ready lead, hottest first.
      const filters = {
        action_recommendation: args.action_recommendation,
        priority_tier: args.priority_tier,
        county: args.county,
        city: args.city,
        crop: args.crop,
        vertical: args.vertical,
        min_priority_score: typeof args.min_priority_score === 'number' ? args.min_priority_score : undefined,
      }
      const res = await generateOutreachBatch({ channel, limit: args.limit, filters })
      if (!res.ok) return { error: res.error ?? 'Could not queue outreach.' }
      if (!res.generated) {
        return { ok: true, noop: true, queued: 0, skipped: res.skipped, message: `Nothing new to queue — matching leads are already drafted, have no ${contactLabel} on file, or none matched.` }
      }
      ctx.actions.push({ type: 'refresh' })
      ctx.undo = { label: `${res.generated} queued draft${res.generated === 1 ? '' : 's'}`, tool: '_dismiss_drafts', args: { ids: res.results.map(d => d.id) } }
      return {
        ok: true,
        queued: res.generated,
        skipped: res.skipped,
        channel,
        drafts: res.results.map(d => ({ name: d.name, reason: d.reason, subject: d.subject })),
      }
    }

    // ── navigation (optionally with leads filters) ──────────────────────────
    case 'navigate': {
      let path = PAGES[args.page]
      if (!path) return { error: `Unknown page "${args.page}".` }
      const f = args.filters
      if (path === '/leads' && f && typeof f === 'object') {
        const qs = new URLSearchParams()
        for (const k of ['search', 'county', 'city', 'crop', 'vertical', 'priority_tier', 'action_recommendation', 'loi_status', 'min_priority_score'])
          if (f[k] != null && f[k] !== '') qs.set(k, String(f[k]))
        const s = qs.toString()
        if (s) path += `?${s}`
      }
      ctx.actions.push({ type: 'navigate', path })
      return { ok: true, navigatedTo: path }
    }

    // ── actions (staff only) ────────────────────────────────────────────────
    case 'update_lead_stage': {
      if (!ctx.isStaff) return staffOnly
      if (!LOI_STAGES.includes(args.loi_status)) return { error: 'Invalid loi_status.' }
      const r = await resolveLead(supabase, args, ctx)
      if (r.error) return r
      const name = r.lead.business_name ?? r.lead.owner_name
      // Idempotent: already at the target stage → no write.
      if (r.lead.loi_status === args.loi_status) {
        return { ok: true, noop: true, lead: name, loi_status: args.loi_status, message: `${name} is already ${args.loi_status}.` }
      }
      const prev = r.lead.loi_status
      const patch: any = { loi_status: args.loi_status }
      if (args.loi_status === 'loi_sent') patch.loi_sent_at = new Date().toISOString()
      if (args.loi_status === 'loi_signed') patch.loi_signed_at = new Date().toISOString()
      const { error } = await supabase.from('leads').update(patch).eq('id', r.lead.id)
      if (error) return { error: error.message }
      ctx.actions.push({ type: 'refresh' })
      ctx.undo = { label: `${name}'s stage (back to ${prev})`, tool: '_revert_lead', args: { id: r.lead.id, patch: { loi_status: prev } } }
      await logTimeline(supabase, ctx, 'lead', r.lead.id, 'stage', `Stage → ${String(args.loi_status).replace(/_/g, ' ')}`)
      return { ok: true, lead: name, loi_status: args.loi_status }
    }
    case 'tag_lead': {
      if (!ctx.isStaff) return staffOnly
      const tags = Array.isArray(args.tags) ? args.tags.filter((t: any) => typeof t === 'string' && t.trim()) : []
      if (!tags.length) return { error: 'No tags provided.' }
      const r = await resolveLead(supabase, args, ctx)
      if (r.error) return r
      const name = r.lead.business_name ?? r.lead.owner_name
      const existing: string[] = r.lead.tags ?? []
      const merged = Array.from(new Set([...existing, ...tags.map((t: string) => t.trim())]))
      // Idempotent: every requested tag already present → no write.
      if (merged.length === existing.length) {
        return { ok: true, noop: true, lead: name, tags: merged, message: `${name} already has those tags.` }
      }
      const { error } = await supabase.from('leads').update({ tags: merged }).eq('id', r.lead.id)
      if (error) return { error: error.message }
      ctx.undo = { label: `tags on ${name}`, tool: '_revert_lead', args: { id: r.lead.id, patch: { tags: existing } } }
      return { ok: true, lead: name, tags: merged }
    }
    case 'convert_lead_to_customer': {
      if (!ctx.isStaff) return staffOnly
      const r = await resolveLead(supabase, args, ctx)
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
      if (data?.id) {
        ctx.undo = { label: `customer ${l.business_name ?? l.owner_name}`, tool: '_delete_customer', args: { id: data.id } }
        await logTimeline(supabase, ctx, 'lead', l.id, 'system', 'Converted to a customer')
        await logTimeline(supabase, ctx, 'customer', data.id, 'system', `Created from lead ${l.business_name ?? l.owner_name ?? ''}`.trim())
      }
      return { ok: true, customer_id: data?.id, name: l.business_name ?? l.owner_name }
    }
    case 'run_operation': {
      if (!ctx.isStaff) return staffOnly
      try {
        switch (args.operation) {
          case 'enrichment': {
            if (await ranRecently(supabase, 'enrichment_runs', 90))
              return { ok: true, noop: true, operation: 'enrichment', message: 'An enrichment run just ran moments ago — skipping the duplicate.' }
            const { runEnrichment } = await import('@/lib/enrichment/engine')
            const s = await runEnrichment({ trigger: 'manual', limit: 10 })
            ctx.actions.push({ type: 'refresh' })
            return { ok: true, operation: 'enrichment', processed: s.leadsProcessed, enriched: s.leadsEnriched }
          }
          case 'efb_recompute': {
            if (await ranRecently(supabase, 'efb_runs', 90))
              return { ok: true, noop: true, operation: 'efb_recompute', message: 'EFB risk was just recomputed moments ago — skipping the duplicate.' }
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

    // ── capture + inbox (staff only) ────────────────────────────────────────
    case 'create_lead': {
      if (!ctx.isStaff) return staffOnly
      const business_name = String(args.business_name ?? '').trim()
      if (!business_name) return { error: 'A business name is required to create a lead.' }
      // Idempotent guard: don't create an obvious duplicate.
      const { data: dupe } = await supabase.from('leads').select('id, business_name').ilike('business_name', business_name).limit(1)
      if (dupe?.[0]) return { ok: true, noop: true, lead_id: dupe[0].id, lead: dupe[0].business_name, message: `A lead named "${dupe[0].business_name}" already exists.` }
      const row: any = { business_name }
      for (const k of ['owner_name', 'city', 'county', 'primary_crop', 'phone', 'email'])
        if (args[k] != null && args[k] !== '') row[k] = String(args[k])
      if (typeof args.est_acreage === 'number') row.est_acreage = args.est_acreage
      if (args.vertical) row.vertical = args.vertical
      const { data, error } = await supabase.from('leads').insert(row).select('id').single()
      if (error) return { error: error.message }
      ctx.actions.push({ type: 'refresh' })
      if (data?.id) ctx.undo = { label: `lead "${business_name}"`, tool: '_delete_lead', args: { id: data.id } }
      return { ok: true, lead_id: data?.id, lead: business_name }
    }
    case 'mark_alerts_read': {
      if (!ctx.isStaff) return staffOnly
      if (args.alert_id) {
        const { data: a } = await supabase.from('alerts').select('id, read, title').eq('id', args.alert_id).limit(1)
        if (!a?.[0]) return { error: `No alert with id ${args.alert_id}.` }
        if (a[0].read) return { ok: true, noop: true, message: 'That alert is already read.' }
        const { error } = await supabase.from('alerts').update({ read: true }).eq('id', args.alert_id)
        if (error) return { error: error.message }
        ctx.actions.push({ type: 'refresh' })
        ctx.undo = { label: 'that alert', tool: '_mark_alerts_unread', args: { ids: [args.alert_id] } }
        return { ok: true, marked: 1 }
      }
      // Default: clear all unread.
      const { data: unread } = await supabase.from('alerts').select('id').eq('read', false).limit(1000)
      const ids = (unread ?? []).map((r: any) => r.id)
      if (!ids.length) return { ok: true, noop: true, marked: 0, message: 'No unread alerts to clear.' }
      const { error } = await supabase.from('alerts').update({ read: true }).in('id', ids)
      if (error) return { error: error.message }
      ctx.actions.push({ type: 'refresh' })
      ctx.undo = { label: `${ids.length} alerts`, tool: '_mark_alerts_unread', args: { ids } }
      return { ok: true, marked: ids.length }
    }

    // ── job actions (staff only) ────────────────────────────────────────────
    case 'update_job_status': {
      if (!ctx.isStaff) return staffOnly
      if (!JOB_STATUSES.includes(args.status)) return { error: 'Invalid status.' }
      const r = await resolveJob(supabase, args)
      if (r.error) return r
      const j = r.job
      const label = j.job_title ?? 'job'
      // Idempotent: already at the target status → no write.
      if (j.status === args.status) {
        return { ok: true, noop: true, job: label, status: args.status, message: `${label} is already ${args.status}.` }
      }
      const patch: any = { status: args.status }
      if (args.status === 'completed' && !j.completed_date) patch.completed_date = new Date().toISOString().slice(0, 10)
      if (args.status === 'paid') patch.paid_amount = j.invoice_amount ?? j.paid_amount ?? j.quote_amount ?? null
      const { error } = await supabase.from('jobs').update(patch).eq('id', j.id)
      if (error) return { error: error.message }
      ctx.actions.push({ type: 'refresh' })
      ctx.undo = {
        label: `${label}'s status (back to ${j.status})`,
        tool: '_revert_job',
        args: { id: j.id, patch: { status: j.status, completed_date: j.completed_date ?? null, paid_amount: j.paid_amount ?? null } },
      }
      await logTimeline(supabase, ctx, 'job', j.id, 'stage', `Status → ${args.status}`)
      return { ok: true, job: label, status: args.status }
    }
    case 'create_job': {
      if (!ctx.isStaff) return staffOnly
      const job_title = String(args.job_title ?? '').trim()
      if (!job_title) return { error: 'A job title is required.' }
      const row: any = { job_title, status: 'quoted' }
      if (args.scheduled_date && /^\d{4}-\d{2}-\d{2}$/.test(String(args.scheduled_date))) {
        row.scheduled_date = args.scheduled_date
        row.status = 'scheduled'
      }
      if (typeof args.quote_amount === 'number') row.quote_amount = args.quote_amount
      // Link to a customer (preferred) or a lead.
      if (args.customer_search) {
        const { data } = await supabase
          .from('customers')
          .select('id, business_name, city, county, primary_crop')
          .or(`business_name.ilike.%${args.customer_search}%,contact_name.ilike.%${args.customer_search}%`)
          .limit(2)
        if (!data?.length) return { error: `No customer matches "${args.customer_search}".` }
        if (data.length > 1) return { error: `"${args.customer_search}" matched multiple customers — be more specific.` }
        row.customer_id = data[0].id
        row.city = data[0].city
        row.county = data[0].county
        row.vertical = 'ag_spray'
      } else if (args.lead_search) {
        const lr = await resolveLead(supabase, { search: args.lead_search }, ctx)
        if (lr.error) return lr
        row.lead_id = lr.lead.id
        row.city = lr.lead.city
        row.county = lr.lead.county
        row.vertical = lr.lead.vertical ?? 'ag_spray'
      } else {
        return { error: 'Who is this job for? Give me a customer or lead name.' }
      }
      const { data: ins, error } = await supabase.from('jobs').insert(row).select('id').single()
      if (error) return { error: error.message }
      ctx.actions.push({ type: 'refresh' })
      if (ins?.id) ctx.undo = { label: `job "${job_title}"`, tool: '_delete_job', args: { id: ins.id } }
      return { ok: true, job_id: ins?.id, job: job_title, status: row.status }
    }

    // ── multi-step bulk actions ─────────────────────────────────────────────
    case 'bulk_tag_leads': {
      if (!ctx.isStaff) return staffOnly
      const tags = Array.isArray(args.tags) ? args.tags.filter((t: any) => typeof t === 'string' && t.trim()).map((t: string) => t.trim()) : []
      if (!tags.length) return { error: 'No tags provided.' }
      let q = supabase.from('leads').select('id, tags').limit(100)
      q = applyLeadFilters(q, args)
      const { data, error } = await q
      if (error) return { error: error.message }
      const rows = (data ?? []) as any[]
      const changedIds: string[] = []
      for (const row of rows) {
        const existing: string[] = row.tags ?? []
        const merged = Array.from(new Set([...existing, ...tags]))
        if (merged.length === existing.length) continue
        const { error: e } = await supabase.from('leads').update({ tags: merged }).eq('id', row.id)
        if (!e) changedIds.push(row.id)
      }
      if (changedIds.length) {
        ctx.actions.push({ type: 'refresh' })
        ctx.undo = { label: `tags on ${changedIds.length} leads`, tool: '_bulk_untag', args: { ids: changedIds, tags } }
      }
      return { ok: true, matched: rows.length, tagged: changedIds.length, tags, capped: rows.length >= 100 }
    }
    case 'bulk_update_stage': {
      if (!ctx.isStaff) return staffOnly
      if (!LOI_STAGES.includes(args.loi_status)) return { error: 'Invalid loi_status.' }
      let q = supabase.from('leads').select('id, loi_status').limit(100)
      q = applyLeadFilters(q, { ...args, loi_status: undefined }) // loi_status is the target, not a filter
      const { data, error } = await q
      if (error) return { error: error.message }
      const rows = (data ?? []) as any[]
      const prior: { id: string; loi_status: string }[] = []
      for (const row of rows) {
        if (row.loi_status === args.loi_status) continue
        const { error: e } = await supabase.from('leads').update({ loi_status: args.loi_status }).eq('id', row.id)
        if (!e) prior.push({ id: row.id, loi_status: row.loi_status })
      }
      if (prior.length) {
        ctx.actions.push({ type: 'refresh' })
        ctx.undo = { label: `stage of ${prior.length} leads`, tool: '_bulk_revert_stage', args: { items: prior } }
      }
      return { ok: true, matched: rows.length, updated: prior.length, loi_status: args.loi_status, capped: rows.length >= 100 }
    }

    // ── internal undo operations (not model-callable) ───────────────────────
    case '_revert_lead': {
      if (!ctx.isStaff) return staffOnly
      if (!args.id || !args.patch) return { error: 'bad undo args' }
      const { error } = await supabase.from('leads').update(args.patch).eq('id', args.id)
      if (error) return { error: error.message }
      ctx.actions.push({ type: 'refresh' })
      return { ok: true }
    }
    case '_delete_customer': {
      if (!ctx.isStaff) return staffOnly
      if (!args.id) return { error: 'bad undo args' }
      const { error } = await supabase.from('customers').delete().eq('id', args.id)
      if (error) return { error: error.message }
      ctx.actions.push({ type: 'refresh' })
      return { ok: true }
    }
    case '_revert_customer': {
      if (!ctx.isStaff) return staffOnly
      if (!args.id || !args.patch) return { error: 'bad undo args' }
      const { error } = await supabase.from('customers').update(args.patch).eq('id', args.id)
      if (error) return { error: error.message }
      ctx.actions.push({ type: 'refresh' })
      return { ok: true }
    }
    case '_bulk_untag': {
      if (!ctx.isStaff) return staffOnly
      const ids: string[] = Array.isArray(args.ids) ? args.ids : []
      const tags: string[] = Array.isArray(args.tags) ? args.tags : []
      if (!ids.length || !tags.length) return { error: 'bad undo args' }
      const { data } = await supabase.from('leads').select('id, tags').in('id', ids)
      for (const row of (data ?? []) as any[]) {
        const next = (row.tags ?? []).filter((t: string) => !tags.includes(t))
        await supabase.from('leads').update({ tags: next }).eq('id', row.id)
      }
      ctx.actions.push({ type: 'refresh' })
      return { ok: true }
    }
    case '_revert_job': {
      if (!ctx.isStaff) return staffOnly
      if (!args.id || !args.patch) return { error: 'bad undo args' }
      const { error } = await supabase.from('jobs').update(args.patch).eq('id', args.id)
      if (error) return { error: error.message }
      ctx.actions.push({ type: 'refresh' })
      return { ok: true }
    }
    case '_delete_lead': {
      if (!ctx.isStaff) return staffOnly
      if (!args.id) return { error: 'bad undo args' }
      const { error } = await supabase.from('leads').delete().eq('id', args.id)
      if (error) return { error: error.message }
      ctx.actions.push({ type: 'refresh' })
      return { ok: true }
    }
    case '_mark_alerts_unread': {
      if (!ctx.isStaff) return staffOnly
      const ids: string[] = Array.isArray(args.ids) ? args.ids : []
      if (!ids.length) return { error: 'bad undo args' }
      const { error } = await supabase.from('alerts').update({ read: false }).in('id', ids)
      if (error) return { error: error.message }
      ctx.actions.push({ type: 'refresh' })
      return { ok: true }
    }
    case '_delete_job': {
      if (!ctx.isStaff) return staffOnly
      if (!args.id) return { error: 'bad undo args' }
      const { error } = await supabase.from('jobs').delete().eq('id', args.id)
      if (error) return { error: error.message }
      ctx.actions.push({ type: 'refresh' })
      return { ok: true }
    }
    case '_bulk_revert_stage': {
      if (!ctx.isStaff) return staffOnly
      const items: { id: string; loi_status: string }[] = Array.isArray(args.items) ? args.items : []
      if (!items.length) return { error: 'bad undo args' }
      for (const it of items) await supabase.from('leads').update({ loi_status: it.loi_status }).eq('id', it.id)
      ctx.actions.push({ type: 'refresh' })
      return { ok: true }
    }
    case '_dismiss_drafts': {
      if (!ctx.isStaff) return staffOnly
      const ids: string[] = Array.isArray(args.ids) ? args.ids : []
      if (!ids.length) return { error: 'bad undo args' }
      const { error } = await supabase.from('outreach_drafts').update({ status: 'dismissed' }).in('id', ids)
      if (error) return { error: error.message }
      ctx.actions.push({ type: 'refresh' })
      return { ok: true }
    }

    default:
      return { error: `Unknown tool: ${name}` }
  }
}
