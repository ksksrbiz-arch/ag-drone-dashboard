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
        mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' })
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
        <button
          type="button"
          onClick={() => downloadFile(`diagram-${fileStamp()}.svg`, svg, 'image/svg+xml')
          }
          className="tap absolute top-1.5 right-1.5 z-10 text-[11px] bg-white/90 border border-slate-200 rounded-md px-2 py-0.5 text-slate-500 hover:text-slate-800 opacity-0 group-hover:opacity-100 transition-opacity"
          title="Download diagram as SVG"
        >
          ⤓ SVG
        </button>
      )}
      <div ref={ref} className="mermaid-diagram flex justify-center overflow-x-auto rounded-lg border border-slate-200 bg-white p-3" />
    </div>
  )
}
