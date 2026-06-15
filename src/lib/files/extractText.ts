// Shared client-side text extraction for files the user attaches or uploads.
// Text formats are read directly; PDFs are parsed in-browser with pdf.js
// (lazy-loaded), so there's no server-side dependency.

export const TEXT_EXT = ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'log', 'yaml', 'yml', 'html', 'xml', 'rtf']
export const ATTACH_EXT = ['pdf', ...TEXT_EXT]
export const MAX_TEXT_BYTES = 200_000 // cap on extracted text
export const MAX_PDF_BYTES = 25_000_000

export function extOf(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

export function isSupportedFile(name: string): boolean {
  return ATTACH_EXT.includes(extOf(name))
}

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
    if (text.length > MAX_TEXT_BYTES) break
  }
  return text.trim()
}

/** Extract text from a supported file. Throws on unsupported/too-large/empty. */
export async function extractText(file: File): Promise<string> {
  const ext = extOf(file.name)
  if (!ATTACH_EXT.includes(ext)) {
    throw new Error(`"${file.name}" isn't supported. Use a PDF or text file.`)
  }
  if (ext === 'pdf') {
    if (file.size > MAX_PDF_BYTES) throw new Error(`"${file.name}" is too large.`)
    const text = await extractPdfText(file)
    if (!text) throw new Error(`Couldn't read any text from "${file.name}" — it may be a scanned image.`)
    return text.slice(0, MAX_TEXT_BYTES)
  }
  if (file.size > MAX_TEXT_BYTES) throw new Error(`"${file.name}" is larger than 200 KB.`)
  return (await file.text()).slice(0, MAX_TEXT_BYTES)
}
