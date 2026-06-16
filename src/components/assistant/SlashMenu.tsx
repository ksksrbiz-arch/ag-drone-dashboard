'use client'

import type { SlashCommand } from '@/lib/assistant/slashCommands'

// Popover of matching slash-commands, rendered just above a chat input.
// Uses onMouseDown (not onClick) so the pick fires before the input blurs.
export function SlashMenu({ items, onPick }: { items: SlashCommand[]; onPick: (c: SlashCommand) => void }) {
  if (!items.length) return null
  return (
    <div className="mb-1.5 bg-white border border-slate-200 rounded-lg shadow-lg overflow-hidden max-h-60 overflow-y-auto">
      {items.map(c => (
        <button
          key={c.cmd}
          type="button"
          onMouseDown={e => { e.preventDefault(); onPick(c) }}
          className="flex w-full items-center justify-between gap-3 px-3 py-1.5 text-xs text-left hover:bg-slate-50 transition-colors"
        >
          <span className="font-semibold text-brand-600 shrink-0">{c.cmd}</span>
          <span className="text-slate-500 truncate">{c.label}</span>
        </button>
      ))}
    </div>
  )
}
