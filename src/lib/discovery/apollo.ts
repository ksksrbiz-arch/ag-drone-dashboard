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

export function apolloConfigured(): boolean {
  return Boolean(process.env.APOLLO_API_KEY)
}

export async function apolloSearchOrganizations(opts: {
  keywords: string[]
  locations: string[]
  perPage?: number
}): Promise<ApolloProspect[]> {
  const apiKey = process.env.APOLLO_API_KEY
  if (!apiKey) return []
  try {
    const res = await fetch('https://api.apollo.io/v1/mixed_companies/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        q_organization_keyword_tags: opts.keywords.filter(Boolean).slice(0, 10),
        organization_locations: opts.locations.filter(Boolean),
        page: 1,
        per_page: Math.min(Math.max(opts.perPage ?? 25, 1), 100),
      }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return []
    const data = await res.json()
    const orgs: any[] = data?.organizations ?? data?.accounts ?? []
    return orgs.map(normalize).filter((o): o is ApolloProspect => Boolean(o && o.business_name))
  } catch {
    return []
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
