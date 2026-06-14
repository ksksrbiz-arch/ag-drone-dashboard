import Anthropic from '@anthropic-ai/sdk'
import type { Lead } from '@/lib/supabase'
import type { ResearchResult } from './types'
import { COMPANY_CONTEXT, EFFORT, MODEL } from './config'
import { BUSINESS } from '@/lib/business'
import { missingFields } from './completeness'

// ─────────────────────────────────────────────────────────────────────────
// AI web research + reasoning.
//
// Uses Claude with the web-search server tool to research a single lead, then
// reasons about the "best approach for us specifically". Returns a structured
// object; never fabricates — unknown fields come back null with a confidence.
//
// The request body is assembled as a plain object and passed through the SDK so
// the pipeline stays robust to SDK version drift on the newest params
// (adaptive thinking, effort, web-search tool version).
// ─────────────────────────────────────────────────────────────────────────

let client: Anthropic | null = null
function getClient(): Anthropic {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  return client
}

const SYSTEM = `You are a B2B lead-research analyst for an agricultural drone-services company.

${COMPANY_CONTEXT}

Your job: research ONE lead using web search, then return verified facts plus a
recommendation tailored to this company. Rules:
- Use web search to find and corroborate the business, owner/operator, crops,
  acreage, and current contact info (phone, email, website).
- NEVER invent or guess. If you cannot verify a value, return null for it.
- Prefer recent, authoritative sources (the business's own site, Google Business,
  county/USDA/extension records, ag directories, LinkedIn).
- "recommended_approach" must be specific to THIS lead and to a drone spray /
  scouting operator in ${BUSINESS.region} — what to lead with, which service
  fits, timing, and the single best way to make contact.
- Report a calibrated overall confidence in [0,1].

Return ONLY a single fenced \`\`\`json code block, no prose before or after, with
exactly these keys:
{
  "business_name": string|null,
  "owner_name": string|null,
  "contact_name": string|null,
  "primary_crop": string|null,
  "crop_types": string[]|null,
  "phone": string|null,
  "email": string|null,
  "website": string|null,
  "est_acreage": number|null,
  "recommended_approach": string|null,
  "best_contact_method": string|null,
  "research_summary": string|null,
  "confidence": number,
  "field_sources": { [field: string]: string }
}`

function leadBrief(lead: Lead): string {
  const lines = [
    `Vertical: ${lead.vertical}`,
    field('Business name', lead.business_name),
    field('Owner', lead.owner_name),
    field('Contact', lead.contact_name),
    field('Primary crop', lead.primary_crop),
    field('Est. acreage', lead.est_acreage),
    field('Address', lead.address_physical),
    field('City', lead.city),
    field('County', lead.county),
    field('State', lead.state),
    field('Zip', lead.zipcode),
    field('Phone', lead.phone),
    field('Email', lead.email),
    field('Website', lead.website),
    field('Source', lead.source),
    field('Notes', lead.notes),
  ].filter(Boolean)

  const gaps = missingFields(lead)
  return `Research this lead and fill gaps. Known data:
${lines.join('\n')}

Fields still missing (prioritize verifying these): ${
    gaps.length ? gaps.join(', ') : '(none — confirm and refresh existing values)'
  }`
}

function field(label: string, v: unknown): string | null {
  if (v == null || (typeof v === 'string' && v.trim() === '')) return null
  return `${label}: ${v}`
}

const MAX_SERVER_TOOL_TURNS = 6

export async function researchLead(lead: Lead): Promise<ResearchResult> {
  const anthropic = getClient()

  // Assembled as `any` so newer fields (effort, adaptive thinking, web-search
  // tool version) pass through regardless of the installed SDK's typings.
  const body: Record<string, unknown> = {
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    output_config: { effort: EFFORT },
    system: SYSTEM,
    tools: [{ type: 'web_search_20260209', name: 'web_search' }],
    messages: [{ role: 'user', content: leadBrief(lead) }],
  }

  let aiCalls = 0
  let response: any
  // Server-side tools run an agentic loop; on pause_turn we re-send to resume.
  for (let turn = 0; turn < MAX_SERVER_TOOL_TURNS; turn++) {
    aiCalls++
    response = await (anthropic.messages.create as any)(body)
    if (response?.stop_reason !== 'pause_turn') break
    ;(body.messages as unknown[]).push({
      role: 'assistant',
      content: response.content,
    })
  }

  const text = extractText(response)
  const parsed = parseJsonBlock(text)
  return normalize(parsed, aiCalls)
}

function extractText(response: any): string {
  if (!response?.content || !Array.isArray(response.content)) return ''
  return response.content
    .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('\n')
}

function parseJsonBlock(text: string): Record<string, unknown> {
  if (!text) return {}
  // Prefer a fenced ```json block; fall back to the last {...} span.
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fence
    ? fence[1]
    : (() => {
        const start = text.indexOf('{')
        const end = text.lastIndexOf('}')
        return start >= 0 && end > start ? text.slice(start, end + 1) : ''
      })()
  if (!candidate) return {}
  try {
    return JSON.parse(candidate)
  } catch {
    return {}
  }
}

function normalize(raw: Record<string, unknown>, aiCalls: number): ResearchResult {
  const str = (v: unknown): string | null => {
    if (typeof v !== 'string') return null
    const t = v.trim()
    return t && t.toLowerCase() !== 'null' ? t : null
  }
  const num = (v: unknown): number | null => {
    if (typeof v === 'number' && !Number.isNaN(v)) return v
    if (typeof v === 'string') {
      const n = parseFloat(v.replace(/[^0-9.]/g, ''))
      return Number.isNaN(n) ? null : n
    }
    return null
  }
  const arr = (v: unknown): string[] | null => {
    if (!Array.isArray(v)) return null
    const cleaned = v.map(x => str(x)).filter((x): x is string => !!x)
    return cleaned.length ? cleaned : null
  }
  const conf = num(raw.confidence)

  return {
    business_name: str(raw.business_name),
    owner_name: str(raw.owner_name),
    contact_name: str(raw.contact_name),
    primary_crop: str(raw.primary_crop),
    crop_types: arr(raw.crop_types),
    phone: str(raw.phone),
    email: str(raw.email),
    website: str(raw.website),
    est_acreage: num(raw.est_acreage),
    recommended_approach: str(raw.recommended_approach),
    best_contact_method: str(raw.best_contact_method),
    research_summary: str(raw.research_summary),
    confidence: conf == null ? 0 : Math.min(1, Math.max(0, conf)),
    field_sources:
      raw.field_sources && typeof raw.field_sources === 'object'
        ? (raw.field_sources as Record<string, string>)
        : {},
    ai_calls: aiCalls,
  }
}
