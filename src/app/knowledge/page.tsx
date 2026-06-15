'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface Doc {
  id: string
  title: string
  folder: string
  source: 'note' | 'file'
  mime: string | null
  byte_size: number
  preview: string
  updated_at: string
}

// Text-based files we can read directly in the browser.
const TEXT_EXT = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'yaml', 'yml', 'html', 'xml', 'rtf']
const MAX_BYTES = 200_000 // cap on stored text per document
const MAX_PDF_BYTES = 25_000_000 // raw PDF size we'll try to parse

// Extract text from a PDF entirely in the browser (pdf.js), so no server-side
// parsing dependency is needed. Imported lazily — only when a PDF is chosen.
async function extractPdfText(file: File): Promise<string> {
  const pdfjs: any = await import('pdfjs-dist')
  pdfjs.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString()
  const data = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data }).promise
  let text = ''
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p)
    const content = await page.getTextContent()
    text += content.items.map((i: any) => ('str' in i ? i.str : '')).join(' ') + '\n'
    if (text.length > MAX_BYTES) break
  }
  return text.trim()
}

function fmtBytes(n: number) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

export default function KnowledgePage() {
  const [docs, setDocs] = useState<Doc[]>([])
  const [folders, setFolders] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [isStaff, setIsStaff] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  // Composer state
  const [title, setTitle] = useState('')
  const [folder, setFolder] = useState('General')
  const [content, setContent] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/knowledge')
      const j = await r.json()
      if (j.ok) {
        setDocs(j.documents)
        setFolders(j.folders)
      } else setError(j.error ?? 'Failed to load')
    } catch (e: any) {
      setError(String(e?.message ?? e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return
      const { data: p } = await supabase.from('profiles').select('role').eq('id', data.user.id).single()
      setIsStaff(p?.role === 'owner' || p?.role === 'partner')
    })
  }, [load])

  async function save(doc: { title: string; folder: string; content: string; source: 'note' | 'file'; mime?: string; byte_size?: number }) {
    setBusy(true)
    setError(null)
    try {
      const r = await fetch('/api/knowledge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(doc),
      })
      const j = await r.json()
      if (!j.ok) {
        setError(j.error ?? 'Save failed')
        return false
      }
      await load()
      return true
    } catch (e: any) {
      setError(String(e?.message ?? e))
      return false
    } finally {
      setBusy(false)
    }
  }

  async function addNote(e: React.FormEvent) {
    e.preventDefault()
    if (!title.trim() || !content.trim()) return
    const ok = await save({ title: title.trim(), folder: folder.trim() || 'General', content, source: 'note' })
    if (ok) {
      setTitle('')
      setContent('')
    }
  }

  async function onFiles(files: FileList | null) {
    if (!files?.length) return
    for (const file of Array.from(files)) {
      const ext = file.name.split('.').pop()?.toLowerCase() ?? ''
      const isPdf = ext === 'pdf'
      if (!isPdf && !TEXT_EXT.includes(ext)) {
        setError(`"${file.name}" isn't supported. Use PDF or text files (${TEXT_EXT.join(', ')}), or paste the contents as a note.`)
        continue
      }
      if (isPdf && file.size > MAX_PDF_BYTES) {
        setError(`"${file.name}" is larger than ${fmtBytes(MAX_PDF_BYTES)}.`)
        continue
      }
      if (!isPdf && file.size > MAX_BYTES) {
        setError(`"${file.name}" is larger than ${fmtBytes(MAX_BYTES)}. Split it or trim it down.`)
        continue
      }
      try {
        let text: string
        if (isPdf) {
          setBusy(true)
          text = await extractPdfText(file)
          if (!text) {
            setError(`Couldn't read any text from "${file.name}" — it may be a scanned image. Paste the contents as a note instead.`)
            continue
          }
        } else {
          text = await file.text()
        }
        await save({
          title: file.name.replace(/\.[^.]+$/, ''),
          folder: folder.trim() || 'General',
          content: text,
          source: 'file',
          mime: file.type || (isPdf ? 'application/pdf' : `text/${ext}`),
          byte_size: file.size,
        })
      } catch (e: any) {
        setError(`Failed to read "${file.name}": ${String(e?.message ?? e)}`)
      } finally {
        setBusy(false)
      }
    }
    if (fileRef.current) fileRef.current.value = ''
  }

  async function remove(id: string, title: string) {
    if (!confirm(`Delete "${title}" from the knowledge base?`)) return
    setBusy(true)
    try {
      const r = await fetch(`/api/knowledge?id=${id}`, { method: 'DELETE' })
      const j = await r.json()
      if (!j.ok) setError(j.error ?? 'Delete failed')
      else await load()
    } finally {
      setBusy(false)
    }
  }

  const grouped = folders.length
    ? folders.map(f => ({ folder: f, items: docs.filter(d => d.folder === f) }))
    : [{ folder: 'General', items: [] as Doc[] }]

  return (
    <div className="p-4 sm:p-8 max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Knowledge Base</h1>
        <p className="text-slate-500 text-sm mt-1">
          Files, folders & notes the Sidekick assistant uses as context — pricing sheets, SOPs, call scripts, agronomy references. Upload PDFs or text files (or paste a note); ask Sidekick a reference question and it searches here.
        </p>
      </header>

      {error && (
        <div className="mb-4 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2 flex justify-between gap-3">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-700">×</button>
        </div>
      )}

      {isStaff && (
        <div className="mb-8 bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 shadow-sm">
          <form onSubmit={addNote} className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Title (e.g. Per-acre pricing 2026)"
                className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <input
                value={folder}
                onChange={e => setFolder(e.target.value)}
                placeholder="Folder"
                list="kb-folders"
                className="sm:w-48 text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
              />
              <datalist id="kb-folders">
                {folders.map(f => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </div>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              placeholder="Paste the reference text here…"
              rows={5}
              className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500 font-mono"
            />
            <div className="flex flex-wrap items-center gap-3">
              <button
                type="submit"
                disabled={busy || !title.trim() || !content.trim()}
                className="text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-4 py-2 transition-colors disabled:opacity-60"
              >
                Add note
              </button>
              <span className="text-slate-300">or</span>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy}
                className="text-sm border border-slate-300 hover:bg-slate-50 text-slate-700 rounded-lg px-4 py-2 transition-colors disabled:opacity-60"
              >
                Upload file(s)
              </button>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept={['.pdf', ...TEXT_EXT.map(e => '.' + e)].join(',')}
                onChange={e => onFiles(e.target.files)}
                className="hidden"
              />
              <span className="text-xs text-slate-400">Uploads go to the “{folder.trim() || 'General'}” folder · PDF or text files</span>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <p className="text-slate-400 text-sm">Loading…</p>
      ) : docs.length === 0 ? (
        <div className="text-center py-16 text-slate-400">
          <p className="text-sm">No documents yet.</p>
          {isStaff ? <p className="text-xs mt-1">Add a note or upload a file above to give Sidekick context.</p> : <p className="text-xs mt-1">Ask an owner/partner to add reference material.</p>}
        </div>
      ) : (
        <div className="space-y-6">
          {grouped.map(({ folder: f, items }) => (
            <section key={f}>
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400 mb-2 flex items-center gap-2">
                <span>📁 {f}</span>
                <span className="text-slate-300 font-normal normal-case">{items.length} doc{items.length === 1 ? '' : 's'}</span>
              </h2>
              <div className="grid gap-3 sm:grid-cols-2">
                {items.map(d => (
                  <div key={d.id} className="bg-white border border-slate-200 rounded-xl p-3.5 shadow-sm">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-sm text-slate-800 truncate">
                          {d.source === 'file' ? '📄' : '📝'} {d.title}
                        </div>
                        <div className="text-[11px] text-slate-400 mt-0.5">{fmtBytes(d.byte_size)} · {new Date(d.updated_at).toLocaleDateString()}</div>
                      </div>
                      {isStaff && (
                        <button onClick={() => remove(d.id, d.title)} disabled={busy} aria-label="Delete" className="text-slate-300 hover:text-red-500 text-sm shrink-0">×</button>
                      )}
                    </div>
                    {d.preview && <p className="text-xs text-slate-500 mt-2 line-clamp-3 whitespace-pre-wrap">{d.preview}</p>}
                    <button
                      onClick={() => window.dispatchEvent(new CustomEvent('sidekick:ask', { detail: { query: `From the "${d.title}" doc, give me the key points.` } }))}
                      className="mt-2.5 inline-flex items-center gap-1 text-[11px] text-brand-600 hover:text-brand-700 font-medium"
                    >
                      ✨ Ask Sidekick about this
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}
