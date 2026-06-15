import { NextRequest, NextResponse } from 'next/server'
import { getAdminClient } from '@/lib/supabaseAdmin'
import { requireStaffOrCron } from '@/lib/auth/guard'
import { createSupabaseServer } from '@/lib/supabase/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Knowledge base: files / folders / notes the Sidekick assistant uses as
// context. Reads are available to any logged-in user; writes are staff-only.

const MAX_CONTENT = 200_000 // ~200 KB of text per document
const PREVIEW = 240

async function requireUser() {
  const supabase = await createSupabaseServer()
  const { data: { user } } = await supabase.auth.getUser()
  return user
}

// GET /api/knowledge            → list all docs (metadata + preview), grouped client-side
// GET /api/knowledge?id=<uuid>  → full content of one doc
export async function GET(req: NextRequest) {
  if (!(await requireUser())) return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 })
  const supabase = getAdminClient()
  const id = req.nextUrl.searchParams.get('id')

  if (id) {
    const { data, error } = await supabase.from('knowledge_documents').select('*').eq('id', id).single()
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 404 })
    return NextResponse.json({ ok: true, document: data })
  }

  const { data, error } = await supabase
    .from('knowledge_documents')
    .select('id,title,folder,source,mime,byte_size,content,created_at,updated_at')
    .order('folder', { ascending: true })
    .order('title', { ascending: true })
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })

  const documents = (data ?? []).map((d: any) => ({
    id: d.id,
    title: d.title,
    folder: d.folder,
    source: d.source,
    mime: d.mime,
    byte_size: d.byte_size ?? (d.content ? d.content.length : 0),
    preview: String(d.content ?? '').slice(0, PREVIEW),
    created_at: d.created_at,
    updated_at: d.updated_at,
  }))
  const folders = Array.from(new Set(documents.map(d => d.folder))).sort()
  return NextResponse.json({ ok: true, documents, folders })
}

// POST /api/knowledge → create or update a document (staff only).
// Idempotent: re-posting the same (folder, title) updates in place.
export async function POST(req: NextRequest) {
  const gate = await requireStaffOrCron(req)
  if (!gate.ok) return gate.response

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Bad request' }, { status: 400 })
  }

  const title = String(body?.title ?? '').trim()
  const folder = String(body?.folder ?? 'General').trim() || 'General'
  let content = String(body?.content ?? '')
  const source = body?.source === 'file' ? 'file' : 'note'
  if (!title) return NextResponse.json({ ok: false, error: 'A title is required.' }, { status: 400 })
  if (content.length > MAX_CONTENT) content = content.slice(0, MAX_CONTENT)

  const supabase = getAdminClient()
  const row = {
    title,
    folder,
    content,
    source,
    mime: body?.mime ? String(body.mime).slice(0, 120) : null,
    byte_size: typeof body?.byte_size === 'number' ? body.byte_size : content.length,
    updated_at: new Date().toISOString(),
  }

  const { data, error } = await supabase
    .from('knowledge_documents')
    .upsert(row, { onConflict: 'folder,lower(title)' as any, ignoreDuplicates: false })
    .select('id')
    .single()

  // Some PostgREST versions don't accept an expression in onConflict; fall back
  // to a manual find-then-update/insert so re-adds still dedupe.
  if (error) {
    const { data: existing } = await supabase
      .from('knowledge_documents')
      .select('id')
      .eq('folder', folder)
      .ilike('title', title)
      .limit(1)
    if (existing?.[0]) {
      const { error: e2 } = await supabase.from('knowledge_documents').update(row).eq('id', existing[0].id)
      if (e2) return NextResponse.json({ ok: false, error: e2.message }, { status: 500 })
      return NextResponse.json({ ok: true, id: existing[0].id, updated: true })
    }
    const { data: ins, error: e3 } = await supabase.from('knowledge_documents').insert(row).select('id').single()
    if (e3) return NextResponse.json({ ok: false, error: e3.message }, { status: 500 })
    return NextResponse.json({ ok: true, id: ins?.id, created: true })
  }

  return NextResponse.json({ ok: true, id: data?.id })
}

// DELETE /api/knowledge?id=<uuid> (staff only)
export async function DELETE(req: NextRequest) {
  const gate = await requireStaffOrCron(req)
  if (!gate.ok) return gate.response
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ ok: false, error: 'id required' }, { status: 400 })
  const supabase = getAdminClient()
  const { error } = await supabase.from('knowledge_documents').delete().eq('id', id)
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
