'use client'

import { useEffect, useState } from 'react'
import { supabase, type Lead, type LOIStatus } from '@/lib/supabase'
import { useRole } from '@/lib/auth/role'

const STAGES: { status: LOIStatus; label: string; color: string; dot: string }[] = [
  { status: 'not_contacted',     label: 'Not Contacted',    color: 'border-slate-200 bg-slate-50',   dot: 'bg-slate-400'   },
  { status: 'contacted',         label: 'Contacted',        color: 'border-blue-200 bg-blue-50',     dot: 'bg-blue-500'    },
  { status: 'meeting_scheduled', label: 'Meeting Scheduled',color: 'border-indigo-200 bg-indigo-50', dot: 'bg-indigo-500'  },
  { status: 'loi_sent',          label: 'LOI Sent',         color: 'border-purple-200 bg-purple-50', dot: 'bg-purple-500'  },
  { status: 'loi_signed',        label: 'LOI Signed ✅',    color: 'border-green-200 bg-green-50',   dot: 'bg-green-500'   },
  { status: 'declined',          label: 'Declined',         color: 'border-red-200 bg-red-50',       dot: 'bg-red-400'     },
]

const VERTICAL_ICONS: Record<string, string> = {
  ag_spray:    '🌾',
  insurance:   '🏠',
  real_estate: '🏡',
  construction:'🏗️',
}

export default function PipelinePage() {
  const [leads, setLeads] = useState<Lead[]>([])
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)

  useEffect(() => {
    supabase
      .from('leads')
      .select('id, business_name, owner_name, vertical, city, county, primary_crop, lead_score, loi_status, composite_efb_risk, action_recommendation, assigned_to, est_annual_revenue')
      .order('lead_score', { ascending: false })
      .then(({ data }) => {
        setLeads((data ?? []) as Lead[])
        setLoading(false)
      })
  }, [])

  async function moveStage(leadId: string, newStatus: LOIStatus) {
    setUpdating(leadId)
    const updates: Partial<Lead> = { loi_status: newStatus }
    if (newStatus === 'loi_sent') updates.loi_sent_at = new Date().toISOString()
    if (newStatus === 'loi_signed') updates.loi_signed_at = new Date().toISOString()

    await supabase.from('leads').update(updates).eq('id', leadId)
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, loi_status: newStatus } : l))
    setUpdating(null)
  }

  const grouped = STAGES.reduce((acc, stage) => {
    acc[stage.status] = leads.filter(l => l.loi_status === stage.status)
    return acc
  }, {} as Record<LOIStatus, Lead[]>)

  const totalRevenue = leads
    .filter(l => l.loi_status === 'loi_signed')
    .reduce((s, l) => s + (l.est_annual_revenue ?? 0), 0)

  return (
    <div className="p-4 sm:p-6 md:p-8 max-w-screen-2xl mx-auto animate-fade">
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">LOI Pipeline</h1>
          <p className="text-slate-500 text-sm mt-0.5">Drag-free Kanban — click cards to advance stage</p>
        </div>
        <div className="text-sm bg-green-50 border border-green-200 text-green-700 px-4 py-2 rounded-lg font-medium">
          Signed Est. Revenue: ${totalRevenue.toLocaleString()}/yr
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <div className="h-9 skeleton" />
              <div className="h-24 skeleton" /><div className="h-24 skeleton" />
            </div>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {STAGES.map(stage => (
            <div key={stage.status} className="flex flex-col gap-2">
              {/* Column header */}
              <div className={`rounded-lg border px-3 py-2 flex items-center gap-2 ${stage.color}`}>
                <div className={`w-2 h-2 rounded-full shrink-0 ${stage.dot}`} />
                <span className="text-xs font-semibold text-slate-700 leading-tight">{stage.label}</span>
                <span className="ml-auto text-xs text-slate-400 font-medium">
                  {grouped[stage.status]?.length ?? 0}
                </span>
              </div>

              {/* Cards */}
              <div className="space-y-2 min-h-[120px]">
                {(grouped[stage.status] ?? []).map(lead => (
                  <LeadCard
                    key={lead.id}
                    lead={lead}
                    currentStage={stage.status}
                    onAdvance={moveStage}
                    isUpdating={updating === lead.id}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LeadCard({
  lead,
  currentStage,
  onAdvance,
  isUpdating,
}: {
  lead: Lead
  currentStage: LOIStatus
  onAdvance: (id: string, status: LOIStatus) => void
  isUpdating: boolean
}) {
  const { isStaff } = useRole()
  const stageOrder = STAGES.map(s => s.status)
  const currentIdx = stageOrder.indexOf(currentStage)
  const nextStage = stageOrder[currentIdx + 1] as LOIStatus | undefined

  const efbRisk = lead.composite_efb_risk
  const riskColor =
    efbRisk !== null && efbRisk >= 75 ? 'text-red-600' :
    efbRisk !== null && efbRisk >= 55 ? 'text-orange-500' :
    efbRisk !== null && efbRisk >= 40 ? 'text-yellow-600' : 'text-green-600'

  return (
    <div className="bg-white rounded-lg border border-slate-200 p-3 shadow-card hover:shadow-card-hover transition-shadow">
      <div className="flex items-start justify-between gap-1 mb-1.5">
        <div className="text-xs font-semibold text-slate-800 leading-tight truncate">
          {VERTICAL_ICONS[lead.vertical]} {lead.business_name ?? lead.owner_name ?? 'Unknown'}
        </div>
        <span className="text-xs font-bold text-slate-600 shrink-0">{lead.lead_score}</span>
      </div>

      <div className="text-xs text-slate-400 mb-1.5">
        {lead.city}, {lead.county} Co.
        {lead.primary_crop && ` · ${lead.primary_crop}`}
      </div>

      {efbRisk !== null && (
        <div className={`text-xs font-medium mb-2 ${riskColor}`}>
          EFB {efbRisk}/100
        </div>
      )}

      {lead.assigned_to && (
        <div className="text-xs text-slate-400 mb-2">👤 {lead.assigned_to}</div>
      )}

      {isStaff && nextStage && currentStage !== 'declined' && (
        <button
          onClick={() => onAdvance(lead.id, nextStage)}
          disabled={isUpdating}
          className="tap inline-flex items-center justify-center w-full text-xs bg-brand-500 hover:bg-brand-600 text-white rounded
                     py-1.5 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isUpdating ? '…' : `→ ${STAGES.find(s => s.status === nextStage)?.label}`}
        </button>
      )}
    </div>
  )
}
