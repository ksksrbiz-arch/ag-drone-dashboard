import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { cheapComplete, aiConfigured, extractJson } from '@/lib/ai/llm'
import { LEAD_TAG_VOCAB as VOCAB } from '@/lib/ai/tagging'
import { BUSINESS } from '@/lib/business'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST(req: NextRequest) {
  if (!aiConfigured()) {
    return NextResponse.json(
      { ok: false, error: 'No AI provider configured (set GROQ_API_KEY, OPENROUTER_API_KEY, or ANTHROPIC_API_KEY).' },
      { status: 503 }
    )
  }

  let body: any
  try {
    body = await req.json()
  } catch {
    body = {}
  }
  const limit = Math.min(Math.max(1, Number(body?.limit) || 20), 40)
  const dryRun = body?.dryRun !== false // default true (safe — preview unless explicitly applying)
  const onlyUntagged = body?.onlyUntagged !== false // default true

  const supabase = getAdminClient()
  let q = supabase
    .from('leads')
    .select('id,business_name,owner_name,primary_crop,vertical,county,est_acreage,research_summary,tags')
    .limit(limit)
  if (onlyUntagged) q = q.is('tags', null)
  const { data, error } = await q
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  const leads = data ?? []
  if (leads.length === 0) {
    return NextResponse.json({ ok: true, dryRun, processed: 0, tagged: 0, results: [], note: 'No leads to tag.' })
  }

  const list = leads
    .map(
      (l: any) =>
        `id:${l.id} | ${l.business_name ?? l.owner_name ?? 'Unknown'} | crop:${l.primary_crop ?? '?'} | vertical:${l.vertical} | county:${l.county ?? '?'} | acres:${l.est_acreage ?? '?'} | notes:${String(l.research_summary ?? '').slice(0, 160)}`
    )
    .join('\n')

  const system = `You tag agricultural sales leads for a drone-spraying business (EFB treatment + crop scouting/spraying in ${BUSINESS.region}). For each lead choose 1-4 tags ONLY from this exact list: ${VOCAB.join(', ')}. Pick the single best crop/operation category plus any clearly-supported fit signals. Use "efb-target" only for hazelnut/filbert. Return ONLY JSON mapping each id to an array of tags, e.g. {"<uuid>":["hazelnut","efb-target"]}. No prose, no code fences.`

  let map: Record<string, string[]> = {}
  try {
    const raw = await cheapComplete({ system, user: list, maxTokens: 1400, temperature: 0 })
    map = extractJson<Record<string, string[]>>(raw) ?? {}
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: String(err?.message ?? err) }, { status: 500 })
  }

  const results: { id: string; name: string; tags: string[] }[] = []
  for (const l of leads as any[]) {
    const proposed = (map[l.id] ?? [])
      .map(t => String(t).toLowerCase().trim())
      .filter(t => (VOCAB as readonly string[]).includes(t))
      .slice(0, 4)
    if (proposed.length === 0) continue
    const merged = Array.from(new Set([...((l.tags as string[]) ?? []), ...proposed]))
    results.push({ id: l.id, name: l.business_name ?? l.owner_name ?? 'Unknown', tags: proposed })
    if (!dryRun) {
      await supabase.from('leads').update({ tags: merged }).eq('id', l.id)
    }
  }

  return NextResponse.json({
    ok: true,
    dryRun,
    processed: leads.length,
    tagged: results.length,
    results: results.slice(0, 40),
  })
}
