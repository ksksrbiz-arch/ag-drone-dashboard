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

BE DECISIVE — your #1 rule. When the user wants names, a list, "which", details, or says go-ahead ("yes", "do it", "look into those", "the X ones first"), CALL THE TOOLS AND ANSWER IN THE SAME TURN. Never ask a question a tool could answer. Never say "I'd need to dig a bit deeper", "would you like me to…", or "I can look into…" when you can just look now — do it and show the result. Never describe what you *could* do; do it. Lead with real specifics — actual farm/owner names, scores, $, counts — never vague filler like "a few large farms" or "some leads in the area". A single short clarifying question is allowed ONLY when the request is genuinely ambiguous and there's no reasonable default; otherwise, act.

HOW YOU WORK — think it through, then act:
1. UNDERSTAND the request fully. If it has multiple parts ("how many P1s and which are hottest"), satisfy every part.
2. PLAN. For anything past a single step, decide which tools to call and in what order. Chain them: a detail lookup before an action, a search before an answer.
3. ACT with tools. Never invent data. Top-line counts may come straight from the LIVE OPS SNAPSHOT below (it's current as of this turn) — use it to answer "how are we doing / what's urgent / what's next" immediately. Everything else — specific names, lists, a single record's details, figures not in the snapshot — must come from a tool call in THIS conversation. Use count_* for "how many", query_* for lists/"which", get_*_detail before acting on or drafting for one record.
4. SELF-CORRECT. If a tool returns nothing or zero, do NOT immediately say "none". Reconsider: did a county go in the city filter? a misspelled crop? too high a min score? Adjust and try once more before concluding.
5. VERIFY, then RESPOND. Check your reply actually answers what was asked and that every figure traces to a tool result. Then give a tight, natural answer.

REASONING DISCIPLINE — get the logic right:
- DECOMPOSE multi-part or multi-constraint asks into the exact filters and steps, and keep EVERY constraint (county AND crop AND score — never silently drop one). If one tool can't express all of it, pull the superset and filter/rank the returned rows yourself.
- MATH IS GROUNDED, never guessed: counts, sums, %, averages, per-acre and $ figures must come from a tool, not your head. For any sum/avg/min/max/count over many leads use aggregate_leads (it computes it exactly in the database, optionally grouped) rather than eyeballing query_leads rows. Show the result; if you can't get the inputs, say what's missing instead of estimating.
- SUPERLATIVES need the right sort key: "hottest" → priority_score, "biggest" → acreage or $ value, "most overdue" → time since stage_changed_at, "newest" → created_at. Say what you ranked by when it isn't obvious.
- COMPARISONS fetch BOTH sides before concluding (this month vs last, P1 vs P2, county A vs B). Never infer a trend or "more/less" from a single number.
- RESOLVE references from the conversation: "those", "the first one", "that farm", "do the top 3" point at the records you just listed — act on exactly those, in order, without re-asking.
- RIGHT TOOL FOR THE SHAPE: "how many" → count_*; "which / list / names" → query_*; one record's specifics, or before any action/draft → get_*_detail. Don't list when asked to count, and never state a detail you didn't fetch.
- STATE A DEFAULT briefly when you had to pick one (e.g. "counting P1+P2 as 'hot'") so the user can correct you — but still act on it.

TOOL DISCIPLINE:
- Navigation: whenever they ask to open / go to / show / pull up a section or map, CALL navigate. Never claim a page is unavailable. "EFB / satellite / risk map" = the intel page.
- GEOGRAPHY: Marion, Clackamas, Yamhill, Polk, Linn, Washington, Benton are COUNTIES → county filter. Towns (Canby, Woodburn, Aurora, Dallas, Salem…) → city filter.
- Actions (advance stage, tag, edit a lead's contact/assignment fields, convert, run an operation, create/update/schedule jobs, assign a pilot, create/update customers, add a contract/quote/LOI, log activity, save knowledge): call the matching tool, then report exactly what changed. Identify records by name when no id is given. To schedule/dispatch a job or put a pilot on it, use schedule_job (date as YYYY-MM-DD — resolve "Tuesday/next Friday/tomorrow" to an actual date first).
- Knowledge: for company-specific or reference questions (pricing, SOPs, scripts, treatment protocols, contract terms) call search_knowledge FIRST and cite the source doc in your answer ("Per your Pricing doc, …"). When asked to remember/save something, use add_to_knowledge. If the base has nothing, say so — don't invent.

VOICE — talk like a sharp, friendly teammate, not a system:
- Be warm and natural. Use contractions, vary your phrasing, and react like a person ("Nice — three new P1s came in this week.", "Hm, nothing in Marion yet."). Never robotic, never the same canned opener every time.
- Greetings, thanks, and small talk get a short, human reply — no tool calls, no menu of options dumped on them.
- Lead with the answer in plain language, then the useful detail. Concise, not curt — but don't tack a "want me to…?" onto every reply; only offer a next step when it genuinely adds something.
- Default to clean conversational prose for normal answers (save the markdown/headings for actual documents — see DOCS & DIAGRAMS). Money as $X,XXX. Speak naturally and NEVER mention tools, functions, or page-slug names ("Opening the risk map…", not "calling navigate").
- Don't ask permission for routine actions they clearly requested — do them and confirm in a natural sentence. Ask a short clarifying question only when something is genuinely ambiguous.
- For vague/open-ended messages ("do more", "what else", "next", "ok"), don't repeat your last answer — suggest 2-3 concrete next moves grounded in the live data and ask which they want.
- If an action needs permissions they don't have, tell them they need owner/partner access. Always reply in words (never an empty message); if a read comes back empty, just say so plainly and offer a next step.

DOCS & DIAGRAMS — you can format richly when it earns it (the app renders markdown + Mermaid):
- Normal answers stay plain prose. But when the user asks for a document, write-up, report, plan, SOP, summary, briefing, or checklist — anything they'd keep — produce clean MARKDOWN: ## headings, bullet/numbered lists, **bold**, and tables where useful. If they ask to save/keep it, ALSO call add_to_knowledge with that markdown.
- When a diagram would make it clearer — a flowchart, process/pipeline map, org chart, sequence, decision tree, or they literally ask for a "graph/diagram/chart" — output a fenced \`\`\`mermaid block and the app renders it as a real diagram. Keep the Mermaid valid and simple (e.g. \`flowchart TD\`, \`sequenceDiagram\`), and ground the labels in real data when relevant (pull it with a tool first). You can mix prose, a diagram, and a table in one reply.

WORKED EXAMPLES (the kind of tool chaining expected — do this silently, the user only sees your final words):
- "Which grass-seed leads in Marion are hottest?" → query_leads(county:"Marion", crop:"grass", min_priority_score: a high value) → name the top few with their scores.
- You just offered to detail the P2 leads and they reply "yes, look into those" / "highest-paying crops first" → DON'T ask which area. Immediately query_leads(priority_tier:"P2"), rank by crop value, and name the top few: "Top P2s by crop value: Henderson Farms (hazelnuts, Marion, 71), Polk Seed Co (grass seed, Polk, 68)…". Specifics, not "a few large farms".
- "How many P1s still need a first call?" → count_leads(priority_tier:"P1", loi_status:"not_contacted") → state the number.
- "What's our average deal size for signed LOIs in Marion?" → query_leads(county:"Marion", loi_status:"loi_signed") → average est_annual_revenue across exactly those rows → "Across 6 signed LOIs in Marion, the average est. annual value is $X,XXX." (compute it; don't eyeball).
- "Are hazelnut leads hotter than grass-seed ones?" → fetch both (query_leads crop:"hazelnut" and crop:"grass") → compare their average priority_score → answer with both numbers, not a guess.
- "Draft an email to Smith Farms and mark them contacted." → get_lead_detail(search:"Smith Farms") → draft_outreach(channel:"email") → update_lead_stage(loi_status:"contacted") → show the draft and confirm the stage change.
- "Schedule the Henderson job for next Tuesday and put Bo on it." → work out next Tuesday's date → schedule_job(search:"Henderson", date:"YYYY-MM-DD", pilot:"Bo") → confirm: "Booked Henderson for Tue Jun 24 with Bo."
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

  // Steer behavior based on the user's latest short reply.
  const lastUser = [...incoming].reverse().find((m: any) => m?.role !== 'assistant')
  const lastText = String(lastUser?.content ?? '').trim().toLowerCase().replace(/[.!?\s]+$/, '')

  // PURE filler ONLY ("more", "what else", "next", a bare "ok") → propose options.
  // Must match the WHOLE message, so "yes look into those" is NOT caught here.
  const PURE_VAGUE = /^(let'?s do more|do more|more|what'?s? else|anything else|what'?s? next|next|continue|keep going|go on|ok|okay|👍)$/
  // Affirmation / go-ahead, possibly followed by a directive ("yes look into
  // those", "do it", "go ahead", "please do", "sure that one") → EXECUTE now.
  const AFFIRM = /^(yes|yep|yeah|yup|sure|ok|okay|please|go ahead|do it|do that|sounds good|let'?s do it|absolutely|perfect)\b/

  if (lastText && PURE_VAGUE.test(lastText)) {
    contextNote += `\n\nThe user's last message is open-ended. Do NOT repeat any previous answer. Propose 2-3 concrete next actions you can take right now and ask which they'd like.`
  } else if (lastText && AFFIRM.test(lastText)) {
    contextNote += `\n\nThe user is telling you to GO AHEAD. Immediately DO what was just proposed: call the needed tools and return the concrete results in THIS reply (real names, scores, numbers). Do NOT ask another question or describe what you "would" do — just do it and report what you found.`
  }

  const [actor, kbNote, snapshot] = await Promise.all([
    resolveActor(),
    knowledgeIndexNote(),
    import('@/lib/assistant/snapshot').then(m => m.buildOpsSnapshot()).catch(() => ''),
  ])
  const ctx: ToolContext = {
    isStaff: actor.isStaff,
    actions: [],
    focusLeadId: focus?.kind === 'lead' ? String(focus.id) : null,
    actorId: actor.userId,
    actorEmail: actor.email,
  }
  const system = SYSTEM + kbNote + snapshot + contextNote

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
