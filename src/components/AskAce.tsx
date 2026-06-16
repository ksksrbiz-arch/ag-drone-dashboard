'use client'

// A small, reusable affordance that puts Ace one tap away on any page. Clicking
// it opens the assistant and submits a context-aware question about whatever the
// user is looking at — the same `sidekick:ask` channel the knowledge cards use.

export function AskAce({
  query,
  label = 'Ask Ace',
  className = '',
}: {
  query: string
  label?: string
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new CustomEvent('sidekick:ask', { detail: { query } }))}
      className={`tap inline-flex items-center gap-1.5 text-xs font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-100 rounded-lg px-2.5 py-1.5 transition-colors ${className}`}
    >
      <span aria-hidden>✨</span>
      {label}
    </button>
  )
}
