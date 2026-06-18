// Helpers for saving an assistant reply into the Knowledge base as a note, so a
// generated doc/SOP/summary becomes durable, searchable context the assistant
// can later cite. Used by the "Save to Knowledge" action on chat messages.

/** Derive a concise title from a markdown reply (first heading, else first line). */
export function deriveKbTitle(content: string): string {
  const heading = content.match(/^#{1,3}\s+(.+)$/m)?.[1]
  const firstLine = content.split('\n').map(s => s.trim()).find(Boolean) ?? 'Ace note'
  return (heading ?? firstLine).replace(/[#*`_>]/g, '').trim().slice(0, 80) || 'Ace note'
}

/** Save the content to the knowledge base (folder "Ace Notes"). Staff-only on the server. */
export async function saveNoteToKnowledge(content: string): Promise<boolean> {
  try {
    const res = await fetch('/api/knowledge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: deriveKbTitle(content), folder: 'Ace Notes', content, source: 'note' }),
    })
    return res.ok
  } catch {
    return false
  }
}
