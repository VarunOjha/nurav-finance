// Editable holdings rows, shared by the Record snapshot page and the Add portfolio
// modal's Manual entry tab. Rows hold the plain strings typed; `rowsToHoldings`
// checks them and builds the API payload.
import { parseAmount } from './amount'
import type { AssetClass, HoldingInput } from '../types/api'

export interface HoldingRow {
  key: number
  symbol: string
  name: string
  asset_class: AssetClass
  quantity: string
  buy_price: string
  current_price: string
}

let nextKey = 1
export const newRowKey = () => nextKey++
export const blankRow = (): HoldingRow => ({ key: nextKey++, symbol: '', name: '', asset_class: 'stock', quantity: '', buy_price: '', current_price: '' })

export const num = (s: string): number | null => {
  if (!s.trim()) return null
  const n = Number(s.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

export const isBlank = (r: HoldingRow) => !(r.symbol.trim() || r.quantity.trim() || r.buy_price.trim() || r.current_price.trim())

/** Value of a row (quantity × current price), or null while either is missing. */
export function rowValue(r: HoldingRow): number | null {
  const q = num(r.quantity)
  const p = num(r.current_price)
  return q !== null && p !== null ? q * p : null
}

/** Check the filled rows and build the payload; blank rows are skipped. */
export function rowsToHoldings(rows: HoldingRow[]): { holdings: HoldingInput[] } | { error: string } {
  const filled = rows.filter((r) => !isBlank(r))
  if (filled.length === 0) return { error: 'Add at least one holding' }
  const holdings: HoldingInput[] = []
  const seen = new Set<string>()
  for (const r of filled) {
    const sym = r.symbol.trim().toUpperCase()
    if (!sym) return { error: 'Every holding needs a symbol' }
    if (seen.has(sym)) return { error: `${sym} appears twice — each symbol once per snapshot` }
    seen.add(sym)
    const q = num(r.quantity)
    const buy = num(r.buy_price)
    const pr = num(r.current_price)
    if (q === null || q <= 0) return { error: `${sym}: quantity must be a number greater than 0` }
    if (r.buy_price.trim() && (buy === null || buy < 0)) return { error: `${sym}: buy price must be a number (0 or more), or left blank` }
    if (pr === null || pr < 0) return { error: `${sym}: current price must be a number (0 or more)` }
    holdings.push({
      symbol: sym,
      name: r.name.trim() || null,
      asset_class: r.asset_class,
      quantity: parseAmount(r.quantity),
      buy_price: parseAmount(r.buy_price) || null,
      current_price: parseAmount(r.current_price),
    })
  }
  return { holdings }
}
