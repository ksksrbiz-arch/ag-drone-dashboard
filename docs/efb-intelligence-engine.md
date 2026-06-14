# EFB Intelligence Engine — Satellite Risk Map Overhaul

**App:** 1COMMERCE Drone Ops Dashboard · **Surface:** Intel Hub (`/intel`) + Automation (`/automation`)

## TL;DR

The EFB Intel satellite risk map and its intelligence engine were rebuilt from a
static read-only view into an explainable, recomputable, automated risk system for
Eastern Filbert Blight (EFB) across the hazelnut belt.

## What's new

### 1. EFB Intelligence Engine (`src/lib/efb/`)
- **`scoring.ts`** — pure, deterministic, explainable assessment. Fuses weather
  pressure, leaf wetness, wetness-vs-10yr anomaly, canopy stress (orchard health),
  NDRE decline, the ML risk model, and crop susceptibility into a **0–100 composite**
  with a **per-factor breakdown**, a **confidence** (how much real signal backed the
  score), an **action recommendation** (TREAT/SCOUT/CONTACT/MONITOR), and a
  **spray-window assessment** (can we fly a treatment right now?). Shared by browser
  and server so the dashboard works even before a server run.
- **`engine.ts`** — server orchestrator that recomputes every ag-spray parcel,
  writes back the refreshed assessment + a **risk trend** (rising/falling/steady),
  records run history, and raises **TREAT_NOW alerts** on fresh escalations.
- **`analytics.ts`** — client rollups (by county / crop), spray-window distribution,
  acres-at-risk, and CSV export.

### 2. Overhauled satellite map (`components/intel/RiskMap.tsx`)
Switchable **metric layers** (composite / weather / leaf-wetness / canopy stress / ML),
**basemaps** (satellite / streets / terrain), **marker sizing** by risk or acreage,
**rising-risk highlight rings**, a **fly-to-hottest** control, and an in-map **legend**.

### 3. Intel Hub dashboard expansion (`app/intel/page.tsx`)
Expanded KPI bar (avg risk, critical, treat-now, rising, acres at risk), county/crop
**risk rollups**, **spray-window forecast**, a live **alerts feed**, a sortable/searchable
**parcel risk register** with CSV export, and an enriched **detail drawer** showing the
explainable "why this score" factor breakdown, spray window, confidence, and trend.

### 4. Automation + alerts wiring
- **`app/api/efb/recompute`** (manual + cron) and **`app/api/efb/status`**.
- The daily Vercel cron now also recomputes EFB risk (folded in to respect Hobby's
  one-cron limit).
- **EFB Satellite Risk Engine** panel on the Automation page: run button, write-mode
  health, and run history.

## Database

Apply `supabase/migrations/20260614030000_efb_intelligence.sql` (additive, idempotent).
It adds the EFB assessment columns (`efb_factors`, `efb_confidence`,
`spray_window_status`, `spray_window_score`, `risk_trend`, `efb_recomputed_at`), the
`efb_runs` history table, a `get_efb_kpis()` payload, and the `efb_risk_queue` view.
Until it runs, the engine still scores parcels and writes the legacy
`composite_efb_risk` / `action_recommendation` columns, and the dashboard computes the
new analytics live in the browser.
