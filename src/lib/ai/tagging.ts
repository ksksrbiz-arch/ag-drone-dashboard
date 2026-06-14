import { cheapComplete, aiConfigured } from './llm'

// Shared controlled vocabulary for lead tags — used by the bulk tagging route
// and by the enrichment engine (auto-tag on enrich). Additive only.
export const LEAD_TAG_VOCAB = [
  // crop / operation category
  'hazelnut', 'grass-seed', 'vineyard', 'berry', 'nursery', 'orchard',
  'row-crop', 'hops', 'christmas-trees', 'mint', 'dairy', 'other-crop',
  // fit / intent signals
  'high-acreage', 'efb-target', 'spray-fit', 'scouting-fit', 'outreach-ready', 'low-fit',
] as const

interface LeadLike {
  business_name?: string | null
  owner_name?: string | null
  primary_crop?: string | null
  vertical?: string | null
  county?: string | null
  est_acreage?: number | null
  research_summary?: string | null
}

function parseArray(text: string): string[] {
  const s = text.indexOf('[')
  const e = text.lastIndexOf(']')
  if (s === -1 || e <= s) return []
  try {
    const a = JSON.parse(text.slice(s, e + 1))
    return Array.isArray(a) ? a.map(String) : []
  } catch {
    return []
  }
}

/** Suggest 1-4 vocabulary tags for a single lead. Empty array if no provider. */
export async function suggestLeadTags(lead: LeadLike): Promise<string[]> {
  if (!aiConfigured()) return []
  const desc = `${lead.business_name ?? lead.owner_name ?? 'Unknown'} | crop:${lead.primary_crop ?? '?'} | vertical:${lead.vertical ?? '?'} | county:${lead.county ?? '?'} | acres:${lead.est_acreage ?? '?'} | notes:${String(lead.research_summary ?? '').slice(0, 200)}`
  try {
    const raw = await cheapComplete({
      system: `You tag an agricultural sales lead for a drone-spraying business (EFB treatment + crop scouting/spraying in Oregon's Willamette Valley). Choose 1-4 tags ONLY from this list: ${LEAD_TAG_VOCAB.join(', ')}. Use "efb-target" only for hazelnut/filbert. Return ONLY a JSON array of strings, e.g. ["hazelnut","efb-target"]. No prose.`,
      user: desc,
      maxTokens: 80,
      temperature: 0,
    })
    return parseArray(raw)
      .map(t => t.toLowerCase().trim())
      .filter(t => (LEAD_TAG_VOCAB as readonly string[]).includes(t))
      .slice(0, 4)
  } catch {
    return []
  }
}
