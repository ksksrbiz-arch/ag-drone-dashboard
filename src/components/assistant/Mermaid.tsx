'use client'

import { useEffect, useRef, useState } from 'react'

// Renders a Mermaid diagram from code. Mermaid is heavy + touches the DOM, so
// it's dynamically imported on first use and rendered client-side. Invalid
// syntax (e.g. a half-streamed block) falls back to showing the raw code.
export function Mermaid({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [error, setError] = useState(false)

  useEffect(() => {
    let cancelled = false
    setError(false)
    ;(async () => {
      try {
        const mermaid = (await import('mermaid')).default
        mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'strict' })
        const id = 'mmd-' + Math.random().toString(36).slice(2)
        const { svg } = await mermaid.render(id, code.trim())
        if (!cancelled && ref.current) ref.current.innerHTML = svg
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
  return <div ref={ref} className="mermaid-diagram my-2 flex justify-center overflow-x-auto rounded-lg border border-slate-200 bg-white p-3" />
}
