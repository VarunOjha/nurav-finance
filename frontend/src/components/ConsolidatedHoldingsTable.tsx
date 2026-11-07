import { useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import { cn } from '../lib/cn'
import { deltaClass, money, percent, quantity, signedMoney, signedPercent, toNumber } from '../lib/format'
import type { ConsolidatedHolding } from '../types/api'
import { Swatch } from './charts/kit'
import { ShareBar, Table, td, th } from './ui/Primitives'

type Key = 'symbol' | 'asset_class' | 'quantity' | 'avg_buy_price' | 'current_price' | 'cost' | 'cost_share' | 'value' | 'share' | 'gain' | 'gain_pct'
type Dir = 'asc' | 'desc'

interface Column {
  key: Key
  label: string
  title?: string
  numeric?: boolean
}

const COLUMNS: Column[] = [
  { key: 'symbol', label: 'Holding' },
  { key: 'asset_class', label: 'Class' },
  { key: 'quantity', label: 'Quantity', numeric: true },
  { key: 'avg_buy_price', label: 'Avg buy', numeric: true, title: 'Average buy price per unit, quantity-weighted across portfolios' },
  { key: 'current_price', label: 'Price', numeric: true, title: 'Current price per unit' },
  { key: 'cost', label: 'Cost', numeric: true, title: 'Quantity × average buy price' },
  { key: 'cost_share', label: 'Starting stake', title: 'Share of the total cost — what you put in, by avg buy price' },
  { key: 'value', label: 'Value', numeric: true },
  { key: 'share', label: 'Current share', title: 'Share of the total value today' },
  { key: 'gain', label: 'Gain', numeric: true },
  { key: 'gain_pct', label: 'Gain %', numeric: true },
]

const TEXT_KEYS: ReadonlySet<Key> = new Set(['symbol', 'asset_class'])

/** Sort, keeping holdings without a figure (no buy price) at the bottom either way. */
function sortHoldings(rows: ConsolidatedHolding[], key: Key, dir: Dir): ConsolidatedHolding[] {
  const sign = dir === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    if (TEXT_KEYS.has(key)) return sign * String(a[key]).localeCompare(String(b[key]))
    const x = toNumber(a[key] as string | null)
    const y = toNumber(b[key] as string | null)
    if (x === null && y === null) return 0
    if (x === null) return 1
    if (y === null) return -1
    return sign * (x - y)
  })
}

interface Props {
  holdings: ConsolidatedHolding[]
  currency: string
  classColor: (c: string) => string | null | undefined
  className: (c: string) => string
  fallbackColor: string
}

// Merged holdings for one currency. Starting stake (share of cost, from the average
// buy price) sits beside the current share (share of value); every column sorts.
export function ConsolidatedHoldingsTable({ holdings, currency, classColor, className, fallbackColor }: Props) {
  const [sort, setSort] = useState<{ key: Key; dir: Dir }>({ key: 'value', dir: 'desc' })
  const rows = useMemo(() => sortHoldings(holdings, sort.key, sort.dir), [holdings, sort])
  const noCost = holdings.filter((h) => h.cost === null).length

  const toggle = (key: Key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: TEXT_KEYS.has(key) ? 'asc' : 'desc' }))

  return (
    <div className="flex flex-col gap-2">
      <Table>
        <thead>
          <tr>
            {COLUMNS.map((c) => {
              const active = sort.key === c.key
              const Icon = active ? (sort.dir === 'asc' ? ArrowUp : ArrowDown) : ArrowUpDown
              return (
                <th
                  key={c.key}
                  className={cn(th, c.numeric && 'text-right', (c.key === 'cost_share' || c.key === 'share') && 'w-36')}
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                >
                  <button
                    type="button"
                    onClick={() => toggle(c.key)}
                    title={c.title}
                    className={cn(
                      'inline-flex items-center gap-1 uppercase tracking-widest hover:text-ink',
                      active ? 'text-ink' : 'text-ink-muted',
                      c.numeric && 'flex-row-reverse',
                    )}
                  >
                    {c.label}
                    <Icon className={cn('w-3 h-3', !active && 'opacity-40')} aria-hidden="true" />
                  </button>
                </th>
              )
            })}
            <th className={th}>Held in</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((h) => (
            <tr key={h.symbol}>
              <td className={cn(td, 'whitespace-normal min-w-[9rem]')}>
                <div className="font-medium">{h.symbol}</div>
                {h.name && <div className="text-[10px] text-ink-muted mt-0.5">{h.name}</div>}
              </td>
              <td className={cn(td, 'text-[10px] uppercase tracking-widest text-ink-muted')}>
                <span className="inline-flex items-center gap-1.5">
                  <Swatch color={classColor(h.asset_class) ?? fallbackColor} />
                  {className(h.asset_class)}
                </span>
              </td>
              <td className={cn(td, 'text-right num')}>{quantity(h.quantity)}</td>
              <td className={cn(td, 'text-right num')}>{money(h.avg_buy_price, currency)}</td>
              <td className={cn(td, 'text-right num')}>{money(h.current_price, currency)}</td>
              <td className={cn(td, 'text-right num')}>{money(h.cost, currency)}</td>
              <td className={td}>
                {h.cost_share === null ? (
                  <span className="text-ink-faint" title="No buy price recorded">
                    —
                  </span>
                ) : (
                  <div className="flex items-center gap-2">
                    <ShareBar share={toNumber(h.cost_share) ?? 0} className="w-16" />
                    <span className="num text-ink-muted">{percent(h.cost_share)}</span>
                  </div>
                )}
              </td>
              <td className={cn(td, 'text-right num font-medium')}>{money(h.value, currency)}</td>
              <td className={td}>
                <div className="flex items-center gap-2">
                  <ShareBar share={toNumber(h.share) ?? 0} className="w-16" />
                  <span className="num text-ink-muted">{percent(h.share)}</span>
                </div>
              </td>
              <td className={cn(td, 'text-right num', deltaClass(h.gain))}>{signedMoney(h.gain, currency)}</td>
              <td className={cn(td, 'text-right num', deltaClass(h.gain_pct))}>{signedPercent(h.gain_pct)}</td>
              <td className={cn(td, 'text-ink-muted')}>{h.portfolios.join(', ')}</td>
            </tr>
          ))}
        </tbody>
      </Table>
      <p className="font-mono text-[10px] text-ink-muted">
        Starting stake = each holding&apos;s share of the total cost (quantity × average buy price); current share = its share of today&apos;s value.
        {noCost > 0 &&
          ` ${noCost} holding${noCost === 1 ? ' has' : 's have'} no buy price in some portfolio, so ${noCost === 1 ? 'it is' : 'they are'} left out of the starting stake.`}
      </p>
    </div>
  )
}
