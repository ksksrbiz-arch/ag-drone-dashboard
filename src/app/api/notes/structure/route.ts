import { NextRequest, NextResponse } from 'next/server'
import { cheapComplete, aiConfigured, extractJson } from '@/lib/ai/llm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

const LOI_VALUES = [
  'not_contacted',
  'contacted',
  'meeting_scheduled',
  'loi_sent',
  'loi_signed',
  'declined',
]

const SYSTEM = `You structure rough call/meeting notes for an agricultural drone-spraying sales rep. From the raw notes, return ONLY JSON (no prose, no code fences) with this shape:
{
  "summary": string,                 // 1-2 sentence recap
  "next_steps": string[],            // concrete action items
  "suggested_loi_status": one of ${LOI_VALUES.join(' | ')} | null,   // pipeline stage implied by the notes, else null
  "tags": string[]                   // optional short keywords
}
Only set suggested_loi_status if the notes clearly imply it (e.g. "scheduled a meeting" -> meeting_scheduled, "they signed" -> loi_signed). Otherwise null.`

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
  const notes = String(body?.notes ?? '').trim()
  if (!notes) return NextResponse.json({ ok: false, error: 'notes required' }, { status: 400 })

  try {
    const raw = await cheapComplete({ system: SYSTEM, user: notes, maxTokens: 500, temperature: 0.2 })
    const structured = extractJson<any>(raw) ?? { summary: raw, next_steps: [], suggested_loi_status: null, tags: [] }
    // Validate suggested status against the enum.
    if (structured.suggested_loi_status && !LOI_VALUES.includes(structured.suggested_loi_status)) {
      structured.suggested_loi_status = null
    }
    return NextResponse.json({ ok: true, structured })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 })
  }
}
