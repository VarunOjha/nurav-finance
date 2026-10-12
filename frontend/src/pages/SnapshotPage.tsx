import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { X } from 'lucide-react'
import { apiErrorMessage } from '../api/client'
import { Button } from '../components/ui/Button'
import { FormError, Input, TextArea } from '../components/ui/Field'
import { Chip, ErrorBox, Loading, Page, PageHeader, Table, td, th } from '../components/ui/Primitives'
import { usePortfolio, usePortfolioMutations, useSnapshotPrefill } from '../hooks/queries'
import { cn } from '../lib/cn'
import { ASSET_CLASS_LABELS, arrow, deltaClass, formatDate, money, quantity, signedMoney, todayISO, toNumber } from '../lib/format'
import type { AssetClass, Holding, HoldingInput } from '../types/api'

interface Row {
  key: number
  symbol: string
  name: string
  asset_class: AssetClass
  quantity: string
  price: string
}

const cellInput =
  'w-full bg-transparent border-0 border-b border-line focus:border-ink focus:outline-none font-mono text-xs text-ink py-1.5 placeholder:text-ink-faint'

let nextKey = 1
const blankRow = (): Row => ({ key: nextKey++, symbol: '', name: '', asset_class: 'stock', quantity: '', price: '' })
const fromHolding = (h: Holding): Row => ({
  key: nextKey++,
  symbol: h.symbol,
  name: h.name ?? '',
  asset_class: h.asset_class,
  quantity: String(toNumber(h.quantity) ?? ''),
  price: String(toNumber(h.price) ?? ''),
})

const num = (s: string): number | null => {
  if (!s.trim()) return null
  const n = Number(s.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

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
    const p = num(r.price)
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
        <ErrorBox message={apiErrorMessage(portfolio.error, 'Portfolio not found in this tenant')} />
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
    const filled = rows.filter((r) => r.symbol.trim() || r.quantity.trim() || r.price.trim())
    if (filled.length === 0) return setError('Add at least one holding')
    const holdings: HoldingInput[] = []
    const seen = new Set<string>()
    for (const r of filled) {
      const sym = r.symbol.trim().toUpperCase()
      if (!sym) return setError('Every holding needs a symbol')
      if (seen.has(sym)) return setError(`${sym} appears twice — each symbol once per snapshot`)
      seen.add(sym)
      const q = num(r.quantity)
      const pr = num(r.price)
      if (q === null || q <= 0) return setError(`${sym}: quantity must be a number greater than 0`)
      if (pr === null || pr < 0) return setError(`${sym}: price must be a number (0 or more)`)
      holdings.push({ symbol: sym, name: r.name.trim() || null, asset_class: r.asset_class, quantity: r.quantity.replace(/,/g, '').trim(), price: r.price.replace(/,/g, '').trim() })
    }
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
        back={
          <Link to={`/portfolios/${p.id}`} className="font-mono text-xs uppercase tracking-widest text-ink-muted hover:text-ink hover:underline">
            ← {p.name}
          </Link>
        }
        title={`Record snapshot · ${p.name}`}
        subtitle="Snapshots are immutable — to fix one, delete it and record it again. Backdated snapshots slot in by date."
      />

      <div className="flex flex-wrap items-end gap-6">
        <Input id="snap-asof" label="As of" type="date" max={today} value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-48" />
        <div className="font-mono text-[11px] text-ink-muted pb-2 flex flex-wrap items-center gap-3">
          {prefill.isLoading ? (
            'Looking for the previous snapshot…'
          ) : base?.based_on ? (
            <span>
              Starting from the <span className="text-ink">{formatDate(base.based_on.as_of)}</span> snapshot — edit quantities and prices
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

      <Table>
        <thead>
          <tr>
            <th className={th}>Symbol</th>
            <th className={th}>Name</th>
            <th className={th}>Class</th>
            <th className={cn(th, 'text-right')}>Quantity</th>
            <th className={cn(th, 'text-right')}>Price · {cur}</th>
            <th className={cn(th, 'text-right')}>Value</th>
            <th className={cn(th, 'text-right')}>Δ vs base</th>
            <th className={th}>
              <span className="sr-only">Status and actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {computed.map(({ row: r, value, delta, status }) => (
            <tr key={r.key}>
              <td className={cn(td, 'min-w-[6rem]')}>
                <input
                  aria-label="Symbol"
                  className={cn(cellInput, 'uppercase font-medium')}
                  value={r.symbol}
                  onChange={(e) => edit(r.key, { symbol: e.target.value.toUpperCase() })}
                  placeholder="AAPL"
                />
              </td>
              <td className={cn(td, 'min-w-[10rem]')}>
                <input aria-label="Name" className={cellInput} value={r.name} onChange={(e) => edit(r.key, { name: e.target.value })} placeholder="Apple Inc." />
              </td>
              <td className={cn(td, 'min-w-[7rem]')}>
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
              <td className={cn(td, 'min-w-[6rem]')}>
                <input aria-label="Quantity" inputMode="decimal" className={cn(cellInput, 'text-right num')} value={r.quantity} onChange={(e) => edit(r.key, { quantity: e.target.value })} placeholder="0" />
              </td>
              <td className={cn(td, 'min-w-[6rem]')}>
                <input aria-label="Price" inputMode="decimal" className={cn(cellInput, 'text-right num')} value={r.price} onChange={(e) => edit(r.key, { price: e.target.value })} placeholder="0.00" />
              </td>
              <td className={cn(td, 'text-right num font-medium')}>{value === null ? '—' : money(value, cur)}</td>
              <td className={cn(td, 'text-right num', deltaClass(delta))}>{delta === null || !base?.based_on ? '—' : signedMoney(delta, cur)}</td>
              <td className={cn(td, 'text-right py-0')}>
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
            <tr key={`sold-${h.symbol}`} className="text-ink-muted">
              <td className={td}>
                <span className="line-through">{h.symbol}</span>
              </td>
              <td className={cn(td, 'text-ink-muted')}>{h.name ?? '—'}</td>
              <td className={cn(td, 'text-[10px] uppercase tracking-widest text-ink-muted')}>{ASSET_CLASS_LABELS[h.asset_class] ?? h.asset_class}</td>
              <td className={cn(td, 'text-right num text-ink-muted')}>{quantity(h.quantity)}</td>
              <td className={cn(td, 'text-right num text-ink-muted')}>{money(h.price, cur)}</td>
              <td className={cn(td, 'text-right num text-ink-muted')}>{money(0, cur)}</td>
              <td className={cn(td, 'text-right num text-error')}>{signedMoney(-(toNumber(h.value) ?? 0), cur)}</td>
              <td className={cn(td, 'text-right')}>
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
        <Button
          variant="secondary"
          onClick={() => {
            setDirty(true)
            setRows((rs) => [...rs, blankRow()])
          }}
        >
          + Add holding
        </Button>
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
    </Page>
  )
}
