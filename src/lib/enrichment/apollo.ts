import type { Lead } from '@/lib/supabase'

// Optional contact-data booster via Apollo.io's People Match REST API.
//
// Only used when APOLLO_API_KEY is set. It supplements (never overrides) the AI
// research with verified phone/email/title where available. Fully defensive:
// any failure returns an empty result and the pipeline continues.

export interface ApolloContact {
  contact_name: string | null
  email: string | null
  phone: string | null
  title: string | null
}

const EMPTY: ApolloContact = {
  contact_name: null,
  email: null,
  phone: null,
  title: null,
}

export async function apolloEnrich(lead: Lead): Promise<ApolloContact> {
  const apiKey = process.env.APOLLO_API_KEY
  if (!apiKey) return EMPTY

  // Need at least a name + a company/domain hint to match against.
  const domain = lead.website ? hostFrom(lead.website) : null
  const name = lead.owner_name || lead.contact_name
  if (!name && !domain) return EMPTY

  try {
    const res = await fetch('https://api.apollo.io/v1/people/match', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache',
        'X-Api-Key': apiKey,
      },
      body: JSON.stringify({
        name: name || undefined,
        organization_name: lead.business_name || undefined,
        domain: domain || undefined,
        reveal_personal_emails: false,
      }),
      // Apollo can be slow; cap it so a stuck call can't stall the batch.
      signal: AbortSignal.timeout(15000),
    })
    if (!res.ok) return EMPTY
    const data = await res.json()
    const p = data?.person
    if (!p) return EMPTY

    const first = p.first_name ?? ''
    const last = p.last_name ?? ''
    const full = `${first} ${last}`.trim()

    return {
      contact_name: full || null,
      email: typeof p.email === 'string' ? p.email : null,
      phone:
        p.phone_numbers?.[0]?.sanitized_number ||
        p.organization?.phone ||
        null,
      title: typeof p.title === 'string' ? p.title : null,
    }
  } catch {
    return EMPTY
  }
}

function hostFrom(url: string): string | null {
  try {
    const u = new URL(url.startsWith('http') ? url : `https://${url}`)
    return u.hostname.replace(/^www\./, '')
  } catch {
    return null
  }
}
