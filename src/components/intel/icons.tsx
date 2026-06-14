import {
  AlertTriangle,
  ScanSearch,
  Phone,
  Activity,
  Gauge,
  type LucideIcon,
} from 'lucide-react'
import type { ActionRec } from '@/lib/supabase'

// ─────────────────────────────────────────────────────────────────────────
// Standardized iconography for EFB risk / action indicators.
//
// Replaces the ad-hoc emoji dots (🔴🟠🟡🟢) with a consistent Lucide set used
// across the Intelligence Hub and the Overview action queue, so the same signal
// reads the same everywhere.
// ─────────────────────────────────────────────────────────────────────────

export const ACTION_META: Record<
  ActionRec,
  { label: string; Icon: LucideIcon }
> = {
  TREAT_NOW: { label: 'Treat Now', Icon: AlertTriangle },
  SCOUT_NOW: { label: 'Scout Now', Icon: ScanSearch },
  CONTACT_NOW: { label: 'Contact Now', Icon: Phone },
  MONITOR: { label: 'Monitor', Icon: Activity },
}

export const RiskGaugeIcon = Gauge

/** Inline action icon, sized for chips and headers. */
export function ActionIcon({
  action,
  size = 14,
  className = '',
}: {
  action: ActionRec
  size?: number
  className?: string
}) {
  const Icon = ACTION_META[action].Icon
  return <Icon size={size} strokeWidth={2.5} className={className} aria-hidden />
}
