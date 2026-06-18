// Apollo.io as a prospecting SOURCE (distinct from the contact-data booster in
// src/lib/enrichment/apollo.ts). Searches Apollo's organization database by
// industry keywords + location and returns candidate businesses to seed as
// leads. Only active when APOLLO_API_KEY is set; fully defensive.

export interface ApolloProspect {
  business_name: string
  website: string | null
  phone: string | null
  city: string | null
  state: string | null
  industry: string | null
}

// Visibility into why a search returned what it did (HTTP status, total matches
// Apollo reports, and which response key the rows came from). Surfaced to the UI.
export interface ApolloDiag {
  status: number
  total: number | null
  returned: number
  error: string | null
}

export function apolloConfigured(): boolean {
  return Boolean(process.env.APOLLO_API_KEY)
}

export async function apolloSearchOrganizations(opts: {
  keywords: string[]
  locations: string[]
  perPage?: number
}): Promise<{ prospects: ApolloProspect[]; diag: ApolloDiag }> {
  const diag: ApolloDiag = { status: 0, total: null, returned: 0, error: null }
  const apiKey = process.env.APOLLO_API_KEY
  if (!apiKey) {
    diag.error = 'APOLLO_API_KEY not set'
    return { prospects: [], diag }
  }

  const payload: Record<string, unknown> = {
    page: 1,
    per_page: Math.min(Math.max(opts.perPage ?? 25, 1), 100),
  }
  const tags = opts.keywords.filter(Boolean).slice(0, 10)
  if (tags.length) payload.q_organization_keyword_tags = tags
  const locs = opts.locations.filter(Boolean)
  if (locs.length) payload.organization_locations = locs

  try {
    const res = await fetch('https://api.apollo.io/v1/mixed_companies/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    })
    diag.status = res.status
    const data = await res.json().catch(() => null)
    if (!res.ok) {
      diag.error = (data && (data.error || data.error_message || data.message)) || `HTTP ${res.status}`
      return { prospects: [], diag }
    }
    diag.total = Number(data?.pagination?.total_entries ?? data?.total_entries ?? null) || null
    const orgs: any[] = data?.organizations ?? data?.accounts ?? []
    const prospects = orgs.map(normalize).filter((o): o is ApolloProspect => Boolean(o && o.business_name))
    diag.returned = prospects.length
    return { prospects, diag }
  } catch (err: any) {
    diag.error = String(err?.name === 'TimeoutError' ? 'Apollo timed out' : err?.message ?? err)
    return { prospects: [], diag }
  }
}

function normalize(org: any): ApolloProspect | null {
  const business_name = typeof org?.name === 'string' ? org.name.trim() : ''
  if (!business_name) return null
  const domain = org?.primary_domain || org?.website_url
  const website = domain
    ? String(domain).startsWith('http') ? String(domain) : `https://${String(domain).replace(/^www\./, '')}`
    : null
  const phone = org?.phone || org?.sanitized_phone || org?.primary_phone?.number || null
  return {
    business_name,
    website,
    phone: phone ? String(phone) : null,
    city: org?.city ?? org?.organization_city ?? null,
    state: org?.state ?? org?.organization_state ?? null,
    industry: org?.industry ?? null,
  }
}
