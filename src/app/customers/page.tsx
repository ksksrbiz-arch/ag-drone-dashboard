'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { setSidekickFocus } from '@/lib/assistant/context'
import { ActivityTimeline } from '@/components/ActivityTimeline'
import {
  supabase,
  type Customer,
  type CustomerStatus,
  type Contract,
  type ContractStatus,
  type Job,
} from '@/lib/supabase'

const STATUS_META: Record<CustomerStatus, string> = {
  prospect: 'bg-blue-100 text-blue-700',
  active: 'bg-green-100 text-green-700',
  inactive: 'bg-slate-100 text-slate-500',
}

const CONTRACT_STATUS_META: Record<ContractStatus, string> = {
  draft: 'bg-slate-100 text-slate-600',
  sent: 'bg-blue-100 text-blue-700',
  signed: 'bg-violet-100 text-violet-700',
  active: 'bg-green-100 text-green-700',
  expired: 'bg-orange-100 text-orange-700',
  declined: 'bg-red-100 text-red-700',
}

const money = (n: number | null) => (n != null ? `$${Math.round(n).toLocaleString()}` : '—')
const displayName = (c: Customer) => c.business_name || c.contact_name || 'Unnamed customer'

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<CustomerStatus | 'all'>('all')
  const [selected, setSelected] = useState<Customer | null>(null)
  useEffect(() => {
    setSidekickFocus(selected ? { kind: 'customer', id: selected.id, name: selected.business_name ?? selected.contact_name } : null)
    return () => setSidekickFocus(null)
  }, [selected])
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('customers')
      .select('*')
      .order('created_at', { ascending: false })
    setCustomers((data ?? []) as Customer[])
  }, [])

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [load])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return customers.filter(c => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false
      if (!q) return true
      return [c.business_name, c.contact_name, c.city, c.county, c.primary_crop]
        .filter(Boolean)
        .some(v => (v as string).toLowerCase().includes(q))
    })
  }, [customers, search, statusFilter])

  function onSaved(c: Customer) {
    setCustomers(prev => {
      const exists = prev.some(p => p.id === c.id)
      return exists ? prev.map(p => (p.id === c.id ? c : p)) : [c, ...prev]
    })
    setSelected(c)
    setCreating(false)
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto animate-fade">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">Customers</h1>
          <p className="text-slate-500 text-sm mt-0.5">{customers.length} total · contracts & service history</p>
        </div>
        <button
          onClick={() => {
            setCreating(true)
            setSelected(null)
          }}
          className="tap inline-flex items-center justify-center text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-4 py-2 transition-colors shadow-card"
        >
          + New customer
        </button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search name, city, crop…"
          className="tap flex-1 min-w-[180px] text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value as CustomerStatus | 'all')}
          className="tap text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="all">All statuses</option>
          <option value="prospect">Prospect</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* List */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <div key={i} className="h-12 skeleton" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">
              {customers.length === 0 ? 'No customers yet — add one, or convert a lead from the Leads page.' : 'No matches.'}
            </div>
          ) : (
            <div className="divide-y divide-slate-50 max-h-[70vh] overflow-y-auto">
              {filtered.map(c => (
                <button
                  key={c.id}
                  onClick={() => {
                    setSelected(c)
                    setCreating(false)
                  }}
                  className={`tap w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors ${
                    selected?.id === c.id ? 'bg-brand-50' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800 truncate">{displayName(c)}</span>
                    <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_META[c.status]}`}>
                      {c.status}
                    </span>
                  </div>
                  <div className="text-xs text-slate-500 truncate mt-0.5">
                    {[c.city, c.primary_crop].filter(Boolean).join(' · ') || '—'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail / create */}
        <div>
          {creating ? (
            <CustomerForm onSaved={onSaved} onCancel={() => setCreating(false)} />
          ) : selected ? (
            <CustomerDetail customer={selected} onSaved={onSaved} />
          ) : (
            <div className="bg-white rounded-xl border border-slate-200 shadow-card p-8 text-center text-sm text-slate-400">
              Select a customer to see contracts & service history.
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function CustomerForm({ onSaved, onCancel }: { onSaved: (c: Customer) => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    business_name: '',
    contact_name: '',
    phone: '',
    email: '',
    city: '',
    county: '',
    primary_crop: '',
    status: 'active' as CustomerStatus,
  })
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!form.business_name && !form.contact_name) return
    setSaving(true)
    const { data } = await supabase.from('customers').insert(form).select().single()
    setSaving(false)
    if (data) onSaved(data as Customer)
  }

  const field = (k: keyof typeof form, label: string, type = 'text') => (
    <label className="block">
      <span className="text-xs text-slate-500">{label}</span>
      <input
        type={type}
        value={form[k] as string}
        onChange={e => setForm(f => ({ ...f, [k]: e.target.value }))}
        className="tap mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
    </label>
  )

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
      <h2 className="text-sm font-semibold text-slate-700 mb-4">New customer</h2>
      <div className="grid grid-cols-2 gap-3">
        {field('business_name', 'Business name')}
        {field('contact_name', 'Contact name')}
        {field('phone', 'Phone')}
        {field('email', 'Email')}
        {field('city', 'City')}
        {field('county', 'County')}
        {field('primary_crop', 'Primary crop')}
        <label className="block">
          <span className="text-xs text-slate-500">Status</span>
          <select
            value={form.status}
            onChange={e => setForm(f => ({ ...f, status: e.target.value as CustomerStatus }))}
            className="tap mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="prospect">Prospect</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </label>
      </div>
      <div className="flex gap-2 mt-4">
        <button
          onClick={save}
          disabled={saving || (!form.business_name && !form.contact_name)}
          className="tap inline-flex items-center justify-center text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-4 py-2 transition-colors disabled:opacity-60"
        >
          {saving ? 'Saving…' : 'Save customer'}
        </button>
        <button
          onClick={onCancel}
          className="tap inline-flex items-center justify-center text-sm text-slate-500 hover:text-slate-700 px-3"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}

function CustomerDetail({ customer, onSaved }: { customer: Customer; onSaved: (c: Customer) => void }) {
  const [contracts, setContracts] = useState<Contract[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [notes, setNotes] = useState(customer.notes ?? '')
  const [addingContract, setAddingContract] = useState(false)

  const loadRelated = useCallback(async () => {
    const [{ data: c }, { data: j }] = await Promise.all([
      supabase.from('contracts').select('*').eq('customer_id', customer.id).order('created_at', { ascending: false }),
      supabase.from('jobs').select('*').eq('customer_id', customer.id).order('scheduled_date', { ascending: false }),
    ])
    setContracts((c ?? []) as Contract[])
    setJobs((j ?? []) as Job[])
  }, [customer.id])

  useEffect(() => {
    setNotes(customer.notes ?? '')
    loadRelated()
  }, [customer.id, customer.notes, loadRelated])

  async function setStatus(status: CustomerStatus) {
    const { data } = await supabase.from('customers').update({ status }).eq('id', customer.id).select().single()
    if (data) onSaved(data as Customer)
  }

  async function saveNotes() {
    if (notes === (customer.notes ?? '')) return
    const { data } = await supabase.from('customers').update({ notes }).eq('id', customer.id).select().single()
    if (data) onSaved(data as Customer)
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5 space-y-5">
      <div>
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-base font-semibold text-slate-900">{displayName(customer)}</h2>
          <select
            value={customer.status}
            onChange={e => setStatus(e.target.value as CustomerStatus)}
            className={`tap text-xs font-medium rounded-full px-2 py-1 border-0 focus:outline-none ${STATUS_META[customer.status]}`}
          >
            <option value="prospect">prospect</option>
            <option value="active">active</option>
            <option value="inactive">inactive</option>
          </select>
        </div>
        <div className="text-xs text-slate-500 mt-1 space-y-0.5">
          {customer.contact_name && <div>{customer.contact_name}</div>}
          <div>{[customer.city, customer.county && `${customer.county} Co.`].filter(Boolean).join(', ') || '—'}</div>
          <div className="flex flex-wrap gap-x-3">
            {customer.phone && <span>📞 {customer.phone}</span>}
            {customer.email && <span>✉️ {customer.email}</span>}
            {customer.primary_crop && <span>🌾 {customer.primary_crop}</span>}
          </div>
        </div>
      </div>

      {/* Contracts */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-slate-700">Contracts ({contracts.length})</h3>
          <button
            onClick={() => setAddingContract(v => !v)}
            className="tap inline-flex items-center text-xs text-brand-600 hover:text-brand-700 font-medium"
          >
            {addingContract ? 'Close' : '+ Add'}
          </button>
        </div>
        {addingContract && (
          <ContractForm
            customerId={customer.id}
            onSaved={c => {
              setContracts(prev => [c, ...prev])
              setAddingContract(false)
            }}
          />
        )}
        {contracts.length === 0 ? (
          <p className="text-xs text-slate-400">No contracts yet.</p>
        ) : (
          <div className="space-y-2">
            {contracts.map(ct => (
              <div key={ct.id} className="rounded-lg border border-slate-100 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-slate-800 truncate">{ct.title}</span>
                  <span className={`shrink-0 text-xs px-2 py-0.5 rounded-full font-medium ${CONTRACT_STATUS_META[ct.status]}`}>
                    {ct.status}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-0.5">
                  {ct.type.replace('_', ' ')} · {money(ct.annual_value)}/yr
                  {ct.start_date && ` · ${new Date(ct.start_date).toLocaleDateString()}`}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Service history */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Service History ({jobs.length})</h3>
        {jobs.length === 0 ? (
          <p className="text-xs text-slate-400">No jobs linked yet.</p>
        ) : (
          <div className="space-y-1.5">
            {jobs.map(j => (
              <div key={j.id} className="flex items-center justify-between text-xs">
                <span className="text-slate-700 truncate">{j.job_title ?? 'Job'}</span>
                <span className="text-slate-400 shrink-0">
                  {j.status}
                  {j.scheduled_date ? ` · ${new Date(j.scheduled_date).toLocaleDateString()}` : ''}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Notes */}
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-2">Notes</h3>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={saveNotes}
          rows={3}
          placeholder="Add a note…"
          className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>

      <ActivityTimeline entityType="customer" entityId={customer.id} />
    </div>
  )
}

function ContractForm({ customerId, onSaved }: { customerId: string; onSaved: (c: Contract) => void }) {
  const [form, setForm] = useState({
    title: '',
    type: 'service_agreement',
    status: 'draft',
    annual_value: '',
    start_date: '',
  })
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!form.title) return
    setSaving(true)
    const { data } = await supabase
      .from('contracts')
      .insert({
        customer_id: customerId,
        title: form.title,
        type: form.type,
        status: form.status,
        annual_value: form.annual_value ? Number(form.annual_value) : null,
        start_date: form.start_date || null,
      })
      .select()
      .single()
    setSaving(false)
    if (data) onSaved(data as Contract)
  }

  return (
    <div className="rounded-lg border border-slate-200 p-3 mb-2 space-y-2 bg-slate-50/50">
      <input
        value={form.title}
        onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
        placeholder="Contract title"
        className="tap w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
      <div className="grid grid-cols-2 gap-2">
        <select
          value={form.type}
          onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
          className="tap text-sm border border-slate-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="service_agreement">Service agreement</option>
          <option value="loi">LOI</option>
          <option value="quote">Quote</option>
        </select>
        <select
          value={form.status}
          onChange={e => setForm(f => ({ ...f, status: e.target.value }))}
          className="tap text-sm border border-slate-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="draft">Draft</option>
          <option value="sent">Sent</option>
          <option value="signed">Signed</option>
          <option value="active">Active</option>
          <option value="expired">Expired</option>
          <option value="declined">Declined</option>
        </select>
        <input
          value={form.annual_value}
          onChange={e => setForm(f => ({ ...f, annual_value: e.target.value }))}
          placeholder="Annual value $"
          inputMode="numeric"
          className="tap text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <input
          type="date"
          value={form.start_date}
          onChange={e => setForm(f => ({ ...f, start_date: e.target.value }))}
          className="tap text-sm border border-slate-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </div>
      <button
        onClick={save}
        disabled={saving || !form.title}
        className="tap inline-flex items-center justify-center text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-4 py-2 transition-colors disabled:opacity-60"
      >
        {saving ? 'Saving…' : 'Add contract'}
      </button>
    </div>
  )
}
