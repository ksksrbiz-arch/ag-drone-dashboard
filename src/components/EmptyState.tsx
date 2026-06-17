import type { ReactNode } from 'react'

// Shared empty-state primitive — one consistent, friendly look for "nothing
// here yet" / "no matches" across the app (table bodies, panels, lists).
export function EmptyState({
  icon = '📭',
  title,
  hint,
  action,
  className = '',
}: {
  icon?: string
  title: string
  hint?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={`flex flex-col items-center justify-center text-center py-12 px-4 ${className}`}>
      <div className="text-3xl mb-2 opacity-80" aria-hidden>{icon}</div>
      <p className="text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="text-xs text-slate-400 mt-1 max-w-xs">{hint}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  )
}
