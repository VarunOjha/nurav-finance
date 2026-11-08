import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { apiErrorMessage } from '../api/client'
import { HoldingsCsvModal } from '../components/HoldingsCsvModal'
import { ScreenshotImportModal, type ImportedHolding } from '../components/ScreenshotImportModal'
import { clearScreenshots, peekScreenshots } from '../lib/pendingScreenshots'
import { AmountInput } from '../components/ui/AmountInput'
import { Button } from '../components/ui/Button'
import { BankLogo } from '../components/BankLogo'
import { FormError, TextArea } from '../components/ui/Field'
import { DateField } from '../components/ui/DateField'
import { Chip, ErrorBox, Loading, Page, PageHeader, Table, onlyBelow, showFrom, stacked, td, th } from '../components/ui/Primitives'
import { usePortfolio, usePortfolioMutations, useSnapshotPrefill } from '../hooks/queries'
import { trimDecimal } from '../lib/amount'
import { blankRow, newRowKey, num, rowsToHoldings, type HoldingRow } from '../lib/holdingRows'
import { cn } from '../lib/cn'
import type { CsvHolding } from '../lib/holdingsCsv'
import { ASSET_CLASS_LABELS, arrow, deltaClass, formatDate, money, quantity, signedMoney, todayISO, toNumber } from '../lib/format'
import type { AssetClass, Holding } from '../types/api'

// Every field is editable, so on narrow screens each row becomes a card instead of dropping columns.
const stack = stacked('lg')

type Row = HoldingRow

const cellInput =
  'w-full bg-transparent border-0 border-b border-line focus:border-ink focus:outline-none font-mono text-xs text-ink py-1.5 placeholder:text-ink-faint'

const fromHolding = (h: Holding): Row => ({
  key: newRowKey(),
  symbol: h.symbol,
  name: h.name ?? '',
  asset_class: h.asset_class,
  quantity: trimDecimal(h.quantity),
  buy_price: trimDecimal(h.buy_price),
  current_price: trimDecimal(h.current_price),
})

const fromImport = (h: CsvHolding | ImportedHolding): Row => ({ key: newRowKey(), symbol: h.symbol, name: h.name ?? '', asset_class: h.asset_class, quantity: h.quantity, buy_price: h.buy_price ?? '', current_price: h.current_price })

// Record a snapshot. Rows start from the latest snapshot dated before "as of"
// (backdating-aware); value, change and new/sold/changed are computed live.
export default function SnapshotPage() {
  const { portfolioId = '' } = useParams()
  const navigate = useNavigate()
  const portfolio = usePortfolio(portfolioId)
  const { createSnapshot } = usePortfolioMutations()

  const [asOf, setAsOf] = useState(todayISO())
  const prefill = useSnapshotPrefill(portfolioId, asOf)
  const [rows, setRows] = useState<Row[]>([])
  const [note, setNote] = useState('')
  const [dirty, setDirty] = useState(false)
  const [seededFrom, setSeededFrom] = useState<string | null | undefined>(undefined) // snapshot id or null (none)
  const [error, setError] = useState<string | null>(null)
  const [csvOpen, setCsvOpen] = useState(false)
  // Coming from Add portfolio → From screenshots: open the import with those images.
  const [handedOver] = useState(() => peekScreenshots(portfolioId))
  const [shotsOpen, setShotsOpen] = useState(() => !!handedOver)
  useEffect(() => clearScreenshots(portfolioId), [portfolioId])
  const lastPrefill = useRef<typeof prefill.data>()

  const base = prefill.data
  const baseKey = base ? (base.based_on?.id ?? null) : undefined

  const seed = () => {
    if (!base) return
    setRows(base.holdings.length ? base.holdings.map(fromHolding) : [blankRow()])
    setSeededFrom(base.based_on?.id ?? null)
    setDirty(false)
  }

  // Re-seed when the base snapshot changes — unless the user already edited.
  useEffect(() => {
    if (!base || base === lastPrefill.current) return
    lastPrefill.current = base
    if (!dirty || seededFrom === undefined) seed()
  }, [base])

  const edit = (key: number, patch: Partial<Row>) => {
    setDirty(true)
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)))
  }

  const baseBySymbol = useMemo(() => new Map((base?.holdings ?? []).map((h) => [h.symbol, h])), [base])

  const computed = rows.map((r) => {
    const q = num(r.quantity)
    const p = num(r.current_price)
    const value = q !== null && p !== null ? q * p : null
    const sym = r.symbol.trim().toUpperCase()
    const prev = sym ? baseBySymbol.get(sym) : undefined
    const prevValue = prev ? toNumber(prev.value) ?? 0 : 0
    let status: 'new' | 'changed' | 'unchanged' | null = null
    if (sym && base?.based_on) {
      if (!prev) status = 'new'
      else status = q !== null && q !== toNumber(prev.quantity) ? 'changed' : 'unchanged'
    }
    return { row: r, sym, value, delta: value !== null ? value - prevValue : null, status }
  })

  const presentSymbols = new Set(computed.map((c) => c.sym).filter(Boolean))
  const sold = (base?.based_on ? base.holdings : []).filter((h) => !presentSymbols.has(h.symbol))
  const total = computed.reduce((s, c) => s + (c.value ?? 0), 0)
  const baseTotal = base?.based_on ? toNumber(base.based_on.total) ?? 0 : null
  const counts = {
    new: computed.filter((c) => c.status === 'new').length,
    changed: computed.filter((c) => c.status === 'changed').length,
    sold: sold.length,
  }

  if (portfolio.isLoading) {
    return (
      <Page>
        <Loading />
      </Page>
    )
  }
  if (portfolio.error || !portfolio.data) {
    return (
      <Page>
        <ErrorBox message={apiErrorMessage(portfolio.error, 'Portfolio not found in this workspace')} />
      </Page>
    )
  }
  const p = portfolio.data
  const cur = p.currency
  const today = todayISO()

  const save = async () => {
    setError(null)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asOf)) return setError('Pick an "as of" date')
    if (asOf > today) return setError('The date cannot be in the future')
    const checked = rowsToHoldings(rows)
    if ('error' in checked) return setError(checked.error)
    const { holdings } = checked
    try {
      await createSnapshot.mutateAsync({ id: p.id, as_of: asOf, note: note.trim() || null, holdings })
      navigate(`/portfolios/${p.id}`)
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save the snapshot'))
    }
  }

  const undoSold = (h: Holding) => {
    setDirty(true)
    setRows((rs) => [...rs, fromHolding(h)])
  }

  return (
    <Page>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <BankLogo institution={p.provider} size="lg" />
            Record snapshot · {p.name}
          </span>
        }
        subtitle="Snapshots are immutable — to fix one, delete it and record it again. Backdated snapshots slot in by date."
      />

      <div className="flex flex-wrap items-end gap-6">
        <DateField id="snap-asof" label="As of" max={today} value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-48" />
        <div className="font-mono text-[11px] text-ink-muted pb-2 flex flex-wrap items-center gap-3">
          {prefill.isLoading ? (
            'Looking for the previous snapshot…'
          ) : base?.based_on ? (
            <span>
              Starting from the <span className="text-ink">{formatDate(base.based_on.as_of)}</span> snapshot — edit quantities and current prices
            </span>
          ) : base ? (
            <span>First snapshot before this date — add holdings</span>
          ) : null}
          {base && dirty && seededFrom !== baseKey && (
            <Button variant="secondary" onClick={seed}>
              {base.based_on ? `Reload from ${formatDate(base.based_on.as_of)} snapshot` : 'Clear rows'}
            </Button>
          )}
        </div>
      </div>

      <Table stack="lg">
        <thead className={stack.thead}>
          <tr>
            <th className={th}>Symbol</th>
            <th className={th}>Name</th>
            <th className={th}>Class</th>
            <th className={cn(th, 'text-right')}>Quantity</th>
            <th className={cn(th, 'text-right')}>Buy price · {cur}</th>
            <th className={cn(th, 'text-right')}>Current price · {cur}</th>
            <th className={cn(th, 'text-right')}>Value</th>
            <th className={cn(th, 'text-right', showFrom.xl)}>Δ vs base</th>
            <th className={th}>
              <span className="sr-only">Status and actions</span>
            </th>
          </tr>
        </thead>
        <tbody className={stack.tbody}>
          {computed.map(({ row: r, value, delta, status }) => (
            <tr key={r.key} className={stack.tr}>
              <td data-label="Symbol" className={cn(td, 'min-w-[5.5rem]', stack.td)}>
                <input
                  aria-label="Symbol"
                  className={cn(cellInput, 'uppercase font-medium')}
                  value={r.symbol}
                  onChange={(e) => edit(r.key, { symbol: e.target.value.toUpperCase() })}
                  placeholder="AAPL"
                />
              </td>
              <td data-label="Name" className={cn(td, 'min-w-[7rem]', stack.td, stack.wide)}>
                <input aria-label="Name" className={cellInput} value={r.name} onChange={(e) => edit(r.key, { name: e.target.value })} placeholder="Apple Inc." />
              </td>
              <td data-label="Class" className={cn(td, 'min-w-[7rem]', stack.td)}>
                <select
                  aria-label="Asset class"
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
              <td data-label="Quantity" className={cn(td, 'min-w-[5.5rem]', stack.td)}>
                <AmountInput aria-label="Quantity" maxDecimals={8} className={cn(cellInput, 'text-right num')} value={r.quantity} onValueChange={(v) => edit(r.key, { quantity: v })} placeholder="0" />
              </td>
              <td data-label="Buy price" className={cn(td, 'min-w-[5.5rem]', stack.td)}>
                <AmountInput
                  aria-label="Buy price"
                  currency={cur}
                  maxDecimals={6}
                  className={cn(cellInput, 'text-right num')}
                  value={r.buy_price}
                  onValueChange={(v) => edit(r.key, { buy_price: v })}
                  placeholder="optional"
                />
              </td>
              <td data-label="Current price" className={cn(td, 'min-w-[5.5rem]', stack.td)}>
                <AmountInput
                  aria-label="Current price"
                  currency={cur}
                  maxDecimals={6}
                  className={cn(cellInput, 'text-right num')}
                  value={r.current_price}
                  onValueChange={(v) => edit(r.key, { current_price: v })}
                  placeholder="0.00"
                />
              </td>
              <td data-label="Value" className={cn(td, 'text-right num font-medium', stack.td)}>
                {value === null ? '—' : money(value, cur)}
                {delta !== null && base?.based_on && <div className={cn('text-[10px] font-normal mt-0.5', deltaClass(delta), onlyBelow.xl)}>{signedMoney(delta, cur)}</div>}
              </td>
              {/* Δ sits under Value until the table is wide enough for its own column. */}
              <td data-label="Δ vs base" className={cn(td, 'text-right num', deltaClass(delta), stack.td, 'hidden t-lg:hidden t-xl:table-cell')}>{delta === null || !base?.based_on ? '—' : signedMoney(delta, cur)}</td>
              <td className={cn(td, 'text-right py-0', stack.td)}>
                <div className="flex items-center justify-end gap-2">
                  {status === 'new' && (
                    <Chip active className="uppercase">
                      new
                    </Chip>
                  )}
                  {status === 'changed' && <Chip active>changed</Chip>}
                  <button
                    type="button"
                    aria-label="Remove holding"
                    onClick={() => {
                      setDirty(true)
                      setRows((rs) => rs.filter((x) => x.key !== r.key))
                    }}
                    className="p-2 text-ink-muted hover:text-error"
                  >
                    <X className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {sold.map((h) => (
            <tr key={`sold-${h.symbol}`} className={cn('text-ink-muted', stack.tr)}>
              <td data-label="Symbol" className={cn(td, stack.td)}>
                <span className="line-through">{h.symbol}</span>
              </td>
              <td data-label="Name" className={cn(td, 'text-ink-muted', stack.td, stack.wide)}>{h.name ?? '—'}</td>
              <td data-label="Class" className={cn(td, 'text-[10px] uppercase tracking-widest text-ink-muted', stack.td)}>{ASSET_CLASS_LABELS[h.asset_class] ?? h.asset_class}</td>
              <td data-label="Quantity" className={cn(td, 'text-right num text-ink-muted', stack.td)}>{quantity(h.quantity)}</td>
              <td data-label="Buy price" className={cn(td, 'text-right num text-ink-muted', stack.td)}>{h.buy_price === null ? '—' : money(h.buy_price, cur)}</td>
              <td data-label="Current price" className={cn(td, 'text-right num text-ink-muted', stack.td)}>{money(h.current_price, cur)}</td>
              <td data-label="Value" className={cn(td, 'text-right num text-ink-muted', stack.td)}>
                {money(0, cur)}
                <div className={cn('text-[10px] mt-0.5 text-error', onlyBelow.xl)}>{signedMoney(-(toNumber(h.value) ?? 0), cur)}</div>
              </td>
              <td data-label="Δ vs base" className={cn(td, 'text-right num text-error', stack.td, 'hidden t-lg:hidden t-xl:table-cell')}>{signedMoney(-(toNumber(h.value) ?? 0), cur)}</td>
              <td className={cn(td, 'text-right', stack.td)}>
                <div className="flex items-center justify-end gap-3">
                  <Chip className="uppercase">sold</Chip>
                  <button type="button" onClick={() => undoSold(h)} className="font-mono text-[10px] uppercase tracking-widest text-ink-muted hover:text-ink hover:underline">
                    undo
                  </button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>

      <div className="flex flex-wrap items-start justify-between gap-6">
        <div className="flex flex-wrap items-center gap-5">
          <Button
            variant="secondary"
            onClick={() => {
              setDirty(true)
              setRows((rs) => [...rs, blankRow()])
            }}
          >
            + Add holding
          </Button>
          <Button variant="secondary" onClick={() => setCsvOpen(true)}>
            Paste CSV
          </Button>
          <Button variant="secondary" onClick={() => setShotsOpen(true)}>
            From screenshots
          </Button>
        </div>
        <dl className="border border-line p-4 grid grid-cols-2 gap-x-8 gap-y-2 font-mono text-xs min-w-[18rem]">
          <dt className="text-[10px] uppercase tracking-widest text-ink-muted">Total</dt>
          <dd className="text-right num font-bold text-ink">{money(total, cur)}</dd>
          <dt className="text-[10px] uppercase tracking-widest text-ink-muted">Change vs base</dt>
          <dd className={cn('text-right num', deltaClass(baseTotal === null ? null : total - baseTotal))}>
            {baseTotal === null ? '—' : `${arrow(total - baseTotal)} ${signedMoney(total - baseTotal, cur)}`}
          </dd>
          <dt className="text-[10px] uppercase tracking-widest text-ink-muted">New · changed · sold</dt>
          <dd className="text-right num text-ink">
            {counts.new} · {counts.changed} · {counts.sold}
          </dd>
        </dl>
      </div>

      <TextArea id="snap-note" label="Note · optional" value={note} onChange={(e) => setNote(e.target.value)} className="max-w-2xl" />
      <FormError message={error} />
      <div className="flex justify-end gap-5 border-t border-line pt-5">
        <Button variant="ghost" onClick={() => navigate(`/portfolios/${p.id}`)}>
          Cancel
        </Button>
        <Button onClick={save} isLoading={createSnapshot.isPending}>
          Save snapshot
        </Button>
      </div>

      <HoldingsCsvModal
        open={csvOpen}
        onOpenChange={setCsvOpen}
        currency={cur}
        onAccept={(holdings) => {
          setDirty(true)
          setError(null)
          setRows(holdings.map(fromImport))
          setSeededFrom((s) => (s === undefined ? null : s)) // a prefill arriving later must not overwrite the import
        }}
      />
      <ScreenshotImportModal
        open={shotsOpen}
        onOpenChange={setShotsOpen}
        portfolioId={p.id}
        currency={cur}
        asOf={asOf}
        initialFiles={handedOver}
        onAccept={(holdings, shotDate) => {
          setDirty(true)
          setError(null)
          if (shotDate) setAsOf(shotDate)
          setRows(holdings.map(fromImport))
          setSeededFrom((s) => (s === undefined ? null : s))
        }}
      />
    </Page>
  )
}
