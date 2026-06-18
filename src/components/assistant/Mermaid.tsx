'use client'

import { useEffect, useRef, useState } from 'react'
import { downloadFile, fileStamp } from '@/lib/download'

// Renders a Mermaid diagram from code. Mermaid is heavy + touches the DOM, so
// it's dynamically imported on first use and rendered client-side. Invalid
// syntax (e.g. a half-streamed block) falls back to showing the raw code.
export function Mermaid({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState(false)
  const [svg, setSvg] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setError(false)
    ;(async () => {
      try {
        const mermaid = (await import('mermaid')).default
        // htmlLabels:false → labels render as SVG <text>, which rasterizes to
        // PNG reliably (foreignObject often blanks out in canvas exports).
        mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict', flowchart: { htmlLabels: false } })
        const id = 'mmd-' + Math.random().toString(36).slice(2)
        const { svg } = await mermaid.render(id, code.trim())
        if (!cancelled) {
          setSvg(svg)
          if (ref.current) ref.current.innerHTML = svg
        }
      } catch {
        if (!cancelled) setError(true)
      }
    })()
    return () => { cancelled = true }
  }, [code])

  // Rasterize the rendered SVG to a PNG (2x) for pasting into slides/email/Slack.
  function downloadPng() {
    const el = ref.current?.querySelector('svg')
    if (!el) return
    const vb = (el as any).viewBox?.baseVal
    const rect = el.getBoundingClientRect()
    const w = Math.ceil(rect.width || vb?.width || 800)
    const h = Math.ceil(rect.height || vb?.height || 600)
    const serialized = new XMLSerializer().serializeToString(el)
    const url = URL.createObjectURL(new Blob([serialized], { type: 'image/svg+xml;charset=utf-8' }))
    const img = new Image()
    img.onload = () => {
      const scale = 2
      const canvas = document.createElement('canvas')
      canvas.width = w * scale
      canvas.height = h * scale
      const cx = canvas.getContext('2d')
      if (cx) {
        cx.fillStyle = '#ffffff'
        cx.fillRect(0, 0, canvas.width, canvas.height)
        cx.scale(scale, scale)
        cx.drawImage(img, 0, 0, w, h)
        canvas.toBlob(b => { if (b) downloadFile(`diagram-${fileStamp()}.png`, b, 'image/png') }, 'image/png')
      }
      URL.revokeObjectURL(url)
    }
    img.onerror = () => URL.revokeObjectURL(url)
    img.src = url
  }

  if (error) {
    return (
      <pre className="my-2 overflow-x-auto rounded-lg bg-slate-900 text-slate-100 text-xs p-3">
        <code>{code}</code>
      </pre>
    )
  }
  return (
    <div className="group relative my-2">
      {svg && (
        <div className="absolute top-1.5 right-1.5 z-10 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => downloadFile(`diagram-${fileStamp()}.svg`, svg, 'image/svg+xml')}
            className="tap text-[11px] bg-white/90 border border-slate-200 rounded-md px-2 py-0.5 text-slate-500 hover:text-slate-800"
            title="Download diagram as SVG"
          >
            ⤓ SVG
          </button>
          <button
            type="button"
            onClick={downloadPng}
            className="tap text-[11px] bg-white/90 border border-slate-200 rounded-md px-2 py-0.5 text-slate-500 hover:text-slate-800"
            title="Download diagram as PNG"
          >
            ⤓ PNG
          </button>
        </div>
      )}
      <div ref={ref} className="mermaid-diagram flex justify-center overflow-x-auto rounded-lg border border-slate-200 bg-white p-3" />
    </div>
  )
}
