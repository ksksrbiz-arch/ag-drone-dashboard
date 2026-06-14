import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { cheapComplete, aiConfigured } from '@/lib/ai/llm'
import { COMPANY_CONTEXT } from '@/lib/enrichment/config'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Draft (not send) a personalized outreach email or SMS for a lead.
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
  const leadId = body?.leadId
  const channel: 'email' | 'sms' = body?.channel === 'sms' ? 'sms' : 'email'
  if (!leadId) return NextResponse.json({ ok: false, error: 'leadId required' }, { status: 400 })

  const supabase = getAdminClient()
  const { data } = await supabase.from('leads').select('*').eq('id', leadId).limit(1)
  const lead = data?.[0]
  if (!lead) return NextResponse.json({ ok: false, error: 'Lead not found' }, { status: 404 })

  const facts = (
    [
      ['Business', lead.business_name],
      ['Owner/contact', lead.contact_name ?? lead.owner_name],
      ['City', lead.city],
      ['County', lead.county],
      ['Crop', lead.primary_crop],
      ['Est. acreage', lead.est_acreage],
      ['EFB risk (0-100)', lead.composite_efb_risk],
      ['Recommended approach', lead.recommended_approach],
      ['Research notes', lead.research_summary],
    ] as [string, unknown][]
  )
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}: ${v}`)
    .join('\n')

  const channelRule =
    channel === 'sms'
      ? 'Write a concise SMS under ~320 characters — friendly, direct, with a clear ask to reply or schedule a quick look.'
      : 'Write a short outreach email. First line is the subject, prefixed exactly "Subject:". Then 3-5 short sentences, warm and professional, with one clear call to action. Sign off as "Bo — 1COMMERCE Drone Ops".'

  try {
    const draft = await cheapComplete({
      system: `You write first-touch outreach for a drone-spraying ag-services business. ${COMPANY_CONTEXT}\nGoal: earn a reply that leads to a spray/scouting job or a short call. Be specific to this lead's crop and situation. Never fabricate prices, guarantees, or facts not provided. ${channelRule}`,
      user: `Draft a ${channel} to this lead:\n${facts}`,
      maxTokens: 500,
      temperature: 0.6,
    })
    return NextResponse.json({ ok: true, channel, draft })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 })
  }
}
