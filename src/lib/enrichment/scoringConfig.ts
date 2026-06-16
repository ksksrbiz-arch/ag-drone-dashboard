import type { ScoringConfig } from './priority'
import type { getAdminClient } from '@/lib/supabaseAdmin'

// Loads the opt-in scoring overrides (weights + thresholds). Best-effort: a
// missing table or empty row yields {}, so the engine falls back to its built-in
// defaults and scoring is unchanged until an override is saved.
export async function loadScoringConfig(
  supabase: ReturnType<typeof getAdminClient>
): Promise<ScoringConfig> {
  try {
    const { data } = await supabase
      .from('scoring_config')
      .select('config')
      .eq('id', 'singleton')
      .maybeSingle()
    const cfg = (data?.config ?? {}) as ScoringConfig
    return cfg && typeof cfg === 'object' ? cfg : {}
  } catch {
    return {}
  }
}
