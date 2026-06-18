'use client'

import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import remarkBreaks from 'remark-breaks'
import { Mermaid } from './Mermaid'

// Renders an assistant message as rich markdown — headings, lists, tables,
// links, code — and turns ```mermaid fenced blocks into real diagrams. Normal
// prose still renders cleanly (single newlines are preserved via remark-breaks),
// so this is a drop-in upgrade from plain text.
export function RichMessage({ content }: { content: string }) {
  return (
    <div className="text-sm leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
          p: ({ children }) => <p className="my-1.5">{children}</p>,
          h1: ({ children }) => <h1 className="text-base font-bold mt-3 mb-1">{children}</h1>,
          h2: ({ children }) => <h2 className="text-sm font-bold mt-3 mb-1">{children}</h2>,
          h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>,
          ul: ({ children }) => <ul className="list-disc pl-5 my-1.5 space-y-0.5">{children}</ul>,
          ol: ({ children }) => <ol className="list-decimal pl-5 my-1.5 space-y-0.5">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed">{children}</li>,
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer" className="text-brand-700 underline underline-offset-2 hover:text-brand-800">{children}</a>
          ),
          strong: ({ children }) => <strong className="font-semibold">{children}</strong>,
          blockquote: ({ children }) => <blockquote className="border-l-2 border-slate-300 pl-3 my-2 text-slate-600 italic">{children}</blockquote>,
          hr: () => <hr className="my-3 border-slate-200" />,
          table: ({ children }) => (
            <div className="my-2 overflow-x-auto">
              <table className="w-full text-xs border-collapse">{children}</table>
            </div>
          ),
          th: ({ children }) => <th className="border border-slate-200 px-2 py-1 text-left font-semibold bg-slate-50">{children}</th>,
          td: ({ children }) => <td className="border border-slate-200 px-2 py-1">{children}</td>,
          code: ({ className, children }) => {
            // Block code carries a language class; inline code does not.
            if (/language-/.test(className ?? '')) return <code className={className}>{children}</code>
            return <code className="rounded bg-slate-200/70 px-1 py-0.5 text-[0.85em]">{children}</code>
          },
          pre: ({ children }) => {
            // Detect a ```mermaid block and render it as a diagram instead of code.
            const child: any = Array.isArray(children) ? children[0] : children
            const cls: string = child?.props?.className ?? ''
            if (/language-mermaid/.test(cls)) {
              const raw = child?.props?.children
              const code = Array.isArray(raw) ? raw.join('') : String(raw ?? '')
              return <Mermaid code={code} />
            }
            return (
              <pre className="my-2 overflow-x-auto rounded-lg bg-slate-900 text-slate-100 text-xs p-3 leading-relaxed">{children}</pre>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
}
