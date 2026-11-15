import { useEffect, useState, type FormEvent } from 'react'
import { ChevronDown, ChevronRight, Plus, X } from 'lucide-react'
import { apiErrorMessage } from '../api/client'
import { useWorkspace } from '../context/WorkspaceContext'
import { useAccountMutations } from '../hooks/queries'
import { parseAmount } from '../lib/amount'
import { COUNTRY_CURRENCY, type Bank } from '../lib/banks'
import { cn } from '../lib/cn'
import { ACCOUNT_TYPE_LABELS, COUNTRIES, CURRENCIES, todayISO } from '../lib/format'
import type { AccountDetail, AccountInput, AccountType } from '../types/api'
import { BankPicker } from './BankPicker'
import { AmountField } from './ui/AmountInput'
import { Button } from './ui/Button'
import { FormError, Input, Label, SectionTitle, Select } from './ui/Field'
import { DateField } from './ui/DateField'
import { Modal } from './ui/Modal'

const ACCOUNT_TYPES = Object.keys(ACCOUNT_TYPE_LABELS) as AccountType[]
const DECIMAL = /^-?\d+(\.\d{1,4})?$/

interface Row {
  key: number
  label: string
  value: string
}

interface FormState {
  name: string
  name_touched: boolean
  institution: string
  account_type: AccountType
  country: string
  country_other: string
  currency: string
  opening_amount: string
  opening_as_of: string
  links: Row[]
}

let seq = 0
const row = (label = '', value = ''): Row => ({ key: ++seq, label, value })

function initial(account: AccountDetail | undefined): FormState {
  const knownCountry = !account?.country || COUNTRIES.some((c) => c.code === account.country)
  return {
    name: account?.name ?? '',
    name_touched: !!account,
    institution: account?.institution ?? '',
    account_type: account?.account_type ?? 'savings',
    country: knownCountry ? (account?.country ?? '') : 'OTHER',
    country_other: knownCountry ? '' : (account?.country ?? ''),
    currency: account?.currency ?? 'USD',
    opening_amount: '',
    opening_as_of: todayISO(),
    links: account ? account.links.map((l) => row(l.label, l.url)) : [],
  }
}

const orNull = (s: string) => (s.trim() ? s.trim() : null)
const suggestName = (institution: string, type: AccountType) => (institution.trim() ? `${institution.trim()} ${ACCOUNT_TYPE_LABELS[type]}` : '')

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  account?: AccountDetail
  onSaved?: (account: AccountDetail) => void
}

// Add / edit an account: only what a planner needs (bank, name, type, currency,
// country, balance). Links sit under "More details". No account numbers or
// personal details are kept. Closing happens on the account's page.
export function AccountFormModal({ open, onOpenChange, account, onSaved }: Props) {
  const { workspace } = useWorkspace()
  const { create, update } = useAccountMutations()
  const [form, setForm] = useState<FormState>(() => initial(account))
  const [more, setMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const editing = !!account

  useEffect(() => {
    if (open) {
      setForm(initial(account))
      setMore(!!account?.links.length)
      setError(null)
    }
  }, [open, account])

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((f) => ({ ...f, [key]: value }))
  const bind = (key: keyof FormState) => (e: { target: { value: string } }) => set(key, e.target.value as never)

  const updateRow = (key: number, field: 'label' | 'value', value: string) =>
    setForm((f) => ({ ...f, links: f.links.map((r) => (r.key === key ? { ...r, [field]: value } : r)) }))
  const removeRow = (key: number) => setForm((f) => ({ ...f, links: f.links.filter((r) => r.key !== key) }))
  const addRow = () => setForm((f) => ({ ...f, links: [...f.links, row()] }))

  const currencyLocked = editing && account.balance !== null
  const openingAmount = parseAmount(form.opening_amount)
  const openingInvalid = !editing && openingAmount !== '' && !DECIMAL.test(openingAmount)
  const country = form.country === 'OTHER' ? form.country_other.trim().toUpperCase() : form.country
  const countryInvalid = form.country === 'OTHER' && country !== '' && !/^[A-Z]{2}$/.test(country)
  const busy = create.isPending || update.isPending
  const currencies = CURRENCIES.includes(form.currency) ? CURRENCIES : [form.currency, ...CURRENCIES]
  const linkCount = form.links.filter((r) => r.label.trim() && r.value.trim()).length

  // Picking a known bank fills in its country and currency, and suggests a name until one is typed.
  const pickBank = (institution: string, bank: Bank | null) =>
    setForm((f) => {
      const next = { ...f, institution }
      if (bank?.country) {
        const known = COUNTRIES.some((c) => c.code === bank.country)
        next.country = known ? bank.country : 'OTHER'
        next.country_other = known ? '' : bank.country
        if (!currencyLocked && COUNTRY_CURRENCY[bank.country]) next.currency = COUNTRY_CURRENCY[bank.country]
      }
      if (!f.name_touched) next.name = suggestName(institution, f.account_type)
      return next
    })
  const pickType = (t: AccountType) => setForm((f) => ({ ...f, account_type: t, name: f.name_touched ? f.name : suggestName(f.institution, t) }))
  const pickCountry = (code: string) =>
    setForm((f) => ({ ...f, country: code, currency: !currencyLocked && !editing && COUNTRY_CURRENCY[code] ? COUNTRY_CURRENCY[code] : f.currency }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    if (!form.name.trim()) return setError('Account name is required')
    if (openingInvalid) return setError('Balance must be a number')
    if (countryInvalid) return setError('Country must be a 2-letter code')

    const links = form.links.filter((r) => r.label.trim() && r.value.trim()).map((r) => ({ label: r.label.trim(), url: r.value.trim() }))
    const base = {
      name: form.name.trim(),
      institution: orNull(form.institution),
      account_type: form.account_type,
      country: country || null,
      currency: form.currency,
      links,
    }

    try {
      let saved: AccountDetail
      if (editing) {
        const body: Partial<AccountInput> = { ...base }
        if (currencyLocked) delete body.currency
        saved = await update.mutateAsync({ id: account.id, body })
      } else {
        const body: AccountInput = {
          ...base,
          opening_balance: openingAmount ? { amount: openingAmount, as_of: form.opening_as_of || todayISO() } : null,
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
      size="lg"
      title={editing ? `Edit account · ${account.name}` : 'Add account'}
      subtitle={
        <>
          Workspace <span className="text-ink">{workspace?.name}</span>
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
      <form id="account-form" onSubmit={submit} noValidate className="px-5 sm:px-7 py-6 flex flex-col gap-6">
        <BankPicker id="a-bank" value={form.institution} country={country || undefined} onChange={pickBank} />

        <Input
          id="a-name"
          label="Account name"
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, name_touched: e.target.value.trim() !== '' }))}
          required
        />

        <div>
          <Label>Type</Label>
          <div role="radiogroup" aria-label="Type" className="inline-flex flex-wrap border border-line">
            {ACCOUNT_TYPES.map((t) => (
              <button
                key={t}
                type="button"
                role="radio"
                aria-checked={form.account_type === t}
                onClick={() => pickType(t)}
                className={cn(
                  'font-mono text-[10px] uppercase tracking-widest px-3 py-2 min-h-10 border-r border-line last:border-r-0',
                  form.account_type === t ? 'bg-ink text-paper' : 'text-ink-muted hover:text-ink',
                )}
              >
                {ACCOUNT_TYPE_LABELS[t]}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] gap-x-6 gap-y-4">
          <div className="flex items-start gap-3">
            <Select
              id="a-cur"
              label="Currency"
              className="w-24 flex-none"
              value={form.currency}
              onChange={bind('currency')}
              disabled={currencyLocked}
              hint={currencyLocked ? 'Locked' : undefined}
            >
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            {editing ? (
              <p className="flex-1 font-mono text-[10px] text-ink-faint pt-7">Record balances from the account page.</p>
            ) : (
              <AmountField
                id="a-bal"
                className="flex-1 min-w-0"
                label="Balance today"
                placeholder="0.00"
                currency={form.currency}
                maxDecimals={4}
                allowNegative
                value={form.opening_amount}
                onValueChange={(v) => set('opening_amount', v)}
                error={openingInvalid ? 'Enter a number' : null}
                hint="Optional"
              />
            )}
          </div>
          <div>
            <Select id="a-country" label="Country" value={form.country} onChange={(e) => pickCountry(e.target.value)}>
              <option value="">—</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
              <option value="OTHER">Other…</option>
            </Select>
            {form.country === 'OTHER' && (
              <Input
                id="a-country-other"
                className="mt-3"
                label="Country code (2 letters)"
                maxLength={2}
                value={form.country_other}
                onChange={bind('country_other')}
                error={countryInvalid ? '2 letters, e.g. FR' : null}
              />
            )}
          </div>
        </div>

        <div className="border-t border-ink pt-1">
          <button
            type="button"
            aria-expanded={more}
            aria-controls="account-more"
            onClick={() => setMore((m) => !m)}
            className="w-full flex items-center gap-2 py-3 min-h-11 font-mono text-[11px] uppercase tracking-widest text-ink hover:underline"
          >
            {more ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
            More details · optional
            <span className="ml-auto normal-case tracking-normal text-[10px] text-ink-muted">
              {linkCount ? `${linkCount} link${linkCount === 1 ? '' : 's'}` : editing ? 'links' : 'balance date · links'}
            </span>
          </button>

          {more && (
            <div id="account-more" className="flex flex-col gap-8 pt-3">
              {!editing && (
                <DateField
                  id="a-asof"
                  label="Balance as of"
                  className="sm:max-w-xs"
                  max={todayISO()}
                  value={form.opening_as_of}
                  onChange={bind('opening_as_of')}
                  hint="Defaults to today"
                />
              )}
              <section className="flex flex-col gap-3">
                <SectionTitle>Links</SectionTitle>
                {form.links.map((r) => (
                  <div key={r.key} className="flex items-end gap-4">
                    <Input
                      id={`lk-${r.key}`}
                      label="Label"
                      placeholder="Net banking"
                      className="flex-1 min-w-0"
                      value={r.label}
                      onChange={(e) => updateRow(r.key, 'label', e.target.value)}
                    />
                    <Input
                      id={`lv-${r.key}`}
                      label="URL"
                      type="url"
                      placeholder="https://"
                      className="flex-[2] min-w-0"
                      value={r.value}
                      onChange={(e) => updateRow(r.key, 'value', e.target.value)}
                    />
                    <button type="button" aria-label="Remove link" onClick={() => removeRow(r.key)} className="text-ink-muted hover:text-ink p-2 min-h-10">
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                ))}
                <Button variant="ghost" className="self-start" onClick={addRow}>
                  <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add link
                </Button>
              </section>
            </div>
          )}
        </div>
      </form>
    </Modal>
  )
}
