import { NextRequest, NextResponse } from 'next/server'
import { cheapComplete, aiConfigured, extractJson } from '@/lib/ai/llm'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 20

const SYSTEM = `Convert a plain-English request about agricultural sales leads into a JSON filter.
Output ONLY JSON (no prose, no code fences). Omit any field the user didn't mention.
Schema:
{
  "text": string,            // free-text name/keyword
  "county": string,
  "city": string,
  "crop": string,            // matches primary_crop
  "vertical": "ag_spray" | "insurance" | "real_estate" | "construction",
  "priority_tier": "P1" | "P2" | "P3" | "P4",
  "loi_status": "not_contacted" | "contacted" | "meeting_scheduled" | "loi_sent" | "loi_signed" | "declined",
  "action_recommendation": "TREAT_NOW" | "SCOUT_NOW" | "CONTACT_NOW" | "MONITOR",
  "min_priority_score": number,
  "sort": "priority_score" | "lead_score" | "composite_efb_risk" | "distance_to_canby_mi"
}
Map "hottest"/"top"/"best" to sort "priority_score". Map "needs treatment" to action_recommendation "TREAT_NOW".
Example: "hottest hazelnut leads in Marion county not contacted" ->
{"crop":"hazelnut","county":"Marion","loi_status":"not_contacted","sort":"priority_score"}`

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
  const query = String(body?.query ?? '').trim()
  if (!query) return NextResponse.json({ ok: false, error: 'query required' }, { status: 400 })

  try {
    const raw = await cheapComplete({ system: SYSTEM, user: query, maxTokens: 250, temperature: 0 })
    const filter = extractJson(raw) ?? {}
    return NextResponse.json({ ok: true, filter })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 })
  }
}
