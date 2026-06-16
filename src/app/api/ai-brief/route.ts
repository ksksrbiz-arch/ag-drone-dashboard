import { NextRequest, NextResponse } from 'next/server'
import { cheapComplete, aiConfigured, extractJson } from '@/lib/ai/llm'
import { createSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const ENTITY_TYPES = ['lead', 'customer', 'job'] as const
type EntityType = (typeof ENTITY_TYPES)[number]

// Only feed the model fields that actually inform a sales/ops decision — keeps
// the prompt cheap and avoids leaking internal plumbing columns.
const FIELDS: Record<EntityType, string> = {
  lead: 'business_name, owner_name, contact_name, city, county, primary_crop, est_acreage, loi_status, priority_score, priority_tier, recommended_approach, next_best_action, best_contact_method, phone, email, tags, notes, research_summary, composite_efb_risk',
  customer: 'business_name, contact_name, city, county, primary_crop, est_acreage, status, phone, email, notes',
  job: 'job_title, status, vertical, city, county, pilot, equipment, scheduled_date, completed_date, quote_amount, invoice_amount, paid_amount, deliverables',
}

const SYSTEM = `You are Ace, the AI partner inside Sortie — a CRM and operations hub for a drone services company. Given one record (a lead, customer, or job) plus its recent activity timeline, write a tight situational brief for the operator.

Return ONLY JSON (no prose, no code fences):
{
  "summary": string,        // 2-3 sentences: where this stands right now, grounded in the data and recent activity
  "next_action": string,    // the single most valuable next step, concrete and specific
  "watch_outs": string[]    // 0-2 short risks or things not to miss; [] if none
}
Be specific and practical — reference real figures, dates, and timeline events when present. Never invent facts not in the data.`

export async function POST(req: NextRequest) {
  if (!aiConfigured()) {
    return NextResponse.json({ ok: false, error: 'No AI provider configured.' }, { status: 503 })
  }
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 })
  }
  const entity_type = String(body?.entity_type ?? '') as EntityType
  const entity_id = String(body?.entity_id ?? '')
  if (!ENTITY_TYPES.includes(entity_type) || !entity_id) {
    return NextResponse.json({ ok: false, error: 'entity_type and entity_id required' }, { status: 400 })
  }

  try {
    const supabase = await createSupabaseServer()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return NextResponse.json({ ok: false, error: 'Not authenticated' }, { status: 401 })

    const table = entity_type === 'lead' ? 'leads' : entity_type === 'customer' ? 'customers' : 'jobs'
    const { data: record, error: recErr } = await supabase
      .from(table)
      .select(FIELDS[entity_type])
      .eq('id', entity_id)
      .single()
    if (recErr || !record) {
      return NextResponse.json({ ok: false, error: recErr?.message ?? 'Record not found' }, { status: 404 })
    }

    const { data: activities } = await supabase
      .from('activities')
      .select('kind, body, created_at')
      .eq('entity_type', entity_type)
      .eq('entity_id', entity_id)
      .order('created_at', { ascending: false })
      .limit(15)

    // Drop null/empty fields so the prompt stays compact and the model isn't
    // tempted to comment on missing data.
    const clean = Object.fromEntries(
      Object.entries(record as Record<string, any>).filter(([, v]) => v != null && v !== '')
    )
    const timeline = (activities ?? []).map(a => `- [${a.kind}] ${a.body} (${new Date(a.created_at).toLocaleDateString()})`).join('\n')

    const user_prompt = `Record type: ${entity_type}
Record:
${JSON.stringify(clean, null, 2)}

Recent activity timeline${timeline ? ':\n' + timeline : ': (none yet)'}`

    const raw = await cheapComplete({ system: SYSTEM, user: user_prompt, maxTokens: 500, temperature: 0.3 })
    const brief = extractJson<any>(raw) ?? { summary: raw, next_action: '', watch_outs: [] }
    if (!Array.isArray(brief.watch_outs)) brief.watch_outs = []
    return NextResponse.json({ ok: true, brief })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 })
  }
}
