import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ChevronDown, ChevronRight, ImagePlus, Keyboard, Plus, X } from 'lucide-react'
import { apiErrorMessage } from '../api/client'
import { useAccounts, usePortfolioMutations } from '../hooks/queries'
import { useWorkspace } from '../context/WorkspaceContext'
import { COUNTRY_CURRENCY, type Bank } from '../lib/banks'
import { ASSET_CLASS_LABELS, CURRENCIES, PORTFOLIO_ACCOUNT_TYPES, money, todayISO } from '../lib/format'
import { blankRow, isBlank, rowValue, rowsToHoldings, type HoldingRow } from '../lib/holdingRows'
import { cn } from '../lib/cn'
import { handOffScreenshots } from '../lib/pendingScreenshots'
import { MAX_SCREENSHOTS, screenshotProblem } from '../lib/screenshotImport'
import type { AccountSummary, AssetClass, PortfolioInput, PortfolioSummary } from '../types/api'
import { AmountInput } from './ui/AmountInput'
import { Table, stacked, td, th } from './ui/Primitives'
import { BankPicker } from './BankPicker'
import { TagPicker } from './TagPicker'
import { Button } from './ui/Button'
import { FormError, Input, Label, Select, TextArea } from './ui/Field'
import { DateField } from './ui/DateField'
import { Modal } from './ui/Modal'

// Every field is editable, so on narrow screens each row becomes a card instead of dropping columns.
const stack = stacked('lg')

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  portfolio?: PortfolioSummary
  // Adding from an account's page: provider, currency and the link come from it.
  forAccount?: Pick<AccountSummary, 'id' | 'name' | 'institution' | 'currency'>
  // recorded: the Manual entry holdings were saved as its first snapshot too.
  onSaved?: (p: PortfolioSummary, opts: { recorded: boolean }) => void
}

/** Where to go after saving: the portfolio if holdings were recorded, else its Record snapshot page. */
export const afterPortfolioSaved = (p: PortfolioSummary, { recorded }: { recorded: boolean }) =>
  recorded ? `/portfolios/${p.id}` : `/portfolios/${p.id}/snapshots/new`

interface FormState {
  name: string
  name_touched: boolean
  provider: string
  currency: string
  account_id: string
  opened_on: string
  closed_on: string
  notes: string
  tag_ids: string[]
}

function initial(p?: PortfolioSummary, a?: Props['forAccount']): FormState {
  const fromAccount = !p && a
  return {
    name: p?.name ?? (fromAccount ? a.institution?.trim() || a.name : ''),
    name_touched: !!p,
    provider: p?.provider ?? (fromAccount ? (a.institution ?? '') : ''),
    currency: p?.currency ?? (fromAccount ? a.currency : 'USD'),
    account_id: p?.account?.id ?? (fromAccount ? a.id : ''),
    opened_on: p?.opened_on ?? '',
    closed_on: p?.closed_on ?? '',
    notes: p?.notes ?? '',
    tag_ids: p?.tags.map((t) => t.id) ?? [],
  }
}

const orNull = (s: string) => (s.trim() ? s.trim() : null)

// Add / edit a portfolio. Every portfolio belongs to a brokerage account, picked
// first; it fills in the provider, currency and name. Dates, tags and notes sit
// under "More details" — folded when adding, open when editing.
export function PortfolioFormModal({ open, onOpenChange, portfolio, forAccount, onSaved }: Props) {
  const { workspace } = useWorkspace()
  const { data: accounts = [] } = useAccounts()
  const { create, update, createSnapshot } = usePortfolioMutations()
  const [form, setForm] = useState<FormState>(() => initial(portfolio, forAccount))
  const [more, setMore] = useState(!!portfolio)
  const [error, setError] = useState<string | null>(null)
  // Adding only: how the first holdings come in — typed on the snapshot page, or read from screenshots.
  const [mode, setMode] = useState<'manual' | 'screenshots'>('manual')
  const [files, setFiles] = useState<File[]>([])
  // Manual entry: the first snapshot, typed right here (optional).
  const [asOf, setAsOf] = useState(todayISO())
  const [rows, setRows] = useState<HoldingRow[]>(() => [blankRow()])
  // Set once the portfolio exists, so a failed snapshot save retries only the snapshot.
  const created = useRef<PortfolioSummary | null>(null)

  useEffect(() => {
    if (open) {
      setForm(initial(portfolio, forAccount))
      setMore(!!portfolio)
      setError(null)
      setMode('manual')
      setFiles([])
      setAsOf(todayISO())
      setRows([blankRow()])
      created.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reset on open only
  }, [open, portfolio])

  const set = (key: keyof FormState) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }))
  const editing = !!portfolio
  const currencyLocked = editing && (portfolio?.snapshot_count ?? 0) > 0
  const saving = create.isPending || update.isPending || createSnapshot.isPending
  const typed = rows.filter((r) => !isBlank(r)).length
  const currencies = CURRENCIES.includes(form.currency) ? CURRENCIES : [form.currency, ...CURRENCIES]
  // Brokerage accounts it can belong to; editing keeps its current account listed even if closed.
  const brokerages = accounts.filter(
    (a) => PORTFOLIO_ACCOUNT_TYPES.has(a.account_type) && (a.status === 'active' || a.id === form.account_id),
  )
  const pickAccount = (id: string) => {
    const a = accounts.find((x) => x.id === id)
    setForm((f) => {
      const prev = accounts.find((x) => x.id === f.account_id)
      const providerFollows = !f.provider.trim() || f.provider === (prev?.institution ?? '')
      const provider = a && providerFollows ? (a.institution ?? '') : f.provider
      return {
        ...f,
        account_id: id,
        provider,
        currency: a && !currencyLocked ? a.currency : f.currency,
        name: f.name_touched ? f.name : provider.trim() || a?.name || '',
      }
    })
  }
  const filled = [!!(form.opened_on || form.closed_on), form.tag_ids.length > 0, !!form.notes.trim()].filter(Boolean).length

  // A known provider fills in its home currency and suggests the name until one is typed.
  const pickProvider = (provider: string, bank: Bank | null) =>
    setForm((f) => ({
      ...f,
      provider,
      currency: !currencyLocked && bank?.country && COUNTRY_CURRENCY[bank.country] ? COUNTRY_CURRENCY[bank.country] : f.currency,
      name: f.name_touched ? f.name : provider.trim(),
    }))

  const submit = async (e?: FormEvent) => {
    e?.preventDefault()
    if (!form.account_id) {
      setError('Choose the brokerage account it belongs to')
      return
    }
    if (!form.name.trim()) {
      setError('Name is required')
      return
    }
    if (form.opened_on && form.closed_on && form.closed_on < form.opened_on) {
      setMore(true)
      setError("Closed date can't be before the opened date")
      return
    }
    if (!editing && mode === 'screenshots' && files.length === 0) {
      setError('Add at least one screenshot, or switch to Manual entry')
      return
    }
    let checked: ReturnType<typeof rowsToHoldings> | null = null
    if (!editing && mode === 'manual' && typed > 0) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return setError('Pick an "as of" date for the holdings')
      if (asOf > todayISO()) return setError('The holdings date cannot be in the future')
      checked = rowsToHoldings(rows)
      if ('error' in checked) return setError(checked.error)
    }
    setError(null)
    const body: PortfolioInput = {
      name: form.name.trim(),
      provider: orNull(form.provider),
      currency: form.currency,
      account_id: form.account_id,
      opened_on: form.opened_on || null,
      closed_on: form.closed_on || null,
      notes: orNull(form.notes),
      tag_ids: form.tag_ids,
    }
    let saved: PortfolioSummary | null = created.current
    try {
      if (editing) saved = await update.mutateAsync({ id: portfolio!.id, body })
      else if (!saved) saved = created.current = await create.mutateAsync(body)
    } catch (err) {
      return setError(apiErrorMessage(err, 'Could not save the portfolio'))
    }
    if (checked && 'holdings' in checked) {
      try {
        await createSnapshot.mutateAsync({ id: saved!.id, as_of: asOf, holdings: checked.holdings })
      } catch (err) {
        return setError(`The portfolio is saved, but not its holdings: ${apiErrorMessage(err, 'try again')}`)
      }
    }
    if (!editing) handOffScreenshots(saved!.id, mode === 'screenshots' ? files : [])
    onSaved?.(saved!, { recorded: !!checked })
    onOpenChange(false)
  }

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size={editing ? 'lg' : 'xl'}
      title={editing ? `Edit portfolio · ${portfolio!.name}` : 'Add portfolio'}
      subtitle={
        <>
          Workspace <span className="text-ink">{workspace?.name}</span> · holdings are recorded as dated snapshots
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
            <Button onClick={() => submit()} isLoading={saving}>
              {editing
                ? 'Save changes'
                : mode === 'screenshots' && files.length
                  ? `Save & read ${files.length} screenshot${files.length === 1 ? '' : 's'}`
                  : mode === 'manual' && typed
                    ? `Save portfolio & ${typed} holding${typed === 1 ? '' : 's'}`
                    : 'Save portfolio'}
            </Button>
          </div>
        </div>
      }
    >
      <form onSubmit={submit} className="px-5 sm:px-7 py-6 flex flex-col gap-6" noValidate>
        {!editing && (
          <div role="tablist" aria-label="How to add holdings" className="grid grid-cols-2 border border-line -mt-1">
            {(
              [
                ['manual', 'Manual entry', Keyboard, 'Type your holdings'],
                ['screenshots', 'From screenshots', ImagePlus, 'AI reads your holdings'],
              ] as const
            ).map(([key, label, Icon, sub]) => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={mode === key}
                onClick={() => setMode(key)}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 text-left min-h-11 border-b-2 transition-colors',
                  mode === key ? 'border-ink bg-paper-warm text-ink' : 'border-transparent text-ink-muted hover:text-ink',
                )}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span className="flex flex-col">
                  <span className="font-mono text-[11px] uppercase tracking-widest">{label}</span>
                  <span className="font-mono text-[10px] normal-case text-ink-muted">{sub}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {brokerages.length === 0 ? (
          <div role="alert" className="border border-dashed border-line px-4 py-3 font-mono text-[11px] text-ink-muted">
            Portfolios live inside a <span className="text-ink">Brokerage</span> account. Add one on the Accounts page first (or change an
            account&apos;s type to Brokerage), then add its portfolio from there.
          </div>
        ) : (
          <Select
            id="pf-account"
            label="Brokerage account"
            value={form.account_id}
            onChange={(e) => pickAccount(e.target.value)}
            hint="The account this portfolio sits in"
            required
          >
            <option value="" disabled>
              Choose an account…
            </option>
            {brokerages.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
                {a.institution && a.institution !== a.name ? ` · ${a.institution}` : ''} · {a.currency}
                {a.status === 'closed' ? ' · closed' : ''}
              </option>
            ))}
          </Select>
        )}

        <BankPicker id="pf-provider" label="Provider" noneLabel="No provider · self-managed" value={form.provider} onChange={pickProvider} />

        <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,3fr)_minmax(0,1fr)] gap-x-6 gap-y-4">
          <Input
            id="pf-name"
            label="Name"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value, name_touched: e.target.value.trim() !== '' }))}
            placeholder="e.g. Wealthfront"
            required
          />
          <Select
            id="pf-currency"
            label="Currency"
            value={form.currency}
            onChange={set('currency')}
            disabled={currencyLocked}
            hint={currencyLocked ? 'Locked' : undefined}
          >
            {currencies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>

        {!editing && mode === 'screenshots' && <ScreenshotDrop files={files} onChange={setFiles} />}
        {!editing && mode === 'manual' && <HoldingsEntry currency={form.currency} asOf={asOf} onAsOf={setAsOf} rows={rows} onRows={setRows} />}

        <div className="border-t border-ink pt-1">
          <button
            type="button"
            aria-expanded={more}
            aria-controls="portfolio-more"
            onClick={() => setMore((m) => !m)}
            className="w-full flex items-center gap-2 py-3 min-h-11 font-mono text-[11px] uppercase tracking-widest text-ink hover:underline"
          >
            {more ? <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" /> : <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />}
            More details · optional
            <span className="ml-auto normal-case tracking-normal text-[10px] text-ink-muted">{filled ? `${filled} of 3 filled` : 'dates · tags · notes'}</span>
          </button>
          {more && (
            <div id="portfolio-more" className="flex flex-col gap-5 pt-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <DateField id="pf-opened" label="Opened on" value={form.opened_on} onChange={set('opened_on')} />
                <DateField id="pf-closed" label="Closed on" value={form.closed_on} onChange={set('closed_on')} hint="Leave empty while active" />
              </div>
              <div>
                <Label>Tags</Label>
                <TagPicker value={form.tag_ids} onChange={(tag_ids) => setForm((f) => ({ ...f, tag_ids }))} />
              </div>
              <TextArea id="pf-notes" label="Notes" value={form.notes} onChange={set('notes')} />
            </div>
          )}
        </div>
        <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  )
}

// Pick holdings screenshots up front; they're read on the new portfolio's snapshot
// page right after saving. Drop, click or paste.
function ScreenshotDrop({ files, onChange }: { files: File[]; onChange: (f: File[]) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [problems, setProblems] = useState<string[]>([])
  const [dragging, setDragging] = useState(false)
  const urls = useMemo(() => files.map((f) => URL.createObjectURL(f)), [files])
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u)), [urls])

  const filesRef = useRef(files)
  filesRef.current = files
  const add = (incoming: File[]) => {
    const found: string[] = []
    const ok = incoming.filter((f) => {
      const p = screenshotProblem(f)
      if (p) found.push(p)
      return !p
    })
    const room = MAX_SCREENSHOTS - filesRef.current.length
    if (ok.length > room) found.push(`At most ${MAX_SCREENSHOTS} screenshots — ${ok.length - room} left out`)
    setProblems(found)
    if (room > 0 && ok.length) onChange([...filesRef.current, ...ok.slice(0, room)])
  }
  const addRef = useRef(add)
  addRef.current = add

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pasted = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
      if (pasted.length) {
        e.preventDefault()
        addRef.current(pasted.map((f, i) => (f.name ? f : new File([f], `pasted-${i + 1}.png`, { type: f.type }))))
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [])

  return (
    <div className="flex flex-col gap-3">
      <div
        role="button"
        tabIndex={0}
        aria-label="Add screenshots"
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          add(Array.from(e.dataTransfer.files))
        }}
        className={cn(
          'border border-dashed px-5 py-5 flex flex-col items-center gap-1.5 text-center cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-ink',
          dragging ? 'border-ink bg-paper-warm' : 'border-line hover:border-ink',
        )}
      >
        <ImagePlus className="w-5 h-5 text-ink-muted" aria-hidden="true" />
        <p className="font-mono text-xs text-ink">Drop holdings screenshots, click to choose, or paste (Ctrl+V)</p>
        <p className="font-mono text-[10px] text-ink-muted">
          Up to {MAX_SCREENSHOTS} · PNG, JPEG or WebP · 10 MB each · read by an AI model after saving, not stored
        </p>
        <input
          ref={input}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          className="hidden"
          data-testid="portfolio-screenshot-input"
          onChange={(e) => {
            add(Array.from(e.target.files ?? []))
            e.target.value = ''
          }}
        />
      </div>
      {problems.length > 0 && (
        <ul role="alert" className="font-mono text-[11px] text-error space-y-0.5">
          {problems.map((p, i) => (
            <li key={i}>{p}</li>
          ))}
        </ul>
      )}
      {files.length > 0 && (
        <ul className="grid grid-cols-4 gap-3">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} className="border border-line flex flex-col">
              <div className="h-20 bg-paper-warm overflow-hidden">
                <img src={urls[i]} alt={`Screenshot ${i + 1}`} className="w-full object-cover object-top" />
              </div>
              <div className="flex items-center justify-between px-1.5 py-1 border-t border-line">
                <span className="font-mono text-[10px] text-ink-muted">#{i + 1}</span>
                <button
                  type="button"
                  aria-label={`Remove screenshot ${i + 1}`}
                  onClick={() => onChange(files.filter((_, j) => j !== i))}
                  className="p-0.5 text-ink-muted hover:text-error"
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const cellInput =
  'w-full bg-transparent border-0 border-b border-line focus:border-ink focus:outline-none font-mono text-xs text-ink py-1.5 placeholder:text-ink-faint'
const cell = cn(td, 'px-2 py-1.5')

// Manual entry: type the holdings as the portfolio's first snapshot. Optional —
// leave it empty and the Record snapshot page opens after saving instead.
function HoldingsEntry({
  currency,
  asOf,
  onAsOf,
  rows,
  onRows,
}: {
  currency: string
  asOf: string
  onAsOf: (d: string) => void
  rows: HoldingRow[]
  onRows: (r: HoldingRow[]) => void
}) {
  const edit = (key: number, patch: Partial<HoldingRow>) => onRows(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  const total = rows.reduce((s, r) => s + (rowValue(r) ?? 0), 0)
  return (
    <section aria-labelledby="pf-holdings-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h3 id="pf-holdings-title" className="font-mono text-[11px] uppercase tracking-widest text-ink">
            Holdings · first snapshot
          </h3>
          <p className="font-mono text-[10px] text-ink-muted mt-1">Optional — leave empty to add them after saving (or paste a CSV there).</p>
        </div>
        <DateField id="pf-asof" label="As of" max={todayISO()} value={asOf} onChange={(e) => onAsOf(e.target.value)} className="w-44" />
      </div>
      <Table stack="lg">
        <thead className={stack.thead}>
          <tr>
            <th className={cn(th, 'px-2')}>Symbol</th>
            <th className={cn(th, 'px-2')}>Name</th>
            <th className={cn(th, 'px-2')}>Class</th>
            <th className={cn(th, 'px-2 text-right')}>Quantity</th>
            <th className={cn(th, 'px-2 text-right')}>Buy price</th>
            <th className={cn(th, 'px-2 text-right')}>Current price</th>
            <th className={cn(th, 'px-2 text-right')}>Value</th>
            <th className={cn(th, 'px-2')}>
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody className={stack.tbody}>
          {rows.map((r, i) => {
            const value = rowValue(r)
            return (
              <tr key={r.key} className={stack.tr}>
                <td data-label="Symbol" className={cn(cell, 'min-w-[5.5rem]', stack.td)}>
                  <input
                    aria-label={`Symbol, row ${i + 1}`}
                    className={cn(cellInput, 'uppercase font-medium')}
                    value={r.symbol}
                    onChange={(e) => edit(r.key, { symbol: e.target.value.toUpperCase() })}
                    placeholder="AAPL"
                  />
                </td>
                <td data-label="Name" className={cn(cell, 'min-w-[8rem]', stack.td, stack.wide)}>
                  <input aria-label={`Name, row ${i + 1}`} className={cellInput} value={r.name} onChange={(e) => edit(r.key, { name: e.target.value })} placeholder="optional" />
                </td>
                <td data-label="Class" className={cn(cell, 'min-w-[6.5rem]', stack.td)}>
                  <select
                    aria-label={`Asset class, row ${i + 1}`}
                    className={cn(cellInput, 'cursor-pointer [&>option]:bg-paper')}
                    value={r.asset_class}
                    onChange={(e) => edit(r.key, { asset_class: e.target.value as AssetClass })}
                  >
                    {Object.entries(ASSET_CLASS_LABELS).map(([v, l]) => (
                      <option key={v} value={v}>
                        {l}
                      </option>
                    ))}
                  </select>
                </td>
                <td data-label="Quantity" className={cn(cell, 'min-w-[5.5rem]', stack.td)}>
                  <AmountInput
                    aria-label={`Quantity, row ${i + 1}`}
                    maxDecimals={8}
                    className={cn(cellInput, 'text-right num')}
                    value={r.quantity}
                    onValueChange={(v) => edit(r.key, { quantity: v })}
                    placeholder="0"
                  />
                </td>
                <td data-label="Buy price" className={cn(cell, 'min-w-[6rem]', stack.td)}>
                  <AmountInput
                    aria-label={`Buy price, row ${i + 1}`}
                    currency={currency}
                    maxDecimals={6}
                    className={cn(cellInput, 'text-right num')}
                    value={r.buy_price}
                    onValueChange={(v) => edit(r.key, { buy_price: v })}
                    placeholder="optional"
                  />
                </td>
                <td data-label="Current price" className={cn(cell, 'min-w-[6rem]', stack.td)}>
                  <AmountInput
                    aria-label={`Current price, row ${i + 1}`}
                    currency={currency}
                    maxDecimals={6}
                    className={cn(cellInput, 'text-right num')}
                    value={r.current_price}
                    onValueChange={(v) => edit(r.key, { current_price: v })}
                    placeholder="0.00"
                  />
                </td>
                <td data-label="Value" className={cn(cell, 'text-right num', stack.td)}>{value === null ? '—' : money(value, currency)}</td>
                <td className={cn(cell, 'text-right', stack.td)}>
                  <button
                    type="button"
                    aria-label={`Remove row ${i + 1}`}
                    onClick={() => onRows(rows.length === 1 ? [blankRow()] : rows.filter((x) => x.key !== r.key))}
                    className="p-1.5 text-ink-muted hover:text-error"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="secondary" onClick={() => onRows([...rows, blankRow()])}>
          <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add holding
        </Button>
        <p className="font-mono text-xs text-ink-muted">
          Total <span className="num font-bold text-ink ml-2">{money(total, currency)}</span>
        </p>
      </div>
    </section>
  )
}
