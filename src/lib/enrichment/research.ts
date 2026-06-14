import type { Lead } from '@/lib/supabase'
import type { ResearchResult } from './types'
import { cheapComplete, extractJson } from '@/lib/ai/llm'
import { COMPANY_CONTEXT } from './config'
import { BUSINESS } from '@/lib/business'
import { verticalGuidance } from './verticals'
import { missingFields } from './completeness'

// ─────────────────────────────────────────────────────────────────────────
// SSOT-grounded lead analysis (free models: Groq / OpenRouter).
//
// The previous version used Claude's web-search tool to *find* new facts. That
// requires Anthropic credits and can drift. This version runs on the free,
// OpenAI-compatible models the project already has (via src/lib/ai/llm.ts) and
// is deliberately constrained: the structured lead record is the SINGLE SOURCE
// OF TRUTH. The model has no web access and MUST NOT invent facts — it only
// normalizes values already present and produces advisory outputs (how to
// approach this grower, best contact method, a short summary).
//
// Real contact-data gaps (phone/email) are filled by the Apollo booster in the
// engine — an actual data source — never hallucinated here.
// ─────────────────────────────────────────────────────────────────────────

const SYSTEM = `You are a B2B lead-analysis assistant for an agricultural drone-services company.

${COMPANY_CONTEXT}

You are given the SINGLE SOURCE OF TRUTH for ONE lead: the structured data the
company already holds. You have NO web access and cannot look anything up.

HARD RULES — follow exactly to avoid mistakes:
- NEVER invent, guess, complete, or infer any factual field. Specifically:
  business name, owner, contact name, phone, email, website, acreage, address.
  If a value is not present in the data below, it stays unknown — do not output it.
- You MAY lightly normalize the formatting of a value that IS present (e.g. tidy
  a crop label, title-case an owner name) but never change its meaning.
- Your job is ADVISORY, grounded strictly in the provided facts: given what is
  known about this grower and our drone spray/scouting services in
  ${BUSINESS.region}, recommend what to lead with, the single best way to make
  contact given the data we have, and a one- or two-sentence summary.
- "confidence" (0..1) = how well the KNOWN data supports a solid outreach plan.
  Sparse data → low confidence. Do not inflate it.

Return ONLY a single JSON object, no prose, with exactly these keys:
{
  "primary_crop": string|null,
  "crop_types": string[]|null,
  "recommended_approach": string|null,
  "best_contact_method": string|null,
  "research_summary": string|null,
  "confidence": number
}`

function field(label: string, v: unknown): string | null {
  if (v == null || (typeof v === 'string' && v.trim() === '')) return null
  return `${label}: ${v}`
}

function ssotBrief(lead: Lead): string {
  const known = [
    field('Vertical', lead.vertical),
    field('Business name', lead.business_name),
    field('Owner', lead.owner_name),
    field('Contact', lead.contact_name),
    field('Primary crop', lead.primary_crop),
    field('Est. acreage', lead.est_acreage),
    field('Address', lead.address_physical),
    field('City', lead.city),
    field('County', lead.county),
    field('State', lead.state),
    field('Zip', lead.zipcode),
    field('Phone', lead.phone),
    field('Email', lead.email),
    field('Website', lead.website),
    field('Source', lead.source),
    field('Notes', lead.notes),
  ].filter(Boolean)

  const gaps = missingFields(lead)
  return `SINGLE SOURCE OF TRUTH — the only facts you may rely on:
${known.join('\n') || '(no data)'}

Unknown fields (leave these unknown — do NOT fabricate them): ${
    gaps.length ? gaps.join(', ') : '(none missing)'
  }

Using ONLY the facts above, produce the advisory JSON.`
}

export async function researchLead(lead: Lead): Promise<ResearchResult> {
  const text = await cheapComplete({
    system: SYSTEM + verticalGuidance(lead.vertical),
    user: ssotBrief(lead),
    json: true,
    maxTokens: 900,
    temperature: 0.2,
  })

  const raw = extractJson<Record<string, unknown>>(text) ?? {}
  return normalize(raw, lead)
}

function normalize(raw: Record<string, unknown>, lead: Lead): ResearchResult {
  const str = (v: unknown): string | null => {
    if (typeof v !== 'string') return null
    const t = v.trim()
    return t && t.toLowerCase() !== 'null' ? t : null
  }
  const arr = (v: unknown): string[] | null => {
    if (!Array.isArray(v)) return null
    const cleaned = v.map(x => str(x)).filter((x): x is string => !!x)
    return cleaned.length ? cleaned : null
  }
  const num = (v: unknown): number | null => {
    if (typeof v === 'number' && !Number.isNaN(v)) return v
    if (typeof v === 'string') {
      const n = parseFloat(v.replace(/[^0-9.]/g, ''))
      return Number.isNaN(n) ? null : n
    }
    return null
  }
  const conf = num(raw.confidence)

  // Crop may be normalized by the model, but only when the lead already had a
  // crop — never let the model conjure a crop where the SSOT has none.
  const primaryCrop = lead.primary_crop ? str(raw.primary_crop) : null
  const cropTypes = lead.primary_crop ? arr(raw.crop_types) : null

  return {
    // Identity & contact facts are NEVER taken from the model — only the SSOT
    // (and the engine's Apollo booster) may set these. Returning null here means
    // the engine leaves the existing authoritative values untouched.
    business_name: null,
    owner_name: null,
    contact_name: null,
    phone: null,
    email: null,
    website: null,
    est_acreage: null,
    // Crop normalization is allowed (derived from an existing value).
    primary_crop: primaryCrop,
    crop_types: cropTypes,
    // Advisory outputs grounded in the SSOT.
    recommended_approach: str(raw.recommended_approach),
    best_contact_method: str(raw.best_contact_method),
    research_summary: str(raw.research_summary),
    confidence: conf == null ? 0 : Math.min(1, Math.max(0, conf)),
    field_sources: { recommended_approach: 'reasoning over CRM data (single source of truth)' },
    ai_calls: 1,
  }
}
