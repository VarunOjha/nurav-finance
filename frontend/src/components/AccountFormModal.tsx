import { useEffect, useState, type FormEvent } from 'react'
import { Plus, X } from 'lucide-react'
import { apiErrorMessage } from '../api/client'
import { useTenant } from '../context/TenantContext'
import { useAccountMutations } from '../hooks/queries'
import { ACCOUNT_TYPE_LABELS, COUNTRIES, CURRENCIES, todayISO } from '../lib/format'
import type { AccountDetail, AccountInput, AccountType } from '../types/api'
import { TagPicker } from './TagPicker'
import { Button } from './ui/Button'
import { FormError, Input, SectionTitle, Select, TextArea } from './ui/Field'
import { Modal } from './ui/Modal'

const QUICK_IDENTIFIERS = ['IFSC', 'Routing no.', 'SWIFT', 'IBAN', 'Bank code', 'Branch', 'MICR']
const ACCOUNT_TYPES = Object.keys(ACCOUNT_TYPE_LABELS).filter((k) => k !== 'portfolio') as AccountType[]
const DECIMAL = /^-?\d+(\.\d{1,4})?$/

interface Row {
  key: number
  label: string
  value: string
}

interface FormState {
  name: string
  institution: string
  account_number: string
  clear_number: boolean
  holder_name: string
  account_type: AccountType
  opened_on: string
  closed_on: string
  country: string
  country_other: string
  city: string
  currency: string
  notes: string
  opening_amount: string
  opening_as_of: string
  identifiers: Row[]
  links: Row[]
  tag_ids: string[]
}

let seq = 0
const row = (label = '', value = ''): Row => ({ key: ++seq, label, value })

function initial(account?: AccountDetail): FormState {
  const knownCountry = !account?.country || COUNTRIES.some((c) => c.code === account.country)
  return {
    name: account?.name ?? '',
    institution: account?.institution ?? '',
    account_number: '',
    clear_number: false,
    holder_name: account?.holder_name ?? '',
    account_type: account?.account_type ?? 'savings',
    opened_on: account?.opened_on ?? '',
    closed_on: account?.closed_on ?? '',
    country: knownCountry ? (account?.country ?? '') : 'OTHER',
    country_other: knownCountry ? '' : (account?.country ?? ''),
    city: account?.city ?? '',
    currency: account?.currency ?? 'USD',
    notes: account?.notes ?? '',
    opening_amount: '',
    opening_as_of: todayISO(),
    identifiers: account ? account.identifiers.map((i) => row(i.label, i.value)) : [],
    links: account ? account.links.map((l) => row(l.label, l.url)) : [],
    tag_ids: account ? account.tags.map((t) => t.id) : [],
  }
}

const orNull = (s: string) => (s.trim() ? s.trim() : null)

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  account?: AccountDetail
  onSaved?: (account: AccountDetail) => void
}

// Big two-column add/edit modal. Lists (identifiers, links, tags) replace on save.
export function AccountFormModal({ open, onOpenChange, account, onSaved }: Props) {
  const { tenant } = useTenant()
  const { create, update } = useAccountMutations()
  const [form, setForm] = useState<FormState>(() => initial(account))
  const [error, setError] = useState<string | null>(null)
  const editing = !!account

  useEffect(() => {
    if (open) {
      setForm(initial(account))
      setError(null)
    }
  }, [open, account])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))
  const bind = (key: keyof FormState) => (e: { target: { value: string } }) => set(key, e.target.value as never)

  const updateRow = (list: 'identifiers' | 'links', key: number, field: 'label' | 'value', value: string) =>
    setForm((f) => ({ ...f, [list]: f[list].map((r) => (r.key === key ? { ...r, [field]: value } : r)) }))
  const removeRow = (list: 'identifiers' | 'links', key: number) => setForm((f) => ({ ...f, [list]: f[list].filter((r) => r.key !== key) }))
  const addRow = (list: 'identifiers' | 'links', label = '') => setForm((f) => ({ ...f, [list]: [...f[list], row(label)] }))

  const currencyLocked = editing && account.balance !== null
  const openingInvalid = !editing && form.opening_amount.trim() !== '' && !DECIMAL.test(form.opening_amount.trim())
  const country = form.country === 'OTHER' ? form.country_other.trim().toUpperCase() : form.country
  const countryInvalid = form.country === 'OTHER' && country !== '' && !/^[A-Z]{2}$/.test(country)
  const busy = create.isPending || update.isPending

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!form.name.trim()) return setError('Account name is required')
    if (openingInvalid) return setError('Opening balance must be a number')
    if (countryInvalid) return setError('Country must be a 2-letter code')

    const identifiers = form.identifiers.filter((r) => r.label.trim() && r.value.trim()).map((r) => ({ label: r.label.trim(), value: r.value.trim() }))
    const links = form.links.filter((r) => r.label.trim() && r.value.trim()).map((r) => ({ label: r.label.trim(), url: r.value.trim() }))
    const base = {
      name: form.name.trim(),
      institution: orNull(form.institution),
      account_type: form.account_type,
      holder_name: orNull(form.holder_name),
      opened_on: form.opened_on || null,
      closed_on: form.closed_on || null,
      country: country || null,
      city: orNull(form.city),
      currency: form.currency,
      notes: orNull(form.notes),
      identifiers,
      links,
      tag_ids: form.tag_ids,
    }

    try {
      let saved: AccountDetail
      if (editing) {
        const body: Partial<AccountInput> = { ...base }
        if (currencyLocked) delete body.currency
        if (form.clear_number) body.account_number = ''
        else if (form.account_number.trim()) body.account_number = form.account_number.trim()
        saved = await update.mutateAsync({ id: account.id, body })
      } else {
        const body: AccountInput = {
          ...base,
          account_number: orNull(form.account_number),
          opening_balance: form.opening_amount.trim() ? { amount: form.opening_amount.trim(), as_of: form.opening_as_of || todayISO() } : null,
        }
        saved = await create.mutateAsync(body)
      }
      onSaved?.(saved)
      onOpenChange(false)
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save the account'))
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="xl"
      title={editing ? `Edit account · ${account.name}` : 'Add account'}
      subtitle={
        <>
          Tenant <span className="text-ink">{tenant?.name}</span> · details can be edited later; balances are only ever appended.
        </>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <FormError message={error} />
          </div>
          <div className="flex items-center gap-5">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" form="account-form" isLoading={busy}>
              Save account
            </Button>
          </div>
        </div>
      }
    >
      <form id="account-form" onSubmit={submit} noValidate className="px-5 sm:px-7 py-6 grid grid-cols-1 lg:grid-cols-2 gap-x-10 gap-y-8">
        <div className="flex flex-col gap-8 min-w-0">
          <section className="flex flex-col gap-4">
            <SectionTitle>01 · Basics</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
              <Input id="a-name" label="Account name" value={form.name} onChange={bind('name')} required />
              <Input id="a-inst" label="Institution" value={form.institution} onChange={bind('institution')} />
              <div>
                <Input
                  id="a-num"
                  label="Account number · encrypted"
                  type="password"
                  autoComplete="off"
                  value={form.account_number}
                  disabled={form.clear_number}
                  onChange={bind('account_number')}
                  hint={editing && account.account_number_masked ? `Leave blank to keep ${account.account_number_masked}` : undefined}
                />
                {editing && account.has_account_number && (
                  <label className="mt-1.5 inline-flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-ink-muted cursor-pointer">
                    <input type="checkbox" checked={form.clear_number} onChange={(e) => set('clear_number', e.target.checked)} />
                    Clear stored number
                  </label>
                )}
              </div>
              <Input id="a-holder" label="Account holder" value={form.holder_name} onChange={bind('holder_name')} />
              <Select id="a-type" label="Type" value={form.account_type} onChange={bind('account_type')}>
                {ACCOUNT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {ACCOUNT_TYPE_LABELS[t]}
                  </option>
                ))}
              </Select>
              <div className="hidden sm:block" />
              <Input id="a-open" label="Opened on" type="date" value={form.opened_on} onChange={bind('opened_on')} />
              <Input id="a-close" label="Closed on" type="date" value={form.closed_on} onChange={bind('closed_on')} hint="Leave empty while active" />
            </div>
          </section>

          <section className="flex flex-col gap-4">
            <SectionTitle>02 · Location &amp; currency</SectionTitle>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
              <Select id="a-country" label="Country" value={form.country} onChange={bind('country')}>
                <option value="">—</option>
                {COUNTRIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
                <option value="OTHER">Other…</option>
              </Select>
              {form.country === 'OTHER' ? (
                <Input
                  id="a-country-other"
                  label="Country code (ISO, 2 letters)"
                  maxLength={2}
                  value={form.country_other}
                  onChange={bind('country_other')}
                  error={countryInvalid ? '2 letters, e.g. FR' : null}
                />
              ) : (
                <div className="hidden sm:block" />
              )}
              <Input id="a-city" label="City / branch" value={form.city} onChange={bind('city')} />
              <Select
                id="a-cur"
                label="Currency"
                value={form.currency}
                onChange={bind('currency')}
                disabled={currencyLocked}
                hint={currencyLocked ? 'Locked once balances are recorded' : undefined}
              >
                {(CURRENCIES.includes(form.currency) ? CURRENCIES : [form.currency, ...CURRENCIES]).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
          </section>

          {!editing && (
            <section className="flex flex-col gap-4">
              <SectionTitle>03 · Opening balance · optional</SectionTitle>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-4">
                <Input
                  id="a-bal"
                  label={`Balance · ${form.currency}`}
                  inputMode="decimal"
                  placeholder="0.00"
                  value={form.opening_amount}
                  onChange={bind('opening_amount')}
                  error={openingInvalid ? 'Enter a number' : null}
                />
                <Input id="a-asof" label="As of" type="date" max={todayISO()} value={form.opening_as_of} onChange={bind('opening_as_of')} />
              </div>
            </section>
          )}
        </div>

        <div className="flex flex-col gap-8 min-w-0">
          <section className="flex flex-col gap-3">
            <SectionTitle>{editing ? '03' : '04'} · Identifiers</SectionTitle>
            {form.identifiers.map((r) => (
              <div key={r.key} className="flex items-end gap-4">
                <Input
                  id={`idk-${r.key}`}
                  label="Label"
                  className="flex-1 min-w-0"
                  value={r.label}
                  onChange={(e) => updateRow('identifiers', r.key, 'label', e.target.value)}
                />
                <Input
                  id={`idv-${r.key}`}
                  label="Value"
                  className="flex-[2] min-w-0"
                  value={r.value}
                  onChange={(e) => updateRow('identifiers', r.key, 'value', e.target.value)}
                />
                <button
                  type="button"
                  aria-label="Remove identifier"
                  onClick={() => removeRow('identifiers', r.key)}
                  className="text-ink-muted hover:text-ink p-2 min-h-10"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="ghost" onClick={() => addRow('identifiers')}>
                <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add identifier
              </Button>
              <span className="font-mono text-[10px] text-ink-faint mx-1">quick add</span>
              {QUICK_IDENTIFIERS.map((label) => (
                <button
                  key={label}
                  type="button"
                  onClick={() => addRow('identifiers', label)}
                  className="font-mono text-[10px] uppercase tracking-wide border border-dashed border-line px-2 py-1 min-h-7 text-ink-muted hover:text-ink hover:border-ink"
                >
                  {label}
                </button>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-3">
            <SectionTitle>{editing ? '04' : '05'} · Links</SectionTitle>
            {form.links.map((r) => (
              <div key={r.key} className="flex items-end gap-4">
                <Input
                  id={`lk-${r.key}`}
                  label="Label"
                  placeholder="Net banking"
                  className="flex-1 min-w-0"
                  value={r.label}
                  onChange={(e) => updateRow('links', r.key, 'label', e.target.value)}
                />
                <Input
                  id={`lv-${r.key}`}
                  label="URL"
                  type="url"
                  placeholder="https://"
                  className="flex-[2] min-w-0"
                  value={r.value}
                  onChange={(e) => updateRow('links', r.key, 'value', e.target.value)}
                />
                <button type="button" aria-label="Remove link" onClick={() => removeRow('links', r.key)} className="text-ink-muted hover:text-ink p-2 min-h-10">
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </div>
            ))}
            <Button variant="ghost" className="self-start" onClick={() => addRow('links')}>
              <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add link
            </Button>
          </section>

          <section className="flex flex-col gap-3">
            <SectionTitle>{editing ? '05' : '06'} · Tags &amp; notes</SectionTitle>
            <TagPicker value={form.tag_ids} onChange={(ids) => set('tag_ids', ids)} />
            <TextArea id="a-notes" label="Notes" value={form.notes} onChange={bind('notes')} />
          </section>
        </div>
      </form>
    </Modal>
  )
}
