import { TOOLS, runTool, type ToolContext } from './tools'
import { modelCandidates, noteWorkingModel, shouldTryNextModel } from './groqModel'
import { recoverToolCalls } from './recover'
import { answerWithoutTools } from './groq'

// ─────────────────────────────────────────────────────────────────────────
// Streaming agentic loop for the Sidekick assistant (Groq, OpenAI-compatible).
//
// Streams each turn token-by-token. When the model calls tools, we emit a
// status line, run them, and continue; when it produces the final text, those
// tokens are already streamed. Emits typed SSE events via `emit`.
// ─────────────────────────────────────────────────────────────────────────

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
// Generous turn budget so the agent can chain several tools (look up → act →
// verify) within one streamed request instead of stopping short.
const MAX_TURNS = 10
const MAX_TOKENS = 2048

const OPENAI_TOOLS = TOOLS.map(t => ({
  type: 'function' as const,
  function: { name: t.name, description: t.description, parameters: t.input_schema },
}))

export type StreamEvent =
  | { type: 'status'; text: string }
  | { type: 'token'; text: string }
  | { type: 'done'; actions: ToolContext['actions']; undo: ToolContext['undo']; cards: ToolContext['cards'] }
  | { type: 'error'; error: string }

const TOOL_STATUS: Record<string, string> = {
  get_kpis: 'Pulling the latest numbers…',
  query_leads: 'Searching leads…',
  count_leads: 'Counting leads…',
  breakdown_leads: 'Breaking that down…',
  create_lead: 'Adding the lead…',
  mark_alerts_read: 'Clearing alerts…',
  query_customers: 'Looking up customers…',
  get_customer_detail: 'Pulling up that customer…',
  update_customer_status: 'Updating the customer…',
  add_customer_note: 'Adding that note…',
  query_jobs: 'Checking jobs…',
  get_finance_summary: 'Tallying the money…',
  update_job_status: 'Updating the job…',
  create_job: 'Creating the job…',
  query_fields: 'Checking mapped fields…',
  get_fields_summary: 'Totaling the acreage…',
  query_alerts: 'Checking alerts…',
  log_activity: 'Logging that…',
  get_activity: 'Pulling up the history…',
  get_recent_activity: 'Reviewing recent activity…',
  search_knowledge: 'Searching the knowledge base…',
  list_knowledge: 'Checking what reference docs exist…',
  add_to_knowledge: 'Saving that to the knowledge base…',
  get_lead_detail: 'Pulling up that lead…',
  draft_outreach: 'Drafting that message…',
  navigate: 'Opening that…',
  update_lead_stage: 'Updating the pipeline stage…',
  tag_lead: 'Tagging…',
  convert_lead_to_customer: 'Converting to a customer…',
  run_operation: 'Running that operation…',
  bulk_tag_leads: 'Tagging the matching leads…',
  bulk_update_stage: 'Updating the matching leads…',
}

export async function streamGroqAssistant(
  userMessages: { role: string; content: string }[],
  system: string,
  ctx: ToolContext,
  emit: (e: StreamEvent) => void
): Promise<void> {
  const key = process.env.GROQ_API_KEY
  if (!key) {
    emit({ type: 'error', error: 'GROQ_API_KEY is not set' })
    return
  }

  const messages: any[] = [
    { role: 'system', content: system },
    ...userMessages.slice(-12).map(m => ({
      role: m.role === 'assistant' ? 'assistant' : 'user',
      content: String(m.content ?? ''),
    })),
  ]

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let res: Response | null = null
    let lastBody = ''
    for (const model of modelCandidates()) {
      res = await fetch(GROQ_URL, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages, tools: OPENAI_TOOLS, tool_choice: 'auto', max_tokens: MAX_TOKENS, temperature: 0.2, stream: true }),
      })
      if (res.ok && res.body) {
        noteWorkingModel(model)
        break
      }
      lastBody = await res.text().catch(() => '')
      // A model that's unavailable or fumbled the tool call — try the next
      // candidate. Anything else is a real error.
      if (!shouldTryNextModel(res.status, lastBody)) {
        emit({ type: 'error', error: `Groq ${res.status}` })
        return
      }
    }

    let content = ''
    const toolCalls: { id: string; name: string; args: string }[] = []
    let finish = ''

    if (!res || !res.ok || !res.body) {
      // Every candidate failed — most likely tool_use_failed. Recover any
      // leaked text-format tool call so the user's intent still happens.
      const recovered = recoverToolCalls(lastBody)
      if (!recovered) {
        let reply: string
        if (ctx.actions.some(a => a.type === 'navigate')) reply = 'Opening that for you.'
        else if (ctx.actions.length) reply = 'Done.'
        else reply = (await answerWithoutTools(key, messages).catch(() => '')) || 'Sorry, I had trouble with that one — try rephrasing it?'
        emit({ type: 'token', text: reply })
        emit({ type: 'done', actions: ctx.actions, undo: ctx.undo ?? null, cards: ctx.cards ?? [] })
        return
      }
      messages.push({ role: 'assistant', content: null, tool_calls: recovered })
      for (const c of recovered) {
        emit({ type: 'status', text: TOOL_STATUS[c.function.name] ?? 'Working…' })
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(c.function.arguments || '{}')
        } catch {}
        const result = await runTool(c.function.name, args, ctx)
        messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result).slice(0, 12000) })
      }
      continue
    }

    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trim()
        if (!t.startsWith('data:')) continue
        const payload = t.slice(5).trim()
        if (payload === '[DONE]') continue
        let json: any
        try {
          json = JSON.parse(payload)
        } catch {
          continue
        }
        const choice = json?.choices?.[0]
        const delta = choice?.delta
        if (choice?.finish_reason) finish = choice.finish_reason
        if (delta?.content) {
          content += delta.content
          emit({ type: 'token', text: delta.content })
        }
        if (Array.isArray(delta?.tool_calls)) {
          for (const tc of delta.tool_calls) {
            const i = tc.index ?? 0
            toolCalls[i] = toolCalls[i] || { id: '', name: '', args: '' }
            if (tc.id) toolCalls[i].id = tc.id
            if (tc.function?.name) toolCalls[i].name = tc.function.name
            if (tc.function?.arguments) toolCalls[i].args += tc.function.arguments
          }
        }
      }
    }

    const calls = toolCalls.filter(Boolean)
    if (calls.length && finish !== 'stop') {
      messages.push({
        role: 'assistant',
        content: content || null,
        tool_calls: calls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: c.args } })),
      })
      for (const c of calls) {
        emit({ type: 'status', text: TOOL_STATUS[c.name] ?? 'Working…' })
        let args: Record<string, unknown> = {}
        try {
          args = JSON.parse(c.args || '{}')
        } catch {}
        const result = await runTool(c.name, args, ctx)
        messages.push({ role: 'tool', tool_call_id: c.id, content: JSON.stringify(result).slice(0, 12000) })
      }
      continue
    }

    if (!content.trim()) {
      // Empty turn after tool results — synthesize a grounded answer (tool
      // results are still in context) instead of emitting a bare "Done."; fall
      // back to a short confirmation only if even that comes back empty.
      let reply = (await answerWithoutTools(key, messages).catch(() => '')).trim()
      if (!reply) reply = ctx.actions.some(a => a.type === 'navigate') ? 'Opening that for you.' : 'Done.'
      emit({ type: 'token', text: reply })
    }
    emit({ type: 'done', actions: ctx.actions, undo: ctx.undo ?? null, cards: ctx.cards ?? [] })
    return
  }

  emit({ type: 'done', actions: ctx.actions, undo: ctx.undo ?? null, cards: ctx.cards ?? [] })
}
