// ─────────────────────────────────────────────────────────────────────────
// Sidekick contextual awareness — a tiny client-side store of what the user is
// currently looking at, so the assistant can resolve "this lead / recompute
// this / mark them contacted" against the on-screen focus.
//
// Pages publish their focus (e.g. the selected lead) via setSidekickFocus and
// clear it on unmount; Sidekick reads it and sends it with each message.
// ─────────────────────────────────────────────────────────────────────────

export interface SidekickFocus {
  kind: 'lead' | 'customer' | 'field'
  id: string
  name?: string | null
}

let focus: SidekickFocus | null = null

export function setSidekickFocus(f: SidekickFocus | null) {
  focus = f
}

export function getSidekickFocus(): SidekickFocus | null {
  return focus
}
