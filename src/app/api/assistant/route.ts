import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { TOOLS, runTool, type ToolContext } from '@/lib/assistant/tools'
import { runGroqAssistant, groqConfigured } from '@/lib/assistant/groq'
import { createSupabaseServer } from '@/lib/supabase/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { BUSINESS, CITY_SHORT, PRODUCT_NAME, ASSISTANT_NAME } from '@/lib/business'

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
const MAX_TURNS = 10

const SYSTEM = `You are ${ASSISTANT_NAME}, the AI assistant built into ${PRODUCT_NAME} — the drone-operations platform for ${BUSINESS.name || 'a drone-services business'}${CITY_SHORT ? ` (based in ${BUSINESS.city})` : ''}. You help the team run the business and you can DRIVE the app for them.

You have tools to (a) READ live data, (b) NAVIGATE the app, (c) take ACTIONS, and (d) read & write a knowledge base. You are a capable agent: you can call several tools in sequence, feeding each result into the next step, before you answer.

HOW YOU WORK — think it through, then act:
1. UNDERSTAND the request fully. If it has multiple parts ("how many P1s and which are hottest"), satisfy every part.
2. PLAN. For anything past a single step, decide which tools to call and in what order. Chain them: a detail lookup before an action, a search before an answer.
3. ACT with tools. NEVER guess or recall data — every number, name, status, and dollar figure must come from a tool call in THIS conversation. Use count_* for "how many", query_* for lists/"which", get_*_detail before acting on or drafting for one record.
4. SELF-CORRECT. If a tool returns nothing or zero, do NOT immediately say "none". Reconsider: did a county go in the city filter? a misspelled crop? too high a min score? Adjust and try once more before concluding.
5. VERIFY, then RESPOND. Check your reply actually answers what was asked and that every figure traces to a tool result. Then give a tight, natural answer.

TOOL DISCIPLINE:
- Navigation: whenever they ask to open / go to / show / pull up a section or map, CALL navigate. Never claim a page is unavailable. "EFB / satellite / risk map" = the intel page.
- GEOGRAPHY: Marion, Clackamas, Yamhill, Polk, Linn, Washington, Benton are COUNTIES → county filter. Towns (Canby, Woodburn, Aurora, Dallas, Salem…) → city filter.
- Actions (advance stage, tag, convert, run an operation, create/update jobs, update customers, save knowledge): call the matching tool, then report exactly what changed. Identify records by name when no id is given.
- Knowledge: for company-specific or reference questions (pricing, SOPs, scripts, treatment protocols, contract terms) call search_knowledge FIRST and cite the source doc in your answer ("Per your Pricing doc, …"). When asked to remember/save something, use add_to_knowledge. If the base has nothing, say so — don't invent.

VOICE — talk like a sharp, friendly teammate, not a system:
- Be warm and natural. Use contractions, vary your phrasing, and react like a person ("Nice — three new P1s came in this week.", "Hm, nothing in Marion yet."). Never robotic, never the same canned opener every time.
- Greetings, thanks, and small talk get a short, human reply — no tool calls, no menu of options dumped on them.
- Lead with the answer in plain language, then the useful detail. Concise, not curt: a sentence of context or a "want me to…?" is welcome when it actually helps.
- Plain text only (no markdown tables or headers). Money as $X,XXX. Speak naturally and NEVER mention tools, functions, or page-slug names ("Opening the risk map…", not "calling navigate").
- Don't ask permission for routine actions they clearly requested — do them and confirm in a natural sentence. Ask a short clarifying question only when something is genuinely ambiguous.
- For vague/open-ended messages ("do more", "what else", "next", "ok"), don't repeat your last answer — suggest 2-3 concrete next moves grounded in the live data and ask which they want.
- If an action needs permissions they don't have, tell them they need owner/partner access. Always reply in words (never an empty message); if a read comes back empty, just say so plainly and offer a next step.

WORKED EXAMPLES (the kind of tool chaining expected — do this silently, the user only sees your final words):
- "Which grass-seed leads in Marion are hottest?" → query_leads(county:"Marion", crop:"grass", min_priority_score: a high value) → name the top few with their scores.
- "How many P1s still need a first call?" → count_leads(priority_tier:"P1", loi_status:"not_contacted") → state the number.
- "Draft an email to Smith Farms and mark them contacted." → get_lead_detail(search:"Smith Farms") → draft_outreach(channel:"email") → update_lead_stage(loi_status:"contacted") → show the draft and confirm the stage change.
- "What do we charge per acre?" → search_knowledge("per-acre rate pricing") → answer and name the doc; if empty, say it isn't in the knowledge base yet.
- A query comes back empty → broaden it (drop city→county, lower the min score, loosen the crop term) and try once more before reporting none.`

// A compact index of the knowledge base so the model knows what reference
// material exists and reaches for search_knowledge instead of guessing.
async function knowledgeIndexNote(): Promise<string> {
  try {
    const { data } = await getAdminClient()
      .from('knowledge_documents')
      .select('folder,title')
      .order('folder')
      .limit(60)
    if (!data?.length) return ''
    const byFolder: Record<string, string[]> = {}
    for (const d of data as any[]) (byFolder[d.folder] ||= []).push(d.title)
    const lines = Object.entries(byFolder)
      .map(([folder, titles]) => `${folder}: ${titles.slice(0, 8).join(', ')}${titles.length > 8 ? '…' : ''}`)
      .join('; ')
    return `\n\nKNOWLEDGE BASE (call search_knowledge to read these before answering company-specific/reference questions) — ${lines}.`
  } catch {
    return ''
  }
}

interface Actor {
  isStaff: boolean
  userId: string | null
  email: string | null
}

async function resolveActor(): Promise<Actor> {
  try {
    const supabase = await createSupabaseServer()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return { isStaff: false, userId: null, email: null }
    const { data } = await supabase.from('profiles').select('role').eq('id', user.id).single()
    const isStaff = data?.role === 'owner' || data?.role === 'partner'
    return { isStaff, userId: user.id, email: user.email ?? null }
  } catch {
    return { isStaff: false, userId: null, email: null }
  }
}

export async function POST(req: NextRequest) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 })
  }
  // ── Undo path: client clicked Undo → run the stored inverse op directly. ──
  if (body?.undo?.tool) {
    const actor = await resolveActor()
    const ctx: ToolContext = { isStaff: actor.isStaff, actions: [], actorId: actor.userId, actorEmail: actor.email }
    const result: any = await runTool(String(body.undo.tool), body.undo.args ?? {}, ctx)
    if (result?.error) return NextResponse.json({ ok: true, reply: result.error, actions: ctx.actions })
    return NextResponse.json({
      ok: true,
      reply: `Undone — reverted ${body.undo.label ?? 'the last change'}.`,
      actions: ctx.actions,
      undo: null,
    })
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
    '/automation': 'Automation', '/knowledge': 'Knowledge Base',
  }
  const reqCtx = body?.context ?? {}
  const focus = reqCtx?.focus && typeof reqCtx.focus === 'object' ? reqCtx.focus : null
  const pageName = PAGE_NAMES[String(reqCtx?.path ?? '')] ?? null
  let contextNote = ''
  if (pageName) contextNote += `\n\nCONTEXT: The user is currently on the ${pageName} page.`
  if (focus?.id && focus?.kind) {
    contextNote += ` They have ${focus.kind} "${focus.name ?? focus.id}" open — when they say "this ${focus.kind}", "this one", "them", or "it", act on that record (no need to ask which).`
  }

  // One-off attachment: the user attached a file to this message. Inject its
  // text so the assistant can answer from it (without saving to the knowledge base).
  const attachment = reqCtx?.attachment && typeof reqCtx.attachment === 'object' ? reqCtx.attachment : null
  if (attachment?.text) {
    const name = String(attachment.name ?? 'the file')
    const text = String(attachment.text).slice(0, 24000)
    contextNote += `\n\nATTACHED FILE — the user attached "${name}" to this message. Use it as the primary context for their request; quote/summarize from it as needed:\n"""\n${text}\n"""`
  }

  // Vague / open-ended follow-up ("lets do more", "what else", "next") — steer
  // the model to propose concrete next actions instead of echoing its last reply.
  const lastUser = [...incoming].reverse().find((m: any) => m?.role !== 'assistant')
  const lastText = String(lastUser?.content ?? '').trim().toLowerCase()
  const VAGUE = /^(let'?s?\s+do\s+more|do\s+more|more|what'?s?\s+else|anything\s+else|what'?s?\s+next|next|continue|keep\s+going|go\s+on|ok(ay)?|sure|yep|yes|👍)\b/
  if (lastText && lastText.length <= 28 && VAGUE.test(lastText)) {
    contextNote += `\n\nThe user's last message is open-ended. Do NOT repeat any previous answer. Propose 2-3 concrete next actions you can take right now (navigate somewhere useful, pull a specific report, or act on leads/jobs/fields) and ask which they'd like.`
  }

  const [actor, kbNote] = await Promise.all([resolveActor(), knowledgeIndexNote()])
  const ctx: ToolContext = {
    isStaff: actor.isStaff,
    actions: [],
    focusLeadId: focus?.kind === 'lead' ? String(focus.id) : null,
    actorId: actor.userId,
    actorEmail: actor.email,
  }
  const system = SYSTEM + kbNote + contextNote

  // ── Streaming path (SSE) — used by the Sidekick UI ───────────────────────
  if (body?.stream && PROVIDER === 'groq' && groqConfigured()) {
    const { streamGroqAssistant } = await import('@/lib/assistant/stream')
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const emit = (e: unknown) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`))
        try {
          await streamGroqAssistant(incoming, system, ctx, emit as any)
        } catch (err: any) {
          emit({ type: 'error', error: String(err?.message ?? err) })
        } finally {
          controller.close()
        }
      },
    })
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
      },
    })
  }

  // ── Groq path (default, non-streaming) ───────────────────────────────────
  if (PROVIDER === 'groq') {
    if (!groqConfigured()) {
      return NextResponse.json(
        { ok: false, error: 'The assistant needs GROQ_API_KEY set (or ASSISTANT_PROVIDER=anthropic).' },
        { status: 503 }
      )
    }
    try {
      const { reply, actions, undo, cards } = await runGroqAssistant(incoming, system, ctx)
      return NextResponse.json({ ok: true, reply, actions, undo, cards })
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
    return NextResponse.json({ ok: true, reply, actions: ctx.actions, undo: ctx.undo ?? null, cards: ctx.cards ?? [] })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 })
  }
}
