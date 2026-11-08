import { useMemo, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { cn } from '../lib/cn'
import { deltaClass, money, percent, quantity, signedMoney, signedPercent, toNumber } from '../lib/format'
import type { ConsolidatedHolding } from '../types/api'
import { Swatch } from './charts/kit'
import { ShareBar, Table, showFrom, td, th } from './ui/Primitives'

type Dir = 'asc' | 'desc'

interface Column<T> {
  key: string
  label: string
  title?: string
  numeric?: boolean
  /** Sort value: text sorts A→Z first, numbers high→low first; null always sorts last. */
  sort: (row: T) => string | number | null
  cell: (row: T) => ReactNode
  className?: string
  /** Hide the column until the table is this wide, so it never scrolls sideways. */
  show?: keyof typeof showFrom
}

function sortRows<T>(rows: T[], col: Column<T>, dir: Dir): T[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const x = col.sort(a)
    const y = col.sort(b)
    if (x === null && y === null) return 0
    if (x === null) return 1
    if (y === null) return -1
    if (typeof x === 'string' || typeof y === 'string') return sign * String(x).localeCompare(String(y))
    return sign * (x - y)
  })
}

/** A table whose every column sorts; rows without a figure stay at the bottom either way. */
function SortableTable<T>({ rows, columns, rowKey, initial }: { rows: T[]; columns: Column<T>[]; rowKey: (r: T) => string; initial: { key: string; dir: Dir } }) {
  const [sort, setSort] = useState(initial)
  const col = columns.find((c) => c.key === sort.key) ?? columns[0]
  const sorted = useMemo(() => sortRows(rows, col, sort.dir), [rows, col, sort.dir])
  // A new column starts A→Z for text, high→low for figures.
  const firstDir = (c: Column<T>): Dir => (rows.some((r) => typeof c.sort(r) === 'string') ? 'asc' : 'desc')
  const toggle = (c: Column<T>) =>
    setSort((s) => (s.key === c.key ? { key: c.key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key: c.key, dir: firstDir(c) }))

  return (
    <Table>
      <thead>
        <tr>
          {columns.map((c) => {
            const active = sort.key === c.key
            const Icon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
            return (
              <th key={c.key} className={cn(th, c.numeric && 'text-right', c.className, c.show && showFrom[c.show])} aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
                <button
                  type="button"
                  onClick={() => toggle(c)}
                  title={c.title}
                  className={cn('inline-flex items-center gap-1 uppercase tracking-widest hover:text-ink', active ? 'text-ink' : 'text-ink-muted', c.numeric && 'flex-row-reverse')}
                >
                  {c.label}
                  <Icon className={cn('w-3 h-3', !active && 'opacity-40')} aria-hidden="true" />
                </button>
              </th>
            )
          })}
        </tr>
      </thead>
      <tbody>
        {sorted.map((r) => (
          <tr key={rowKey(r)}>
            {columns.map((c) => (
              <td key={c.key} className={cn(td, c.numeric && 'text-right num', c.show && showFrom[c.show], c.key === columns[0].key && 'whitespace-normal')}>
                {c.cell(r)}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </Table>
  )
}

interface Common {
  holdings: ConsolidatedHolding[]
  currency: string
  classColor: (c: string) => string | null | undefined
  className: (c: string) => string
  fallbackColor: string
}

const n = (v: string | null) => toNumber(v)

function holdingColumn(): Column<ConsolidatedHolding> {
  return {
    key: 'symbol',
    label: 'Holding',
    sort: (h) => h.symbol,
    className: 'min-w-[9rem]',
    cell: (h) => (
      <div className="whitespace-normal">
        <div className="font-medium">{h.symbol}</div>
        {h.name && <div className="text-[10px] text-ink-muted mt-0.5">{h.name}</div>}
      </div>
    ),
  }
}

function classColumn({ classColor, className, fallbackColor }: Common): Column<ConsolidatedHolding> {
  return {
    key: 'asset_class',
    label: 'Class',
    sort: (h) => className(h.asset_class),
    show: 'xl',
    cell: (h) => (
      <span className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-ink-muted">
        <Swatch color={classColor(h.asset_class) ?? fallbackColor} />
        {className(h.asset_class)}
      </span>
    ),
  }
}

const shareCell = (share: string | number | null, title?: string) =>
  share === null ? (
    <span className="text-ink-faint" title={title}>
      —
    </span>
  ) : (
    <div className="flex items-center gap-2">
      <ShareBar share={toNumber(share) ?? 0} className="w-16" />
      <span className="num text-ink-muted">{percent(share)}</span>
    </div>
  )

const heldIn: Column<ConsolidatedHolding> = {
  key: 'portfolios',
  label: 'Held in',
  show: 'xl',
  sort: (h) => h.portfolios.join(', '),
  cell: (h) => <span className="text-ink-muted">{h.portfolios.join(', ')}</span>,
}

/** What was put in: quantity × average buy price, and each holding's share of that. */
export function InvestedTable(props: Common) {
  const { holdings, currency } = props
  const noCost = holdings.filter((h) => h.cost === null).length
  const columns: Column<ConsolidatedHolding>[] = [
    holdingColumn(),
    classColumn(props),
    { key: 'quantity', label: 'Quantity', numeric: true, show: 'lg', sort: (h) => n(h.quantity), cell: (h) => quantity(h.quantity) },
    {
      key: 'avg_buy_price',
      label: 'Avg buy',
      numeric: true,
      show: 'sm',
      title: 'Average buy price per unit, quantity-weighted across portfolios',
      sort: (h) => n(h.avg_buy_price),
      cell: (h) => money(h.avg_buy_price, currency),
    },
    {
      key: 'cost',
      label: 'Invested',
      numeric: true,
      title: 'Quantity × average buy price',
      sort: (h) => n(h.cost),
      cell: (h) => <span className="font-medium">{money(h.cost, currency)}</span>,
    },
    {
      key: 'cost_share',
      label: 'Share of invested',
      show: 'md',
      sort: (h) => n(h.cost_share),
      className: 'w-36',
      cell: (h) => shareCell(h.cost_share, 'No buy price recorded'),
    },
    heldIn,
  ]
  return (
    <div className="flex flex-col gap-2">
      <SortableTable rows={holdings} columns={columns} rowKey={(h) => h.symbol} initial={{ key: 'cost', dir: 'desc' }} />
      {noCost > 0 && (
        <p className="font-mono text-[10px] text-ink-muted">
          {noCost} holding{noCost === 1 ? ' has' : 's have'} no buy price in at least one portfolio, so {noCost === 1 ? 'it is' : 'they are'} left out of
          the invested totals.
        </p>
      )}
    </div>
  )
}

/** What it is worth today, and each holding's share of that. */
export function NowTable(props: Common) {
  const { holdings, currency } = props
  const columns: Column<ConsolidatedHolding>[] = [
    holdingColumn(),
    classColumn(props),
    { key: 'quantity', label: 'Quantity', numeric: true, show: 'lg', sort: (h) => n(h.quantity), cell: (h) => quantity(h.quantity) },
    { key: 'current_price', label: 'Price', numeric: true, show: 'sm', title: 'Current price per unit', sort: (h) => n(h.current_price), cell: (h) => money(h.current_price, currency) },
    { key: 'value', label: 'Value', numeric: true, sort: (h) => n(h.value), cell: (h) => <span className="font-medium">{money(h.value, currency)}</span> },
    { key: 'share', label: 'Share of value', show: 'md', sort: (h) => n(h.share), className: 'w-36', cell: (h) => shareCell(h.share) },
    heldIn,
  ]
  return <SortableTable rows={holdings} columns={columns} rowKey={(h) => h.symbol} initial={{ key: 'value', dir: 'desc' }} />
}

/** A holding that has a buy price, with its value share among those same holdings. */
export interface Outcome {
  holding: ConsolidatedHolding
  cost: number
  value: number
  costShare: number
  valueShare: number
  gain: number
  gainPct: number | null
}

/** Invested vs now for the holdings with a buy price, so both shares are over the same set. */
export function outcomes(holdings: ConsolidatedHolding[]): Outcome[] {
  const costed = holdings.filter((h) => h.cost !== null)
  const totalCost = costed.reduce((s, h) => s + (n(h.cost) ?? 0), 0)
  const totalValue = costed.reduce((s, h) => s + (n(h.value) ?? 0), 0)
  return costed.map((h) => {
    const cost = n(h.cost) ?? 0
    const value = n(h.value) ?? 0
    return {
      holding: h,
      cost,
      value,
      costShare: totalCost > 0 ? cost / totalCost : 0,
      valueShare: totalValue > 0 ? value / totalValue : 0,
      gain: value - cost,
      gainPct: cost > 0 ? (value - cost) / cost : null,
    }
  })
}

/** Winners made money (or broke even), losers lost it; each ranked by the size of the gain or loss. */
export function splitOutcomes(rows: Outcome[]): { winners: Outcome[]; losers: Outcome[] } {
  return {
    winners: rows.filter((o) => o.gain >= 0).sort((a, b) => b.gain - a.gain),
    losers: rows.filter((o) => o.gain < 0).sort((a, b) => a.gain - b.gain),
  }
}

/** Ranked bets: invested, now, gain, and how the holding's weight shifted. */
export function OutcomeTable({ rows, currency, initial = { key: 'gain_pct', dir: 'desc' } }: { rows: Outcome[]; currency: string; initial?: { key: string; dir: Dir } }) {
  const columns: Column<Outcome>[] = [
    {
      key: 'symbol',
      label: 'Holding',
      sort: (o) => o.holding.symbol,
      cell: (o) => <span className="font-medium">{o.holding.symbol}</span>,
    },
    { key: 'cost', label: 'Invested', numeric: true, show: 'md', sort: (o) => o.cost, cell: (o) => money(o.cost, currency) },
    { key: 'value', label: 'Now', numeric: true, show: 'md', sort: (o) => o.value, cell: (o) => money(o.value, currency) },
    { key: 'gain', label: 'Gain', numeric: true, sort: (o) => o.gain, cell: (o) => <span className={deltaClass(o.gain)}>{signedMoney(o.gain, currency)}</span> },
    { key: 'gain_pct', label: 'Gain %', numeric: true, sort: (o) => o.gainPct, cell: (o) => <span className={deltaClass(o.gainPct)}>{signedPercent(o.gainPct)}</span> },
    {
      key: 'shift',
      label: 'Weight',
      numeric: true,
      show: 'lg',
      title: 'Share of invested → share of value today, in percentage points',
      sort: (o) => o.valueShare - o.costShare,
      cell: (o) => {
        const pp = (o.valueShare - o.costShare) * 100
        return (
          <span className="text-ink-muted">
            {percent(o.costShare)} → <span className="text-ink">{percent(o.valueShare)}</span>{' '}
            <span className={deltaClass(pp)}>
              ({pp >= 0 ? '+' : '−'}
              {Math.abs(pp).toFixed(1)} pp)
            </span>
          </span>
        )
      },
    },
  ]
  return <SortableTable rows={rows} columns={columns} rowKey={(o) => o.holding.symbol} initial={initial} />
}

/** Two ranked lists: the bets that paid off, then the ones that lost money. */
export function WinnersLosers({ rows, currency }: { rows: Outcome[]; currency: string }) {
  const { winners, losers } = splitOutcomes(rows)
  const total = (os: Outcome[]) => os.reduce((s, o) => s + o.gain, 0)
  const group = (title: string, os: Outcome[], dir: Dir, empty: string) => (
    <section className="flex flex-col gap-2" aria-label={title}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-mono text-[11px] uppercase tracking-widest text-ink">
          {title} <span className="text-ink-muted">· {os.length}</span>
        </h3>
        {os.length > 0 && (
          <span className={cn('font-mono text-[11px] num', deltaClass(total(os)))}>{signedMoney(total(os), currency)} together</span>
        )}
      </div>
      {os.length ? (
        <OutcomeTable rows={os} currency={currency} initial={{ key: 'gain', dir }} />
      ) : (
        <p className="font-mono text-[11px] text-ink-faint">{empty}</p>
      )}
    </section>
  )
  return (
    <div className="flex flex-col gap-5">
      {group('Top winners', winners, 'desc', 'No holding is up on its buy price.')}
      {group('Top losers', losers, 'asc', 'No holding is below its buy price.')}
    </div>
  )
}
