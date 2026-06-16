// Slash-commands for the chat input — quick access to the agent's most-used
// tools. Typing "/" surfaces these; picking one either runs immediately
// (run: true) or fills the input with a template for the user to complete.

export interface SlashCommand {
  cmd: string
  label: string
  template: string
  run?: boolean
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { cmd: '/find', label: 'Find leads…', template: 'Find leads ' },
  { cmd: '/breakdown', label: 'Break down leads by crop/county/stage', template: 'Break down leads by ' },
  { cmd: '/draft', label: 'Draft outreach to a lead…', template: 'Draft an email to ' },
  { cmd: '/lead', label: 'Add a new lead…', template: 'Add a lead: ' },
  { cmd: '/job', label: 'Create a job…', template: 'Create a job for ' },
  { cmd: '/finance', label: 'A/R & revenue summary', template: 'What’s our outstanding A/R and collected revenue?', run: true },
  { cmd: '/acres', label: 'Acreage by crop', template: 'How many acres by crop have we mapped?', run: true },
  { cmd: '/alerts', label: 'Check alerts', template: 'Any new alerts?', run: true },
  { cmd: '/recompute', label: 'Recompute EFB risk', template: 'Recompute EFB risk', run: true },
  { cmd: '/activity', label: 'What you changed recently', template: 'What have you changed recently?', run: true },
  { cmd: '/knowledge', label: 'Search the knowledge base…', template: 'Search the knowledge base for ' },
  { cmd: '/save', label: 'Save a note to the knowledge base…', template: 'Remember this: ' },
]

/** Commands to show while the user is still typing the command token. */
export function matchSlash(input: string): SlashCommand[] {
  if (!input.startsWith('/') || input.includes(' ')) return []
  const q = input.slice(1).toLowerCase()
  return SLASH_COMMANDS.filter(c => c.cmd.slice(1).startsWith(q) || c.label.toLowerCase().includes(q))
}

/** If `text` is exactly a run-command, return its prompt; otherwise return text. */
export function resolveSlash(text: string): string {
  const c = SLASH_COMMANDS.find(c => c.cmd === text.trim().toLowerCase())
  return c?.run ? c.template : text
}
