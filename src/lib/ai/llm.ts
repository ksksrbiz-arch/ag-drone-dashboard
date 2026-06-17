// ─────────────────────────────────────────────────────────────────────────
// Provider-agnostic cheap-inference helper for non-search LLM tasks: digest
// narration, outreach drafts, smart search, tagging. Groq and OpenRouter are
// both OpenAI-compatible; Claude (Anthropic SDK) is the fallback.
//
// Picks whatever is configured, in order of preference:
//   AI_PROVIDER (explicit) → Groq → OpenRouter → Anthropic
//
// Web-search research stays on Claude in the enrichment engine — this layer is
// for fast, cheap text generation that doesn't need tools or search.
// ─────────────────────────────────────────────────────────────────────────

import { BRAND_NAME } from '@/lib/business'

export interface ChatOpts {
  system: string
  user: string
  maxTokens?: number
  temperature?: number
  json?: boolean
}

interface Resolved {
  kind: 'openai' | 'anthropic'
  url: string
  key: string
  model: string
  label: string
}

function resolveProvider(): Resolved | null {
  const pref = process.env.AI_PROVIDER // 'groq' | 'openrouter' | 'anthropic'
  const groqKey = process.env.GROQ_API_KEY
  const orKey = process.env.OPENROUTER_API_KEY
  const anthKey = process.env.ANTHROPIC_API_KEY

  const groq: Resolved | null = groqKey
    ? {
        kind: 'openai',
        url: 'https://api.groq.com/openai/v1/chat/completions',
        key: groqKey,
        model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
        label: 'groq',
      }
    : null
  const openrouter: Resolved | null = orKey
    ? {
        kind: 'openai',
        url: 'https://openrouter.ai/api/v1/chat/completions',
        key: orKey,
        model: process.env.OPENROUTER_MODEL || 'meta-llama/llama-3.3-70b-instruct:free',
        label: 'openrouter',
      }
    : null
  const anthropic: Resolved | null = anthKey
    ? {
        kind: 'anthropic',
        url: '',
        key: anthKey,
        model: process.env.ASSISTANT_MODEL || process.env.ENRICHMENT_MODEL || 'claude-sonnet-4-6',
        label: 'anthropic',
      }
    : null

  if (pref === 'groq') return groq ?? openrouter ?? anthropic
  if (pref === 'openrouter') return openrouter ?? groq ?? anthropic
  if (pref === 'anthropic') return anthropic ?? groq ?? openrouter
  return groq ?? openrouter ?? anthropic
}

export function aiConfigured(): boolean {
  return resolveProvider() !== null
}

/** The provider + model that cheap-inference (incl. enrichment analysis) will
 *  use right now, for display on the dashboard. Null when nothing is configured. */
export function activeProvider(): { provider: string; model: string } | null {
  const p = resolveProvider()
  return p ? { provider: p.label, model: p.model } : null
}

/** Text + metadata (token usage, provider, model) from one completion. */
export interface CompletionResult {
  text: string
  tokens: number
  provider: string
  model: string
}

/**
 * Like {@link cheapComplete} but also reports token usage and which
 * provider/model served the call — used by the enrichment engine for per-run
 * cost accounting. Token counts are best-effort (providers that omit `usage`
 * report 0).
 */
export async function cheapCompleteDetailed(opts: ChatOpts): Promise<CompletionResult> {
  const p = resolveProvider()
  if (!p) {
    throw new Error('No AI provider configured (set GROQ_API_KEY, OPENROUTER_API_KEY, or ANTHROPIC_API_KEY).')
  }
  return p.kind === 'anthropic' ? anthropicComplete(p, opts) : openaiComplete(p, opts)
}

export async function cheapComplete(opts: ChatOpts): Promise<string> {
  return (await cheapCompleteDetailed(opts)).text
}

async function openaiComplete(p: Resolved, opts: ChatOpts): Promise<CompletionResult> {
  const res = await fetch(p.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${p.key}`,
      'Content-Type': 'application/json',
      // OpenRouter likes these; harmless for Groq.
      'X-Title': BRAND_NAME,
    },
    body: JSON.stringify({
      model: p.model,
      messages: [
        { role: 'system', content: opts.system },
        { role: 'user', content: opts.user },
      ],
      max_tokens: opts.maxTokens ?? 800,
      temperature: opts.temperature ?? 0.4,
    }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`${p.label} ${res.status}: ${body.slice(0, 300)}`)
  }
  const json = await res.json()
  return {
    text: String(json?.choices?.[0]?.message?.content ?? '').trim(),
    tokens: Number(json?.usage?.total_tokens ?? 0) || 0,
    provider: p.label,
    model: p.model,
  }
}

async function anthropicComplete(p: Resolved, opts: ChatOpts): Promise<CompletionResult> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default
  const client = new Anthropic({ apiKey: p.key })
  const resp: any = await (client.messages.create as any)({
    model: p.model,
    max_tokens: opts.maxTokens ?? 800,
    system: opts.system,
    messages: [{ role: 'user', content: opts.user }],
  })
  const text = (resp?.content ?? [])
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('\n')
    .trim()
  const usage = resp?.usage ?? {}
  return {
    text,
    tokens: (Number(usage.input_tokens ?? 0) || 0) + (Number(usage.output_tokens ?? 0) || 0),
    provider: p.label,
    model: p.model,
  }
}

/** Lenient JSON extraction — pulls the first {...} object out of a model reply. */
export function extractJson<T = any>(text: string): T | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1)) as T
  } catch {
    return null
  }
}
