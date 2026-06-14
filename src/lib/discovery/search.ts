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

/** Run all queries through the Cloudflare Worker (Brave+Tavily + KV cache). */
async function workerSearch(queries: string[], perQuery: number): Promise<SearchHit[]> {
  try {
    const res = await fetch(process.env.DISCOVERY_WORKER_URL!, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.DISCOVERY_WORKER_SECRET}`,
      },
      body: JSON.stringify({ queries, perQuery }),
    })
    if (!res.ok) return []
    const json = await res.json()
    return Array.isArray(json?.hits) ? (json.hits as SearchHit[]) : []
  } catch {
    return []
  }
}

/** Location suffix appended to each base query to keep hits in-area. */
function locationSuffix(): string {
  if (CITY_SHORT) return `near ${CITY_SHORT} ${BUSINESS.region}`
  return BUSINESS.region
}

async function braveSearch(query: string, count: number): Promise<SearchHit[]> {
  const key = process.env.BRAVE_API_KEY
  if (!key) return []
  const url = `${BRAVE_URL}?q=${encodeURIComponent(query)}&count=${count}&country=us`
  try {
    const res = await fetch(url, {
      headers: {
        Accept: 'application/json',
        'Accept-Encoding': 'gzip',
        'X-Subscription-Token': key,
      },
    })
    if (!res.ok) return []
    const json = await res.json()
    const results: any[] = json?.web?.results ?? []
    return results
      .map(r => ({
        title: String(r?.title ?? '').trim(),
        url: String(r?.url ?? '').trim(),
        snippet: String(r?.description ?? '').trim(),
        source: 'brave' as const,
      }))
      .filter(h => h.url)
  } catch {
    return []
  }
}

async function tavilySearch(query: string, count: number): Promise<SearchHit[]> {
  const key = process.env.TAVILY_API_KEY
  if (!key) return []
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
    if (!res.ok) return []
    const json = await res.json()
    const results: any[] = json?.results ?? []
    return results
      .map(r => ({
        title: String(r?.title ?? '').trim(),
        url: String(r?.url ?? '').trim(),
        snippet: String(r?.content ?? '').trim(),
        source: 'tavily' as const,
      }))
      .filter(h => h.url)
  } catch {
    return []
  }
}

/**
 * Search both providers for a category's prospect queries and return merged,
 * URL-deduped hits. `limit` scales how many results we gather per query.
 */
export async function searchProspects(
  cat: DiscoveryCategory,
  limit: number
): Promise<SearchHit[]> {
  const suffix = locationSuffix()
  const perQuery = Math.min(10, Math.max(4, Math.ceil(limit / 2)))
  const queries = cat.queries.map(q => `${q} ${suffix}`.trim())

  // Prefer the Cloudflare Worker (keys on CF + KV cache) when configured; it
  // returns already-merged hits. Otherwise hit the providers directly.
  if (workerConfigured()) {
    return workerSearch(queries, perQuery)
  }

  const batches = await Promise.all(
    queries.flatMap(q => [braveSearch(q, perQuery), tavilySearch(q, perQuery)])
  )

  const seen = new Set<string>()
  const merged: SearchHit[] = []
  for (const hit of batches.flat()) {
    const key = hit.url.replace(/\/+$/, '').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(hit)
  }
  return merged
}
