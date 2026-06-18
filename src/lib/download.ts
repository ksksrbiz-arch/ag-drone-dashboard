// Trigger a client-side file download from text or a Blob. Used for exporting
// assistant-generated documents (.md) and Mermaid diagrams (.svg).
export function downloadFile(filename: string, content: string | Blob, mime = 'text/plain;charset=utf-8') {
  if (typeof window === 'undefined') return
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/** A filesystem-safe timestamp like 2026-06-18-1432 for default filenames. */
export function fileStamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}`
}
