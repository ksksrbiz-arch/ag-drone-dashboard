// ─────────────────────────────────────────────────────────────────────────
// Discovery search Worker — Brave + Tavily web search proxy for the dashboard.
//
// POST {"queries": string[], "perQuery"?: number}
//   Authorization: Bearer <WORKER_SHARED_SECRET>
// → {"ok": true, "count": n, "hits": [{title, url, snippet, source}]}
//
// Keeps the Brave/Tavily keys on Cloudflare (off Vercel), runs both providers,
// dedupes by URL, and caches per (provider, query) in KV to conserve the free
// tiers. The Next app's discovery search transport calls this when
// DISCOVERY_WORKER_URL is set; otherwise it searches the providers directly.
// ─────────────────────────────────────────────────────────────────────────

interface KV {
  get(key: string, type: 'json'): Promise<unknown>
  put(key: string, value: string, opts?: { expirationTtl?: number }): Promise<void>
}

export interface Env {
  BRAVE_API_KEY?: string
  TAVILY_API_KEY?: string
  WORKER_SHARED_SECRET: string
  SEARCH_CACHE?: KV
}

interface Hit {
  title: string
  url: string
  snippet: string
  source: 'brave' | 'tavily'
}

const BRAVE_URL = 'https://api.search.brave.com/res/v1/web/search'
const TAVILY_URL = 'https://api.tavily.com/search'

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405)

    const auth = req.headers.get('authorization') ?? ''
    if (!env.WORKER_SHARED_SECRET || auth !== `Bearer ${env.WORKER_SHARED_SECRET}`) {
      return json({ ok: false, error: 'unauthorized' }, 401)
    }
    if (!env.BRAVE_API_KEY && !env.TAVILY_API_KEY) {
      return json({ ok: false, error: 'no search provider configured' }, 500)
    }

    let body: any
    try {
      body = await req.json()
    } catch {
      return json({ ok: false, error: 'invalid JSON' }, 400)
    }

    const queries: string[] = Array.isArray(body?.queries)
      ? body.queries.filter((q: unknown) => typeof q === 'string' && q.trim()).slice(0, 8)
      : []
    const perQuery = Math.min(Math.max(1, Number(body?.perQuery) || 8), 20)
    if (!queries.length) return json({ ok: false, error: 'queries[] required' }, 400)

    const seen = new Set<string>()
    const hits: Hit[] = []
    for (const q of queries) {
      const batches = await Promise.all([
        cachedSearch('brave', q, perQuery, env),
        cachedSearch('tavily', q, perQuery, env),
      ])
      for (const hit of batches.flat()) {
        const key = hit.url.replace(/\/+$/, '').toLowerCase()
        if (seen.has(key)) continue
        seen.add(key)
        hits.push(hit)
      }
    }

    return json({ ok: true, count: hits.length, hits })
  },
}

async function cachedSearch(
  provider: 'brave' | 'tavily',
  query: string,
  count: number,
  env: Env
): Promise<Hit[]> {
  const cacheKey = `${provider}:${count}:${query}`
  if (env.SEARCH_CACHE) {
    const hit = (await env.SEARCH_CACHE.get(cacheKey, 'json')) as Hit[] | null
    if (hit) return hit
  }
  let items: Hit[] = []
  try {
    items = provider === 'brave' ? await brave(query, count, env) : await tavily(query, count, env)
  } catch {
    items = []
  }
  if (env.SEARCH_CACHE && items.length) {
    await env.SEARCH_CACHE.put(cacheKey, JSON.stringify(items), { expirationTtl: 86400 })
  }
  return items
}

async function brave(query: string, count: number, env: Env): Promise<Hit[]> {
  if (!env.BRAVE_API_KEY) return []
  const url = `${BRAVE_URL}?q=${encodeURIComponent(query)}&count=${count}&country=us`
  const res = await fetch(url, {
    headers: { Accept: 'application/json', 'X-Subscription-Token': env.BRAVE_API_KEY },
  })
  if (!res.ok) return []
  const data: any = await res.json()
  return (data?.web?.results ?? [])
    .map((r: any) => ({
      title: String(r?.title ?? '').trim(),
      url: String(r?.url ?? '').trim(),
      snippet: String(r?.description ?? '').trim(),
      source: 'brave' as const,
    }))
    .filter((h: Hit) => h.url)
}

async function tavily(query: string, count: number, env: Env): Promise<Hit[]> {
  if (!env.TAVILY_API_KEY) return []
  const res = await fetch(TAVILY_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.TAVILY_API_KEY}` },
    body: JSON.stringify({
      api_key: env.TAVILY_API_KEY,
      query,
      search_depth: 'basic',
      max_results: count,
    }),
  })
  if (!res.ok) return []
  const data: any = await res.json()
  return (data?.results ?? [])
    .map((r: any) => ({
      title: String(r?.title ?? '').trim(),
      url: String(r?.url ?? '').trim(),
      snippet: String(r?.content ?? '').trim(),
      source: 'tavily' as const,
    }))
    .filter((h: Hit) => h.url)
}

function json(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), { status, headers: { 'content-type': 'application/json' } })
}
