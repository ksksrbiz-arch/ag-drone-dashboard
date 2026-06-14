import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = (
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
)!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ─── Types matching supabase_schema.sql ────────────────────────────────────

export type Vertical = 'ag_spray' | 'insurance' | 'real_estate' | 'construction' | 'energy'
export type LOIStatus =
  | 'not_contacted'
  | 'contacted'
  | 'meeting_scheduled'
  | 'loi_sent'
  | 'loi_signed'
  | 'declined'
export type JobStatus =
  | 'quoted'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'invoiced'
  | 'paid'
  | 'cancelled'
export type ActionRec = 'TREAT_NOW' | 'SCOUT_NOW' | 'CONTACT_NOW' | 'MONITOR'
export type PriorityTier = 'P1' | 'P2' | 'P3' | 'P4'
export type EnrichmentStatus =
  | 'pending'
  | 'researching'
  | 'enriched'
  | 'failed'
  | 'stale'

export interface PriorityFactor {
  key: string
  label: string
  weight: number
  value: number // 0..1 normalized
  contribution: number // weight * value * 100
}

export interface Lead {
  id: string
  business_name: string | null
  contact_name: string | null
  owner_name: string | null
  vertical: Vertical
  address_physical: string | null
  city: string | null
  county: string | null
  state: string | null
  zipcode: string | null
  lat: number | null
  lon: number | null
  distance_to_canby_mi: number | null
  est_acreage: number | null
  primary_crop: string | null
  phone: string | null
  email: string | null
  website: string | null
  lead_score: number | null
  loi_status: LOIStatus
  loi_sent_at: string | null
  loi_signed_at: string | null
  assigned_to: string | null
  est_annual_revenue: number | null
  source: string | null
  notes: string | null
  tags: string[] | null
  // EFB / intelligence layer fields (from batch_orchard_intelligence pipeline)
  composite_efb_risk: number | null
  ml_efb_risk: number | null
  ml_confidence: number | null
  efb_weather_risk: number | null
  leaf_wetness_hours: number | null
  wetness_anomaly_pct: number | null
  orchard_health_score: number | null
  mean_ndre: number | null
  ndre_seasonal_slope: number | null
  action_recommendation: ActionRec | null
  model_version: string | null
  // ─── EFB Intelligence Engine fields (from src/lib/efb pipeline) ──────────
  efb_factors?: import('./efb/scoring').EfbFactor[] | null
  efb_confidence?: number | null
  spray_window_status?: import('./efb/scoring').SprayWindow | null
  spray_window_score?: number | null
  risk_trend?: 'rising' | 'falling' | 'steady' | null
  efb_recomputed_at?: string | null
  created_at: string
  updated_at: string
  context: Record<string, unknown> | null
  // ─── Lead Intelligence Engine fields (from src/lib/enrichment pipeline) ──
  priority_score?: number | null
  priority_tier?: PriorityTier | null
  priority_factors?: PriorityFactor[] | null
  data_completeness?: number | null
  enrichment_status?: EnrichmentStatus | null
  enriched_at?: string | null
  enrichment_confidence?: number | null
  research_summary?: string | null
  recommended_approach?: string | null
  best_contact_method?: string | null
  enrichment_sources?: Record<string, unknown> | null
}

export interface EnrichmentRun {
  id: string
  started_at: string
  finished_at: string | null
  status: 'running' | 'completed' | 'failed'
  trigger: 'cron' | 'manual' | 'single' | null
  leads_processed: number
  leads_enriched: number
  leads_failed: number
  ai_calls: number
  ai_enabled: boolean | null
  model_version: string | null
  duration_ms: number | null
  error: string | null
  summary: Record<string, unknown> | null
}

export interface EfbRun {
  id: string
  started_at: string
  finished_at: string | null
  status: 'running' | 'completed' | 'failed'
  trigger: 'cron' | 'manual' | null
  parcels_processed: number
  parcels_updated: number
  treat_now: number
  alerts_raised: number
  duration_ms: number | null
  error: string | null
}

export interface Job {
  id: string
  lead_id: string | null
  job_title: string | null
  vertical: Vertical | null
  status: JobStatus
  scheduled_date: string | null
  completed_date: string | null
  pilot: string | null
  equipment: string | null
  address_physical: string | null
  city: string | null
  county: string | null
  quote_amount: number | null
  invoice_amount: number | null
  paid_amount: number | null
  deliverables: string[] | null
  customer_id: string | null
  created_at: string
  updated_at: string
}

export type CustomerStatus = 'prospect' | 'active' | 'inactive'
export type ContractType = 'loi' | 'service_agreement' | 'quote'
export type ContractStatus =
  | 'draft'
  | 'sent'
  | 'signed'
  | 'active'
  | 'expired'
  | 'declined'

export interface Customer {
  id: string
  business_name: string | null
  contact_name: string | null
  phone: string | null
  email: string | null
  address: string | null
  city: string | null
  county: string | null
  state: string | null
  primary_crop: string | null
  est_acreage: number | null
  status: CustomerStatus
  lead_id: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface Contract {
  id: string
  customer_id: string
  title: string
  type: ContractType
  status: ContractStatus
  annual_value: number | null
  start_date: string | null
  end_date: string | null
  signed_date: string | null
  terms: string | null
  created_at: string
  updated_at: string
}

export interface Alert {
  id: string
  created_at: string
  type: 'treat_now' | 'new_p1' | 'system'
  severity: 'info' | 'warning' | 'critical'
  lead_id: string | null
  title: string
  body: string | null
  read: boolean
}

export interface Field {
  id: string
  name: string
  customer_id: string | null
  lead_id: string | null
  crop: string | null
  acreage: number | null
  boundary: import('./geo').FieldGeometry | null
  center_lat: number | null
  center_lon: number | null
  color: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface PipelineSummary {
  vertical: Vertical
  loi_status: LOIStatus
  count: number
}

export interface MonthlyRevenue {
  month: string
  total_invoiced: number
  total_paid: number
  job_count: number
}
