import { NextRequest, NextResponse } from 'next/server'
import Anthropic from '@anthropic-ai/sdk'
import { TOOLS, runTool } from '@/lib/assistant/tools'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MODEL = process.env.ASSISTANT_MODEL || process.env.ENRICHMENT_MODEL || 'claude-opus-4-8'
const MAX_TURNS = 6

const SYSTEM = `You are the operations assistant for 1COMMERCE Drone Ops — a drone-spraying business based in Canby, Oregon, run by the owner and Bo (field ops). You help them run the business day to day.

Answer questions about their leads, customers, jobs, mapped fields, and finances by calling the provided read-only tools. NEVER invent numbers — if you don't have data, call a tool; if a tool returns nothing, say so plainly.

Guidance:
- Use get_kpis or count_leads for totals/"how many" questions (there are 1000+ leads).
- Use query_* tools for specifics, then summarize — don't dump raw rows.
- Lead with the direct answer, then a short supporting list only if it helps.
- Be concise and practical. Plain text only (no markdown tables). Money as $X,XXX.`

export async function POST(req: NextRequest) {
  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json(
      { ok: false, error: 'The assistant isn’t configured — set ANTHROPIC_API_KEY.' },
      { status: 503 }
    )
  }

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
        tools: TOOLS,
        messages,
      })

      if (resp?.stop_reason === 'tool_use') {
        messages.push({ role: 'assistant', content: resp.content })
        const toolResults: any[] = []
        for (const block of resp.content) {
          if (block?.type === 'tool_use') {
            const result = await runTool(block.name, block.input ?? {})
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
        .trim() || 'I wasn’t able to answer that — try rephrasing?'

    return NextResponse.json({ ok: true, reply })
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 })
  }
}
