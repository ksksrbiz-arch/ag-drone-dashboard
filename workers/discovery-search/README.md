# Discovery Search Worker

An optional Cloudflare Worker that runs the **search stage** of lead discovery
(Brave + Tavily) server-side — keeping the API keys on Cloudflare (off Vercel)
and caching results in KV to stretch the free tiers.

The dashboard's discovery pipeline is **search → infer (Groq) → enrich (Claude)**.
This Worker only handles **search**. When `DISCOVERY_WORKER_URL` is set, the app
sends queries here; otherwise it calls Brave/Tavily directly. Either way, Groq
does the structuring and Anthropic is only used later for enrichment.

## One-time deploy

```bash
cd workers/discovery-search

npm i -g wrangler        # or: npx wrangler ...
wrangler login

# Secrets (Brave is enough; Tavily is optional and used alongside it)
wrangler secret put BRAVE_API_KEY          # https://api-dashboard.search.brave.com/
wrangler secret put TAVILY_API_KEY         # optional — https://tavily.com
wrangler secret put WORKER_SHARED_SECRET   # any long random string

# Optional KV cache (24h per query)
wrangler kv namespace create SEARCH_CACHE
#   → paste the id into wrangler.toml under [[kv_namespaces]] and uncomment

wrangler deploy
#   → prints the URL, e.g. https://drone-discovery-search.<subdomain>.workers.dev
```

## Wire it to the dashboard (Vercel env vars)

```
DISCOVERY_WORKER_URL=https://drone-discovery-search.<subdomain>.workers.dev
DISCOVERY_WORKER_SECRET=<the same WORKER_SHARED_SECRET>
GROQ_API_KEY=gsk_...        # structures search hits into leads
```

## Test

```bash
curl -X POST "$DISCOVERY_WORKER_URL" \
  -H "Authorization: Bearer $DISCOVERY_WORKER_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"queries":["roofing contractors near Canby Oregon"],"perQuery":5}'
```
