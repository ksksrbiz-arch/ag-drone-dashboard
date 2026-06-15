import type { Lead } from '@/lib/supabase'
import { getAdminClient } from '@/lib/supabaseAdmin'

// ─────────────────────────────────────────────────────────────────────────
// Lead de-duplication.
//
// Detection is read-only and safe: leads are clustered by shared phone, email,
// or normalized (business name + city) via a small union-find, so a record that
// matches on more than one key still lands in a single cluster.
//
// Merging is deliberately NON-destructive: it backfills the primary's empty
// fields from its duplicates and unions tags, then *marks* the duplicates
// (a `duplicate` tag + a note pointer) instead of deleting them. Hard deletes
// stay a manual decision because `leads` has cascading references (jobs,
// customers, fields, alerts) and a wrong merge should be reversible.
// ─────────────────────────────────────────────────────────────────────────

export type DupReason = 'phone' | 'email' | 'name+city'

export interface DupMember {
  id: string
  business_name: string | null
  owner_name: string | null
  city: string | null
  phone: string | null
  email: string | null
  priority_score: number | null
  enrichment_status: string | null
  tags: string[] | null
}

export interface DupCluster {
  reasons: DupReason[]
  members: DupMember[]
}

const DUP_FIELDS =
  'id, business_name, owner_name, city, phone, email, primary_crop, est_acreage, address_physical, county, state, zipcode, website, contact_name, notes, tags, priority_score, enrichment_status'

function normPhone(v: string | null): string | null {
  if (!v) return null
  const digits = v.replace(/\D/g, '')
  return digits.length >= 7 ? digits.slice(-10) : null
}
function normEmail(v: string | null): string | null {
  if (!v) return null
  const t = v.trim().toLowerCase()
  return t.includes('@') ? t : null
}
function normNameCity(name: string | null, city: string | null): string | null {
  const n = (name ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
  const c = (city ?? '').trim().toLowerCase()
  return n.length >= 3 ? `${n}|${c}` : null
}

// ── union-find ─────────────────────────────────────────────────────────────
class UF {
  private parent: number[]
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i)
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]]
      i = this.parent[i]
    }
    return i
  }
  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent[ra] = rb
  }
}

/** Find clusters of likely-duplicate leads (read-only). */
export async function findDuplicateClusters(): Promise<DupCluster[]> {
  const supabase = getAdminClient()
  const { data } = await supabase.from('leads').select(DUP_FIELDS)
  const leads = (data ?? []) as Partial<Lead>[]
  if (leads.length < 2) return []

  const uf = new UF(leads.length)
  const linkBy = (keyOf: (l: Partial<Lead>) => string | null) => {
    const seen = new Map<string, number>()
    leads.forEach((l, i) => {
      const k = keyOf(l)
      if (!k) return
      const j = seen.get(k)
      if (j == null) seen.set(k, i)
      else uf.union(i, j)
    })
  }
  // Leads already marked as duplicates are excluded from re-clustering.
  const isMerged = (l: Partial<Lead>) => (l.tags ?? []).includes('duplicate')
  linkBy(l => (isMerged(l) ? null : normPhone(l.phone ?? null)))
  linkBy(l => (isMerged(l) ? null : normEmail(l.email ?? null)))
  linkBy(l => (isMerged(l) ? null : normNameCity(l.business_name ?? null, l.city ?? null)))

  // Group by component root.
  const groups = new Map<number, number[]>()
  leads.forEach((_, i) => {
    const r = uf.find(i)
    const g = groups.get(r) ?? []
    g.push(i)
    groups.set(r, g)
  })

  const clusters: DupCluster[] = []
  for (const idxs of groups.values()) {
    if (idxs.length < 2) continue
    const members = idxs.map(i => leads[i])
    const reasons: DupReason[] = []
    if (hasDup(members.map(m => normPhone(m.phone ?? null)))) reasons.push('phone')
    if (hasDup(members.map(m => normEmail(m.email ?? null)))) reasons.push('email')
    if (hasDup(members.map(m => normNameCity(m.business_name ?? null, m.city ?? null))))
      reasons.push('name+city')
    clusters.push({
      reasons,
      members: members.map(m => ({
        id: m.id as string,
        business_name: m.business_name ?? null,
        owner_name: m.owner_name ?? null,
        city: m.city ?? null,
        phone: m.phone ?? null,
        email: m.email ?? null,
        priority_score: m.priority_score ?? null,
        enrichment_status: m.enrichment_status ?? null,
        tags: (m.tags as string[]) ?? null,
      })),
    })
  }
  // Biggest / most-confident clusters first.
  return clusters.sort((a, b) => b.members.length - a.members.length)
}

function hasDup(keys: (string | null)[]): boolean {
  const seen = new Set<string>()
  for (const k of keys) {
    if (!k) continue
    if (seen.has(k)) return true
    seen.add(k)
  }
  return false
}

// Fields backfilled onto the primary from its duplicates (first non-empty wins).
const MERGEABLE_FIELDS: (keyof Lead)[] = [
  'business_name', 'owner_name', 'contact_name', 'phone', 'email', 'website',
  'primary_crop', 'est_acreage', 'address_physical', 'city', 'county', 'state',
  'zipcode', 'notes',
]

function empty(v: unknown): boolean {
  if (v == null) return true
  if (typeof v === 'string') return v.trim().length === 0
  return false
}

export interface MergeResult {
  ok: boolean
  primaryId: string
  backfilled: string[]
  markedDuplicate: number
  error?: string
}

/**
 * Non-destructively merge `mergeIds` into `primaryId`: backfill the primary's
 * empty fields, union tags, then mark the duplicates (tag + note) rather than
 * deleting them.
 */
export async function mergeLeads(primaryId: string, mergeIds: string[]): Promise<MergeResult> {
  const supabase = getAdminClient()
  const ids = mergeIds.filter(id => id && id !== primaryId)
  if (!ids.length) {
    return { ok: false, primaryId, backfilled: [], markedDuplicate: 0, error: 'no duplicate ids supplied' }
  }

  const { data } = await supabase
    .from('leads')
    .select('*')
    .in('id', [primaryId, ...ids])
  const rows = (data ?? []) as Lead[]
  const primary = rows.find(r => r.id === primaryId)
  if (!primary) {
    return { ok: false, primaryId, backfilled: [], markedDuplicate: 0, error: 'primary lead not found' }
  }
  const dupes = rows.filter(r => r.id !== primaryId)

  // Backfill empty primary fields from the duplicates.
  const patch: Record<string, unknown> = {}
  const backfilled: string[] = []
  for (const f of MERGEABLE_FIELDS) {
    if (!empty(primary[f])) continue
    const donor = dupes.find(d => !empty(d[f]))
    if (donor) {
      patch[f] = donor[f]
      backfilled.push(f)
    }
  }
  // Union tags across the whole cluster (minus the bookkeeping 'duplicate' tag).
  const tagSet = new Set<string>((primary.tags as string[]) ?? [])
  for (const d of dupes) for (const t of (d.tags as string[]) ?? []) if (t !== 'duplicate') tagSet.add(t)
  if (tagSet.size) patch.tags = Array.from(tagSet)

  if (Object.keys(patch).length) {
    const { error } = await supabase.from('leads').update(patch).eq('id', primaryId)
    if (error) {
      return { ok: false, primaryId, backfilled: [], markedDuplicate: 0, error: error.message }
    }
  }

  // Mark each duplicate non-destructively.
  const stamp = new Date().toISOString().slice(0, 10)
  let marked = 0
  for (const d of dupes) {
    const tags = Array.from(new Set([...((d.tags as string[]) ?? []), 'duplicate']))
    const note = `${d.notes ? d.notes + '\n\n' : ''}[merged into ${primaryId} on ${stamp}]`
    const { error } = await supabase
      .from('leads')
      .update({ tags, notes: note, enrichment_status: 'enriched' })
      .eq('id', d.id)
    if (!error) marked++
  }

  return { ok: true, primaryId, backfilled, markedDuplicate: marked }
}
