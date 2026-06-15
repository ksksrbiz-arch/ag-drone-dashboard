import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { TOOLS, runTool, type ToolContext } from '@/lib/assistant/tools'
import { runGroqAssistant, groqConfigured } from '@/lib/assistant/groq'
import { createSupabaseServer } from '@/lib/supabase/server'
import { BUSINESS, CITY_SHORT } from '@/lib/business'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Prefer Groq (free, fast, tool-calling) unless explicitly set to anthropic.
// Anthropic requires credits; Groq does not.
const PROVIDER =
  process.env.ASSISTANT_PROVIDER === 'anthropic' && process.env.ANTHROPIC_API_KEY
    ? 'anthropic'
    : 'groq'
const MODEL = process.env.ASSISTANT_MODEL || process.env.ENRICHMENT_MODEL || 'claude-sonnet-4-6'
const MAX_TURNS = 6

const SYSTEM = `You are Sidekick, the operations co-pilot for ${BUSINESS.name || 'a drone-spraying ag-services business'}${CITY_SHORT ? ` (based in ${BUSINESS.city})` : ''}. You help the team run the business and you can DRIVE the dashboard for them.

You have tools to (a) read live data, (b) NAVIGATE the app, and (c) take ACTIONS.

How to behave:
- When the user asks to go somewhere ("open the EFB map", "take me to pipeline"), call navigate. The UI moves immediately — confirm in one short line.
- When they ask you to DO something (advance a lead's stage, tag a lead, convert a lead to a customer, run automation / recompute EFB risk / geocode / map field boundaries), call the matching action tool, then briefly report what changed. Identify a lead by name when no id is given.
- For questions, call read tools and answer from real data. NEVER invent numbers; if a tool returns nothing, say so.
- Be concise and practical. Plain text only (no markdown tables). Money as $X,XXX.
- If an action is refused for permissions, tell the user they need owner/partner access.
- Don't ask for confirmation on routine actions the user clearly requested; just do it and report. For anything ambiguous, ask one short clarifying question first.`

async function resolveIsStaff(): Promise<boolean> {
  try {
    const supabase = await createSupabaseServer()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return false
    const { data } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    return data?.role === 'owner' || data?.role === 'partner'
  } catch {
    return false
  }
}

export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 })
  }
  const incoming = Array.isArray(body?.messages) ? body.messages : null
  if (!incoming) {
    return NextResponse.json({ ok: false, error: 'messages[] required' }, { status: 400 })
  }

  const ctx: ToolContext = { isStaff: await resolveIsStaff(), actions: [] }

  // ── Groq path (default) ──────────────────────────────────────────────────
  if (PROVIDER === 'groq') {
    if (!groqConfigured()) {
      return NextResponse.json(
        { ok: false, error: 'The assistant needs GROQ_API_KEY set (or ASSISTANT_PROVIDER=anthropic).' },
        { status: 503 }
      )
    }
    try {
      const { reply, actions } = await runGroqAssistant(incoming, SYSTEM, ctx)
      return NextResponse.json({ ok: true, reply, actions })
    } catch (err: any) {
      return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 })
    }
  }

  // ── Claude path (opt-in; needs credits) ──────────────────────────────────
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const messages: any[] = incoming.slice(-12).map((m: any) => ({
    role: m.role === 'assistant' ? 'assistant' : 'user',
    content: String(m.content ?? ''),
  }))

  try {
    let final: any = null
    for (let turn = 0; turn < MAX_TURNS; turn++) {
      const resp: any = await (anthropic.messages.create as any)({
        model: MODEL,
        max_tokens: 1500,
        system: SYSTEM,
        tools: TOOLS.map(t => ({ name: t.name, description: t.description, input_schema: t.input_schema })),
        messages,
      })

      if (resp?.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: resp.content })
        const toolResults: any[] = []
        for (const block of resp.content) {
          if (block?.type === 'tool_use') {
            const result = await runTool(block.name, block.input ?? {}, ctx)
            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(result).slice(0, 12000),
            })
          }
        }
        messages.push({ role: 'user', content: toolResults })
        continue
      }
      final = resp
      break
    }

    const reply =
      final?.content
        ?.filter((b: any) => b.type === 'text')
        .map((b: any) => b.text)
        .join('\n')
        .trim() || 'Done.'
    return NextResponse.json({ ok: true, reply, actions: ctx.actions })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 })
  }
}
