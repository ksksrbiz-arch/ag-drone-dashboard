'use client'

import { useRouter } from 'next/navigation'
import type { EntityCard } from '@/lib/assistant/streamClient'

const ICON: Record<EntityCard['kind'], string> = { lead: '🌱', customer: '🤝', job: '🚁', field: '🗺️' }

// Clickable chips for entities the agent surfaced (leads/customers/jobs).
// Tapping one deep-links into the relevant page.
export function EntityChips({ cards, onNavigate }: { cards?: EntityCard[]; onNavigate?: () => void }) {
  const router = useRouter()
  if (!cards?.length) return null
  return (
    <div className="flex flex-wrap gap-1.5 mt-1.5 max-w-[88%]">
      {cards.map(c => (
        <button
          key={c.kind + c.id}
          onClick={() => { onNavigate?.(); router.push(c.href) }}
          title={c.subtitle ? `${c.title} — ${c.subtitle}` : c.title}
          className="inline-flex items-center gap-1.5 text-xs bg-white hover:bg-slate-50 border border-slate-200 hover:border-brand-300 text-slate-700 rounded-full pl-2 pr-2.5 py-1 transition-colors max-w-full"
        >
          <span className="shrink-0">{ICON[c.kind]}</span>
          <span className="font-medium truncate">{c.title}</span>
          {c.subtitle && <span className="text-slate-400 truncate hidden sm:inline">{c.subtitle}</span>}
        </button>
      ))}
    </div>
  )
}
