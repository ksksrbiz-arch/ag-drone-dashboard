import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { cheapComplete, aiConfigured } from '@/lib/ai/llm'
import { COMPANY_CONTEXT } from '@/lib/enrichment/config'
import { INDUSTRY_DESC } from '@/lib/business'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Generate a job completion report / spray log from a job's structured data.
export async function POST(req: NextRequest) {
  if (!aiConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'No AI provider configured (set GROQ_API_KEY, OPENROUTER_API_KEY, or ANTHROPIC_API_KEY).' },
      { status: 503 }
    )
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 })
  }
  const jobId = body?.jobId
  if (!jobId) return NextResponse.json({ ok: false, error: 'jobId required' }, { status: 400 })

  const supabase = getAdminClient()
  const { data } = await supabase.from('jobs').select('*').eq('id', jobId).limit(1)
  const job = data?.[0]
  if (!job) return NextResponse.json({ ok: false, error: 'Job not found' }, { status: 404 })

  let context = ''
  if (job.lead_id) {
    const { data: ld } = await supabase
      .from('leads')
      .select('business_name,primary_crop,county,est_acreage')
      .eq('id', job.lead_id)
      .limit(1)
    const l = ld?.[0]
    if (l) context = `Linked customer: ${l.business_name ?? '?'}, ${l.primary_crop ?? '?'}, ~${l.est_acreage ?? '?'} acres, ${l.county ?? '?'} county.`
  }

  const facts = (
    [
      ['Job', job.job_title],
      ['Status', job.status],
      ['Scheduled', job.scheduled_date],
      ['Completed', job.completed_date],
      ['Location', [job.city, job.county].filter(Boolean).join(', ')],
      ['Address', job.address_physical],
      ['Pilot', job.pilot],
      ['Equipment', job.equipment],
      ['Deliverables', (job.deliverables ?? []).join(', ')],
      ['Quote', job.quote_amount != null ? `$${job.quote_amount}` : null],
      ['Invoice', job.invoice_amount != null ? `$${job.invoice_amount}` : null],
      ['Paid', job.paid_amount != null ? `$${job.paid_amount}` : null],
    ] as [string, unknown][]
  )
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')

  try {
    const report = await cheapComplete({
      system: `You write concise, professional job completion reports for ${INDUSTRY_DESC}. ${COMPANY_CONTEXT}\nUse ONLY the data provided — never invent materials, rates, weather, or acreage not given. Format: a one-line title, then short labeled lines (Date, Location, Service, Pilot, Equipment, Deliverables), then a 1-2 sentence professional summary suitable to send to the customer.`,
      user: `${facts}${context ? `\n${context}` : ''}`,
      maxTokens: 500,
      temperature: 0.3,
    })
    return NextResponse.json({ ok: true, report })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 })
  }
}
