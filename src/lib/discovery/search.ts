import { BUSINESS, CITY_SHORT } from '@/lib/business'
import type { DiscoveryCategory } from './categories'

// ─────────────────────────────────────────────────────────────────────────
// Web search for prospect discovery — Brave + Tavily.
//
// Replaces Claude's server-side web_search tool as the *finding* stage of
// discovery: we run each category's base queries against both providers in
// parallel, soft-failing either one independently, then return a merged,
// URL-deduped list of hits. Groq then turns these raw hits into structured
// lead stubs (see discover.ts); Claude only runs later, during enrichment.
// ─────────────────────────────────────────────────────────────────────────

export interface SearchHit {
  title: string
  url: string
  snippet: string
  source: 'brave' | 'tavily'
}

const BRAVE_URL = 'https://api.search.brave.com/res/v1/web/search'
const TAVILY_URL = 'https://api.tavily.com/search'

/** The optional Cloudflare Worker that runs search server-side (keys on CF). */
export function workerConfigured(): boolean {
  return Boolean(process.env.DISCOVERY_WORKER_URL && process.env.DISCOVERY_WORKER_SECRET)
}

export function searchConfigured(): boolean {
  return Boolean(process.env.BRAVE_API_KEY || process.env.TAVILY_API_KEY || workerConfigured())
}

/** Run all queries through the Cloudflare Worker (Brave+Tavily + KV cache).
 *  Fails fast (5s) so a misconfigured/unreachable worker can't stall a search —
 *  the caller falls back to direct providers. */
async function workerSearch(queries: string[], perQuery: number): Promise<SearchHit[]> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    const res = await fetch(process.env.DISCOVERY_WORKER_URL!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DISCOVERY_WORKER_SECRET}`,
      },
      body: JSON.stringify({ queries, perQuery }),
      signal: ctrl.signal,
    })
    if (!res.ok) return []
    const json = await res.json()
    return Array.isArray(json?.hits) ? (json.hits as SearchHit[]) : []
  } catch {
    return []
  } finally {
    clearTimeout(timer)
  }
}

/** Location suffix appended to each base query to keep hits in-area. */
function locationSuffix(): string {
  if (CITY_SHORT) return `near ${CITY_SHORT} ${BUSINESS.region}`
  return BUSINESS.region
}

async function braveSearch(query: string, count: number): Promise<{ hits: SearchHit[]; status: number }> {
  const key = process.env.BRAVE_API_KEY
  if (!key) return { hits: [], status: 0 }
  const url = `${BRAVE_URL}?q=${encodeURIComponent(query)}&count=${count}&country=us`
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': key,
      },
    })
    if (!res.ok) return { hits: [], status: res.status }
    const json = await res.json()
    const results: any[] = json?.web?.results ?? []
    return {
      status: 200,
      hits: results
        .map(r => ({
          title: String(r?.title ?? '').trim(),
          url: String(r?.url ?? '').trim(),
          snippet: String(r?.description ?? '').trim(),
          source: 'brave' as const,
        }))
        .filter(h => h.url),
    }
  } catch {
    return { hits: [], status: -1 }
  }
}

async function tavilySearch(query: string, count: number): Promise<{ hits: SearchHit[]; status: number }> {
  const key = process.env.TAVILY_API_KEY
  if (!key) return { hits: [], status: 0 }
  try {
    const res = await fetch(TAVILY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Bearer is the current scheme; api_key in the body keeps older keys working.
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        api_key: key,
        query,
        search_depth: 'basic',
        max_results: count,
      }),
    })
    if (!res.ok) return { hits: [], status: res.status }
    const json = await res.json()
    const results: any[] = json?.results ?? []
    return {
      status: 200,
      hits: results
        .map(r => ({
          title: String(r?.title ?? '').trim(),
          url: String(r?.url ?? '').trim(),
          snippet: String(r?.content ?? '').trim(),
          source: 'tavily' as const,
        }))
        .filter(h => h.url),
    }
  } catch {
    return { hits: [], status: -1 }
  }
}

/** Per-stage diagnostics for the discovery search (no secrets — booleans + counts). */
export interface SearchDiag {
  via: 'worker' | 'direct' | 'worker→direct' | 'none'
  workerKey: boolean
  braveKey: boolean
  tavilyKey: boolean
  workerHits: number
  braveHits: number
  tavilyHits: number
  /** Last non-200 HTTP status seen per provider (helps spot 401/429). */
  braveStatus: number | null
  tavilyStatus: number | null
  merged: number
}

function dedupe(hits: SearchHit[]): SearchHit[] {
  const seen = new Set<string>()
  const out: SearchHit[] = []
  for (const hit of hits) {
    const key = hit.url.replace(/\/+$/, '').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(hit)
  }
  return out
}

/** Run Brave + Tavily directly across all queries. Brave's free tier is rate
 *  limited (~1 req/s), so its queries run sequentially while Tavily runs in
 *  parallel — avoids the 429s that silently zeroed out results. */
async function directSearch(
  queries: string[],
  perQuery: number,
  diag: SearchDiag
): Promise<SearchHit[]> {
  const tavilyAll = Promise.all(queries.map(q => tavilySearch(q, perQuery)))

  const braveHits: SearchHit[] = []
  for (const q of queries) {
    const r = await braveSearch(q, perQuery)
    if (r.status && r.status !== 200) diag.braveStatus = r.status
    braveHits.push(...r.hits)
    if (queries.length > 1) await new Promise(res => setTimeout(res, 1100))
  }

  const tavilyResults = await tavilyAll
  const tavilyHits: SearchHit[] = []
  for (const r of tavilyResults) {
    if (r.status && r.status !== 200) diag.tavilyStatus = r.status
    tavilyHits.push(...r.hits)
  }

  diag.braveHits = braveHits.length
  diag.tavilyHits = tavilyHits.length
  return dedupe([...braveHits, ...tavilyHits])
}

/**
 * Search both providers for a category's prospect queries and return merged,
 * URL-deduped hits — with diagnostics. Prefers the Cloudflare Worker when
 * configured, but falls back to direct providers if the worker yields nothing.
 */
export async function searchProspectsDetailed(
  cat: DiscoveryCategory,
  limit: number
): Promise<{ hits: SearchHit[]; diag: SearchDiag }> {
  const suffix = locationSuffix()
  const perQuery = Math.min(10, Math.max(4, Math.ceil(limit / 2)))
  const queries = cat.queries.map(q => `${q} ${suffix}`.trim())

  const diag: SearchDiag = {
    via: 'none',
    workerKey: workerConfigured(),
    braveKey: Boolean(process.env.BRAVE_API_KEY),
    tavilyKey: Boolean(process.env.TAVILY_API_KEY),
    workerHits: 0,
    braveHits: 0,
    tavilyHits: 0,
    braveStatus: null,
    tavilyStatus: null,
    merged: 0,
  }

  let hits: SearchHit[] = []

  if (workerConfigured()) {
    const w = dedupe(await workerSearch(queries, perQuery))
    diag.workerHits = w.length
    if (w.length) {
      diag.via = 'worker'
      diag.merged = w.length
      return { hits: w, diag }
    }
    // Worker returned nothing — fall back to direct providers if we have keys.
    if (diag.braveKey || diag.tavilyKey) {
      hits = await directSearch(queries, perQuery, diag)
      diag.via = 'worker→direct'
    }
  } else if (diag.braveKey || diag.tavilyKey) {
    hits = await directSearch(queries, perQuery, diag)
    diag.via = 'direct'
  }

  diag.merged = hits.length
  return { hits, diag }
}

export async function searchProspects(
  cat: DiscoveryCategory,
  limit: number
): Promise<SearchHit[]> {
  return (await searchProspectsDetailed(cat, limit)).hits
}
