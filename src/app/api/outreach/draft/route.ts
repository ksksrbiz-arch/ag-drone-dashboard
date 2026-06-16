import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { aiConfigured } from '@/lib/ai/llm'
import { composeOutreachText } from '@/lib/outreach/draft'

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

  try {
    const draft = await composeOutreachText(lead, channel)
    return NextResponse.json({ ok: true, channel, draft })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 })
  }
}
