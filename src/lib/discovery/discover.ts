import { BUSINESS, CITY_SHORT } from '@/lib/business'
import type { DiscoveryCategory } from './categories'
import { searchConfigured, searchProspectsDetailed, type SearchHit, type SearchDiag } from './search'

// ─────────────────────────────────────────────────────────────────────────
// Prospect discovery, three stages:
//   1. SEARCH   — Brave + Tavily web search find candidate businesses
//                 (./search.ts), returning raw hits in the service area.
//   2. INFER    — Groq (fast, cheap open models) reads those hits and extracts
//                 structured lead stubs — REAL businesses only, never invented.
//   3. ENRICH   — handled downstream: stubs are inserted with source
//                 'ai_discovery' and the Claude enrichment engine verifies +
//                 fills them in.
//
// This replaces the old Claude web_search path so discovery no longer depends
// on Anthropic credits; Claude is reserved for the final enrichment pass.
// ─────────────────────────────────────────────────────────────────────────

export interface DiscoveredLead {
  business_name: string
  city: string | null
  county: string | null
  website: string | null
  phone: string | null
  email: string | null
  notes: string | null
}

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'
const GROQ_MODEL =
  process.env.DISCOVERY_MODEL || process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'

/** Discovery needs a search provider (find) and Groq (infer). */
export function discoveryConfigured(): boolean {
  return searchConfigured() && Boolean(process.env.GROQ_API_KEY)
}

export async function discoverLeads(
  cat: DiscoveryCategory,
  limit = 10
): Promise<{ leads: DiscoveredLead[]; aiCalls: number; diag: SearchDiag & { groqKey: boolean; inferred: number } }> {
  const { hits, diag } = await searchProspectsDetailed(cat, limit)
  const groqKey = Boolean(process.env.GROQ_API_KEY)
  if (!hits.length) return { leads: [], aiCalls: 0, diag: { ...diag, groqKey, inferred: 0 } }

  const leads = await inferLeads(cat, hits, limit)
  return { leads, aiCalls: 1, diag: { ...diag, groqKey, inferred: leads.length } }
}

// ── Stage 2: Groq turns raw search hits into structured lead stubs ──────────

async function inferLeads(
  cat: DiscoveryCategory,
  hits: SearchHit[],
  limit: number
): Promise<DiscoveredLead[]> {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY is not set')

  const where = CITY_SHORT
    ? `within about ${BUSINESS.serviceRadiusMi} miles of ${CITY_SHORT} (${BUSINESS.region})`
    : `in ${BUSINESS.region}`

  const system = `You are a B2B prospecting analyst for a drone-services company operating a ${BUSINESS.equipment}. You are given raw web-search results and must extract REAL, currently-operating businesses or organizations ${where} that are strong prospects for drone services. Only use businesses that actually appear in the provided search results — never invent, guess, or pad the list. Prefer prospects with a verifiable website (use the result's own domain) and that are clearly inside the service area. Output strict JSON only.`

  // Number the sources so the model grounds each lead in a real result.
  const sources = hits
    .slice(0, 40)
    .map((h, i) => `[${i + 1}] ${h.title}\n${h.url}\n${h.snippet}`.trim())
    .join('\n\n')

  const user = `Prospect category: ${cat.prompt}

Web-search results (grounding — only extract businesses present here):
${sources}

Return ONLY a JSON object shaped {"leads": [...]} where each element is exactly:
{"business_name": string, "city": string|null, "county": string|null, "website": string|null, "phone": string|null, "email": string|null, "notes": string|null}
"notes" is one short sentence on why they fit drone services. Use null for anything not present in the results. Include at most ${limit} distinct businesses; skip directories, aggregators, marketplaces, and out-of-area results.`

  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: 2500,
      temperature: 0.2,
      response_format: { type: 'json_object' },
    }),
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Groq ${res.status}: ${body.slice(0, 300)}`)
  }

  const json = await res.json()
  const text = String(json?.choices?.[0]?.message?.content ?? '')
  return parseLeads(text, limit)
}

function parseLeads(text: string, limit: number): DiscoveredLead[] {
  const arr = extractArray(text)
  if (!arr) return []
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

// Accepts either a bare JSON array or a {"leads": [...]} object (json_object mode).
function extractArray(text: string): any[] | null {
  if (!text) return null
  try {
    const obj = JSON.parse(text)
    if (Array.isArray(obj)) return obj
    if (Array.isArray(obj?.leads)) return obj.leads
  } catch {
    /* fall through to span extraction */
  }
  const s = text.indexOf('[')
  const e = text.lastIndexOf(']')
  if (s === -1 || e <= s) return null
  try {
    const arr = JSON.parse(text.slice(s, e + 1))
    return Array.isArray(arr) ? arr : null
  } catch {
    return null
  }
}
