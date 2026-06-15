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

CRITICAL RULES:
- You CAN move the user around the app. Whenever they ask to open / go to / show / take me to / pull up any section or map, you MUST call the navigate tool with the right page. Never claim a page or map is unavailable. The "EFB risk map" / "satellite map" / "risk map" is the intel page.
- When they ask you to DO something (advance a lead's stage, tag a lead, convert a lead to a customer, run automation / recompute EFB risk / geocode / map field boundaries), call the matching action tool, then briefly report what changed. Identify a lead by name when no id is given.
- For questions, call a read tool and answer from real data. NEVER invent numbers; if a tool returns nothing, say so.
- NEVER mention tool, function, or page-slug names to the user. Speak naturally ("Opening the EFB risk map…", not "calling navigate/get_kpis"). Plain text only, no markdown tables. Money as $X,XXX. Be concise.
- If an action is refused for permissions, say they need owner/partner access.
- Don't ask for confirmation on routine actions the user clearly requested — just do them and report. Only ask a short clarifying question when genuinely ambiguous.`

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

  // Contextual awareness: what page is open + which record is focused.
  const PAGE_NAMES: Record<string, string> = {
    '/': 'Overview', '/leads': 'Leads', '/discover': 'Discover', '/pipeline': 'Pipeline',
    '/customers': 'Customers', '/jobs': 'Jobs', '/field-ops': 'Field Ops', '/fields': 'Fields',
    '/finance': 'Finance', '/intel': 'EFB Intelligence Hub (satellite risk map)', '/alerts': 'Alerts',
    '/automation': 'Automation',
  }
  const reqCtx = body?.context ?? {}
  const focus = reqCtx?.focus && typeof reqCtx.focus === 'object' ? reqCtx.focus : null
  const pageName = PAGE_NAMES[String(reqCtx?.path ?? '')] ?? null
  let contextNote = ''
  if (pageName) contextNote += `\n\nCONTEXT: The user is currently on the ${pageName} page.`
  if (focus?.id && focus?.kind) {
    contextNote += ` They have ${focus.kind} "${focus.name ?? focus.id}" open — when they say "this ${focus.kind}", "this one", "them", or "it", act on that record (no need to ask which).`
  }

  const ctx: ToolContext = {
    isStaff: await resolveIsStaff(),
    actions: [],
    focusLeadId: focus?.kind === 'lead' ? String(focus.id) : null,
  }
  const system = SYSTEM + contextNote

  // ── Groq path (default) ──────────────────────────────────────────────────
  if (PROVIDER === 'groq') {
    if (!groqConfigured()) {
      return NextResponse.json(
        { ok: false, error: 'The assistant needs GROQ_API_KEY set (or ASSISTANT_PROVIDER=anthropic).' },
        { status: 503 }
      )
    }
    try {
      const { reply, actions } = await runGroqAssistant(incoming, system, ctx)
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
        system,
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
