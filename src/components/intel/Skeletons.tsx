// ─────────────────────────────────────────────────────────────────────────
// Skeleton loaders for the EFB Intelligence Hub.
//
// These mirror the real components' dimensions so swapping them in during async
// fetches doesn't cause layout shift (CLS). They build on the global `.skeleton`
// shimmer utility (src/app/globals.css) and the existing design tokens.
//
// Injection points on /intel:
//   • ModelStatusBarSkeleton → while `loading`, in place of the dark stats bar
//   • MapSkeleton            → reserves the satellite layer slot (phase: map)
//   • IntelBoardSkeleton     → while `loading`, in place of the action columns
//   • DetailPanelSkeleton    → optional, for async detail hydration
// ─────────────────────────────────────────────────────────────────────────

/** One risk card placeholder — matches the real RiskCard footprint (~76px). */
export function RiskCardSkeleton() {
  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3">
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="h-3.5 w-24 skeleton" />
        <div className="h-3.5 w-6 skeleton" />
      </div>
      <div className="h-3 w-20 skeleton mb-2" />
      <div className="h-1.5 w-full skeleton rounded-full" />
      <div className="h-3 w-28 skeleton mt-2" />
    </div>
  )
}

// Tints mirror the four action columns (Treat / Scout / Contact / Monitor).
const COLUMN_TINTS = [
  'bg-red-50 border-red-200',
  'bg-orange-50 border-orange-200',
  'bg-yellow-50 border-yellow-200',
  'bg-green-50 border-green-200',
]

/** One action column: tinted header + a few risk cards. */
export function ActionColumnSkeleton({
  cards = 2,
  tint = 'bg-slate-50 border-slate-200',
}: {
  cards?: number
  tint?: string
}) {
  return (
    <div className="flex flex-col gap-2">
      <div
        className={`flex items-center justify-between px-3 py-2 rounded-lg border ${tint}`}
      >
        <div className="h-3.5 w-20 skeleton" />
        <div className="h-3.5 w-5 skeleton" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: cards }).map((_, i) => (
          <RiskCardSkeleton key={i} />
        ))}
      </div>
    </div>
  )
}

/** The full 4-column action board placeholder. */
export function IntelBoardSkeleton() {
  return (
    <div className="flex-1 grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-4 gap-4">
      {COLUMN_TINTS.map((tint, i) => (
        <ActionColumnSkeleton key={i} tint={tint} cards={i === 0 ? 3 : 2} />
      ))}
    </div>
  )
}

/** The dark model-status bar placeholder (5 stats). */
export function ModelStatusBarSkeleton() {
  return (
    <div className="bg-slate-800 rounded-xl px-5 py-3 mb-6 flex flex-wrap gap-6">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <div className="h-3 w-20 skeleton opacity-40" />
          <div className="h-5 w-12 skeleton opacity-60" />
        </div>
      ))}
    </div>
  )
}

/** Right-hand detail panel placeholder. */
export function DetailPanelSkeleton() {
  return (
    <div className="w-72 shrink-0 bg-white rounded-xl border border-slate-200 shadow-card p-5 space-y-4 self-start">
      <div className="h-4 w-32 skeleton" />
      <div className="h-3 w-40 skeleton" />
      <div className="h-2.5 w-full skeleton rounded-full" />
      <div className="space-y-2 pt-1">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex justify-between">
            <div className="h-3 w-24 skeleton" />
            <div className="h-3 w-10 skeleton" />
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * Satellite/risk-map placeholder. Reserves the map's vertical space so the
 * layout doesn't jump when the tiles (Mapbox GL JS or Leaflet) hydrate. Used by
 * the upcoming RiskMap component's loading/SSR-fallback state.
 */
export function MapSkeleton({
  className = '',
  height = 'min-h-[280px] md:min-h-[360px]',
}: {
  className?: string
  height?: string
}) {
  return (
    <div
      className={`relative w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 ${height} ${className}`}
    >
      <div className="absolute inset-0 skeleton !rounded-none" />
      <div className="relative flex h-full items-center justify-center text-sm text-slate-400">
        Loading satellite layer…
      </div>
    </div>
  )
}
