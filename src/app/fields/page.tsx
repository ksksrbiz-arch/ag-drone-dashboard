'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import dynamic from 'next/dynamic'
import { supabase, type Field, type Customer } from '@/lib/supabase'
import { parseGeoJSON } from '@/lib/geo'
import { MapSkeleton } from '@/components/intel/Skeletons'

const FieldMap = dynamic(() => import('@/components/intel/FieldMap'), {
  ssr: false,
  loading: () => <MapSkeleton />,
})

const acres = (n: number | null | undefined) => (n != null ? `${Math.round(n * 100) / 100} ac` : '—')

export default function FieldsPage() {
  const [fields, setFields] = useState<Field[]>([])
  const [customers, setCustomers] = useState<Customer[]>([])
  const [loading, setLoading] = useState(true)
  const [selected, setSelected] = useState<Field | null>(null)

  const load = useCallback(async () => {
    const [{ data: f }, { data: c }] = await Promise.all([
      supabase.from('fields').select('*').order('created_at', { ascending: false }),
      supabase.from('customers').select('id, business_name, contact_name').order('business_name'),
    ])
    setFields((f ?? []) as Field[])
    setCustomers((c ?? []) as Customer[])
  }, [])

  useEffect(() => {
    load().finally(() => setLoading(false))
  }, [load])

  const totalAcres = useMemo(
    () => fields.reduce((s, f) => s + (f.acreage ?? 0), 0),
    [fields]
  )
  const customerName = useCallback(
    (id: string | null) => {
      if (!id) return null
      const c = customers.find(x => x.id === id)
      return c ? c.business_name || c.contact_name || 'Customer' : null
    },
    [customers]
  )

  function onImported(newFields: Field[]) {
    setFields(prev => [...newFields, ...prev])
    if (newFields[0]) setSelected(newFields[0])
  }

  async function deleteField(id: string) {
    await supabase.from('fields').delete().eq('id', id)
    setFields(prev => prev.filter(f => f.id !== id))
    setSelected(null)
  }

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto animate-fade">
      <div className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight text-slate-900">Fields</h1>
        <p className="text-slate-500 text-sm mt-0.5">
          {fields.length} fields · {Math.round(totalAcres).toLocaleString()} acres mapped
        </p>
      </div>

      <div className="mb-6">
        {loading ? <MapSkeleton /> : <FieldMap fields={fields} selected={selected} onSelect={setSelected} />}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Field list */}
        <div className="lg:col-span-2 bg-white rounded-xl border border-slate-200 shadow-card overflow-hidden">
          {loading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-12 skeleton" />)}
            </div>
          ) : fields.length === 0 ? (
            <div className="p-8 text-center text-sm text-slate-400">
              No fields yet — import field boundaries from a GeoJSON file to get started.
            </div>
          ) : (
            <div className="divide-y divide-slate-50 max-h-[60vh] overflow-y-auto">
              {fields.map(f => (
                <button
                  key={f.id}
                  onClick={() => setSelected(f)}
                  className={`tap w-full text-left px-4 py-3 hover:bg-slate-50 transition-colors ${
                    selected?.id === f.id ? 'bg-brand-50' : ''
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-slate-800 truncate flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: f.color ?? '#22c55e' }} />
                      {f.name}
                    </span>
                    <span className="text-xs text-slate-500 shrink-0">{acres(f.acreage)}</span>
                  </div>
                  <div className="text-xs text-slate-500 truncate mt-0.5 pl-[18px]">
                    {[f.crop, customerName(f.customer_id)].filter(Boolean).join(' · ') || 'Unassigned'}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Import / detail */}
        <div className="space-y-6">
          {selected ? (
            <FieldDetail
              field={selected}
              customers={customers}
              customerName={customerName(selected.customer_id)}
              onSaved={f => {
                setFields(prev => prev.map(p => (p.id === f.id ? f : p)))
                setSelected(f)
              }}
              onDelete={() => deleteField(selected.id)}
              onClose={() => setSelected(null)}
            />
          ) : (
            <ImportPanel customers={customers} onImported={onImported} />
          )}
        </div>
      </div>
    </div>
  )
}

function ImportPanel({
  customers,
  onImported,
}: {
  customers: Customer[]
  onImported: (fields: Field[]) => void
}) {
  const [text, setText] = useState('')
  const [crop, setCrop] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function importGeoJSON() {
    setBusy(true)
    setMsg(null)
    try {
      const parsed = parseGeoJSON(text)
      const rows = parsed.map(p => ({
        name: p.name,
        boundary: p.geometry,
        acreage: p.acreage,
        center_lat: p.center?.[0] ?? null,
        center_lon: p.center?.[1] ?? null,
        crop: crop || null,
        customer_id: customerId || null,
      }))
      const { data, error } = await supabase.from('fields').insert(rows).select()
      if (error) {
        setMsg(`Failed: ${error.message}`)
      } else {
        const created = (data ?? []) as Field[]
        const total = created.reduce((s, f) => s + (f.acreage ?? 0), 0)
        setMsg(`Imported ${created.length} field(s) · ${Math.round(total)} ac`)
        setText('')
        onImported(created)
      }
    } catch (err: any) {
      setMsg(`Couldn’t parse: ${String(err?.message ?? err)}`)
    } finally {
      setBusy(false)
    }
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => setText(String(reader.result ?? ''))
    reader.readAsText(file)
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5">
      <h2 className="text-sm font-semibold text-slate-700 mb-1">Import field boundaries</h2>
      <p className="text-xs text-slate-400 mb-3">
        Paste GeoJSON (Feature/FeatureCollection/geometry) or upload a .geojson file. Acreage is computed automatically.
      </p>
      <input
        type="file"
        accept=".geojson,.json,application/geo+json,application/json"
        onChange={onFile}
        className="block w-full text-xs text-slate-500 mb-2 file:mr-2 file:tap file:rounded-lg file:border-0 file:bg-slate-100 file:px-3 file:py-2 file:text-xs file:font-medium hover:file:bg-slate-200"
      />
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={5}
        placeholder='{"type":"FeatureCollection","features":[…]}'
        className="w-full text-xs font-mono border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
      />
      <div className="grid grid-cols-2 gap-2 mt-2">
        <input
          value={crop}
          onChange={e => setCrop(e.target.value)}
          placeholder="Crop (optional)"
          className="tap text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
        <select
          value={customerId}
          onChange={e => setCustomerId(e.target.value)}
          className="tap text-sm border border-slate-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="">Unassigned</option>
          {customers.map(c => (
            <option key={c.id} value={c.id}>
              {c.business_name || c.contact_name || 'Customer'}
            </option>
          ))}
        </select>
      </div>
      <button
        onClick={importGeoJSON}
        disabled={busy || !text.trim()}
        className="tap inline-flex items-center justify-center w-full mt-3 text-sm bg-brand-500 hover:bg-brand-600 text-white font-medium rounded-lg px-4 py-2 transition-colors disabled:opacity-60"
      >
        {busy ? 'Importing…' : 'Import'}
      </button>
      {msg && <p className="text-xs text-slate-500 mt-2">{msg}</p>}
    </div>
  )
}

function FieldDetail({
  field,
  customers,
  customerName,
  onSaved,
  onDelete,
  onClose,
}: {
  field: Field
  customers: Customer[]
  customerName: string | null
  onSaved: (f: Field) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(field.name)
  const [crop, setCrop] = useState(field.crop ?? '')
  const [customerId, setCustomerId] = useState(field.customer_id ?? '')
  const [notes, setNotes] = useState(field.notes ?? '')
  const [confirmDel, setConfirmDel] = useState(false)

  useEffect(() => {
    setName(field.name)
    setCrop(field.crop ?? '')
    setCustomerId(field.customer_id ?? '')
    setNotes(field.notes ?? '')
    setConfirmDel(false)
  }, [field.id, field.name, field.crop, field.customer_id, field.notes])

  async function save(patch: Partial<Field>) {
    const { data } = await supabase.from('fields').update(patch).eq('id', field.id).select().single()
    if (data) onSaved(data as Field)
  }

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-card p-5 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-base font-semibold text-slate-900">{field.name}</h2>
        <button onClick={onClose} aria-label="Close" className="tap-sq inline-flex items-center justify-center text-slate-400 hover:text-slate-600 text-xl leading-none">×</button>
      </div>

      <div className="flex items-center gap-4 text-sm">
        <div>
          <div className="text-xs text-slate-400">Acreage</div>
          <div className="text-lg font-bold text-slate-800">{acres(field.acreage)}</div>
        </div>
        {customerName && (
          <div>
            <div className="text-xs text-slate-400">Customer</div>
            <div className="text-sm text-slate-700">{customerName}</div>
          </div>
        )}
      </div>

      <label className="block">
        <span className="text-xs text-slate-500">Name</span>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          onBlur={() => name !== field.name && save({ name })}
          className="tap mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <label className="block">
          <span className="text-xs text-slate-500">Crop</span>
          <input
            value={crop}
            onChange={e => setCrop(e.target.value)}
            onBlur={() => crop !== (field.crop ?? '') && save({ crop: crop || null })}
            className="tap mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500">Customer</span>
          <select
            value={customerId}
            onChange={e => {
              setCustomerId(e.target.value)
              save({ customer_id: e.target.value || null })
            }}
            className="tap mt-1 w-full text-sm border border-slate-200 rounded-lg px-2 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
          >
            <option value="">Unassigned</option>
            {customers.map(c => (
              <option key={c.id} value={c.id}>
                {c.business_name || c.contact_name || 'Customer'}
              </option>
            ))}
          </select>
        </label>
      </div>
      <label className="block">
        <span className="text-xs text-slate-500">Notes</span>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          onBlur={() => notes !== (field.notes ?? '') && save({ notes: notes || null })}
          rows={2}
          className="mt-1 w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-500"
        />
      </label>

      {confirmDel ? (
        <div className="flex items-center gap-2">
          <button onClick={onDelete} className="tap inline-flex items-center justify-center text-xs bg-red-500 hover:bg-red-600 text-white rounded-lg px-3 py-2 font-medium">
            Confirm delete
          </button>
          <button onClick={() => setConfirmDel(false)} className="tap inline-flex items-center text-xs text-slate-500 px-2">
            Cancel
          </button>
        </div>
      ) : (
        <button onClick={() => setConfirmDel(true)} className="tap inline-flex items-center text-xs text-red-500 hover:text-red-600">
          Delete field
        </button>
      )}
    </div>
  )
}
