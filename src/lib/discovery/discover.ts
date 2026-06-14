import Anthropic from '@anthropic-ai/sdk'
import { MODEL } from '@/lib/enrichment/config'
import { BUSINESS, CITY_SHORT } from '@/lib/business'
import type { DiscoveryCategory } from './categories'

// AI web-discovery: find REAL prospect businesses for a drone-service category
// within the service area, using Claude's server-side web-search tool (same
// infra as the enrichment researcher). Returns lead stubs that the enrichment
// engine then verifies + enriches.

export interface DiscoveredLead {
  business_name: string
  city: string | null
  county: string | null
  website: string | null
  phone: string | null
  email: string | null
  notes: string | null
}

let client: Anthropic | null = null
const getClient = () => (client ??= new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }))

const MAX_TURNS = 8

export async function discoverLeads(
  cat: DiscoveryCategory,
  limit = 10
): Promise<{ leads: DiscoveredLead[]; aiCalls: number }> {
  const anthropic = getClient()
  const where = CITY_SHORT
    ? `within about ${BUSINESS.serviceRadiusMi} miles of ${CITY_SHORT} (${BUSINESS.region})`
    : `in ${BUSINESS.region}`

  const body: Record<string, unknown> = {
    model: MODEL,
    max_tokens: 4000,
    thinking: { type: 'adaptive' },
    output_config: { effort: 'medium' },
    tools: [{ type: 'web_search_20260209', name: 'web_search' }],
    system: `You are a B2B prospecting researcher for a drone-services company operating a ${BUSINESS.equipment}. Find REAL, currently-operating businesses or organizations ${where} that are strong prospects for drone services. Use web search to find ACTUAL named businesses — never invent or guess a business. Prefer prospects with a verifiable website or phone, and stay within the service area.`,
    messages: [
      {
        role: 'user',
        content: `Category to prospect: ${cat.prompt}.

Return ONLY a JSON array (no prose, no code fences) of up to ${limit} objects shaped exactly:
{"business_name": string, "city": string|null, "county": string|null, "website": string|null, "phone": string|null, "email": string|null, "notes": string|null}
"notes" is one short sentence on why they're a fit for drone services. Use null for anything you cannot verify. Only include businesses you actually found via web search.`,
      },
    ],
  }

  let aiCalls = 0
  let response: any
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    aiCalls++
    response = await (anthropic.messages.create as any)(body)
    if (response?.stop_reason !== 'pause_turn') break
    ;(body.messages as unknown[]).push({ role: 'assistant', content: response.content })
  }

  const text = (response?.content ?? [])
    .filter((b: any) => b?.type === 'text' && typeof b.text === 'string')
    .map((b: any) => b.text)
    .join('\n')

  return { leads: parseLeads(text, limit), aiCalls }
}

function parseLeads(text: string, limit: number): DiscoveredLead[] {
  const s = text.indexOf('[')
  const e = text.lastIndexOf(']')
  if (s === -1 || e <= s) return []
  let arr: any[]
  try {
    arr = JSON.parse(text.slice(s, e + 1))
  } catch {
    return []
  }
  if (!Array.isArray(arr)) return []
  const clean = (v: any) => (typeof v === 'string' && v.trim() ? v.trim() : null)
  return arr
    .map(o => ({
      business_name: clean(o?.business_name) ?? '',
      city: clean(o?.city),
      county: clean(o?.county),
      website: clean(o?.website),
      phone: clean(o?.phone),
      email: clean(o?.email),
      notes: clean(o?.notes),
    }))
    .filter(o => o.business_name)
    .slice(0, limit)
}
