import { useEffect, useState, type FormEvent } from 'react'
import { apiErrorMessage } from '../api/client'
import { useAccounts, usePortfolioMutations } from '../hooks/queries'
import { useTenant } from '../context/TenantContext'
import { CURRENCIES } from '../lib/format'
import type { PortfolioInput, PortfolioSummary } from '../types/api'
import { TagPicker } from './TagPicker'
import { Button } from './ui/Button'
import { FormError, Input, Label, SectionTitle, Select, TextArea } from './ui/Field'
import { Modal } from './ui/Modal'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  portfolio?: PortfolioSummary
  onSaved?: (p: PortfolioSummary) => void
}

interface FormState {
  name: string
  provider: string
  currency: string
  account_id: string
  opened_on: string
  closed_on: string
  notes: string
  tag_ids: string[]
}

function initial(p?: PortfolioSummary): FormState {
  return {
    name: p?.name ?? '',
    provider: p?.provider ?? '',
    currency: p?.currency ?? 'USD',
    account_id: p?.account?.id ?? '',
    opened_on: p?.opened_on ?? '',
    closed_on: p?.closed_on ?? '',
    notes: p?.notes ?? '',
    tag_ids: p?.tags.map((t) => t.id) ?? [],
  }
}

const orNull = (s: string) => (s.trim() ? s.trim() : null)

// Add / edit a portfolio in the current tenant.
export function PortfolioFormModal({ open, onOpenChange, portfolio, onSaved }: Props) {
  const { tenant } = useTenant()
  const { data: accounts = [] } = useAccounts()
  const { create, update } = usePortfolioMutations()
  const [form, setForm] = useState<FormState>(() => initial(portfolio))
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setForm(initial(portfolio))
      setError(null)
    }
  }, [open, portfolio])

  const set = (key: keyof FormState) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const editing = !!portfolio
  const currencyLocked = editing && (portfolio?.snapshot_count ?? 0) > 0
  const saving = create.isPending || update.isPending

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!form.name.trim()) {
      setError('Name is required')
      return
    }
    if (form.opened_on && form.closed_on && form.closed_on < form.opened_on) {
      setError("Closed date can't be before the opened date")
      return
    }
    setError(null)
    const body: PortfolioInput = {
      name: form.name.trim(),
      provider: orNull(form.provider),
      currency: form.currency,
      account_id: form.account_id || null,
      opened_on: form.opened_on || null,
      closed_on: form.closed_on || null,
      notes: orNull(form.notes),
      tag_ids: form.tag_ids,
    }
    try {
      const saved = editing ? await update.mutateAsync({ id: portfolio!.id, body }) : await create.mutateAsync(body)
      onSaved?.(saved)
      onOpenChange(false)
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save the portfolio'))
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={editing ? `Edit portfolio · ${portfolio!.name}` : 'Add portfolio'}
      subtitle={
        <>
          Tenant <span className="text-ink">{tenant?.name}</span> · holdings are recorded as dated snapshots
        </>
      }
      footer={
        <div className="flex justify-end gap-5">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => submit()} isLoading={saving}>
            {editing ? 'Save changes' : 'Save portfolio'}
          </Button>
        </div>
      }
    >
      <form onSubmit={submit} className="px-5 sm:px-7 py-6 flex flex-col gap-7" noValidate>
        <section className="flex flex-col gap-5">
          <SectionTitle>01 · Basics</SectionTitle>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <Input id="pf-name" label="Name" value={form.name} onChange={set('name')} placeholder="e.g. Fidelity Brokerage" required />
            <Input id="pf-provider" label="Provider" value={form.provider} onChange={set('provider')} placeholder="e.g. Fidelity / Zerodha" />
            <Select
              id="pf-currency"
              label="Currency"
              value={form.currency}
              onChange={set('currency')}
              disabled={currencyLocked}
              hint={currencyLocked ? 'Locked once snapshots are recorded' : undefined}
            >
              {(CURRENCIES.includes(form.currency) ? CURRENCIES : [form.currency, ...CURRENCIES]).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Select id="pf-account" label="Linked account" value={form.account_id} onChange={set('account_id')} hint="brokerage cash account — same tenant only">
              <option value="">None</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                  {a.status === 'closed' ? ' · closed' : ''}
                </option>
              ))}
            </Select>
            <Input id="pf-opened" label="Opened on" type="date" value={form.opened_on} onChange={set('opened_on')} />
            <Input id="pf-closed" label="Closed on" type="date" value={form.closed_on} onChange={set('closed_on')} hint="Leave empty while active" />
          </div>
        </section>
        <section className="flex flex-col gap-4">
          <SectionTitle>02 · Tags &amp; notes</SectionTitle>
          <div>
            <Label>Tags</Label>
            <TagPicker value={form.tag_ids} onChange={(tag_ids) => setForm((f) => ({ ...f, tag_ids }))} />
          </div>
          <TextArea id="pf-notes" label="Notes" value={form.notes} onChange={set('notes')} />
        </section>
        <FormError message={error} />
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  )
}
