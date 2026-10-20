import type { AssetClass } from '../types/api'

// Holdings CSV: one snapshot's holdings, one row per symbol. The snapshot date
// comes from the page, not the file. Mirrors the backend's HoldingIn limits so
// a file that validates here also saves.

export const HOLDINGS_CSV_COLUMNS = ['symbol', 'name', 'asset_class', 'quantity', 'buy_price', 'current_price'] as const
type Column = (typeof HOLDINGS_CSV_COLUMNS)[number]
const REQUIRED: Column[] = ['symbol', 'quantity', 'current_price']

export const ASSET_CLASSES: AssetClass[] = ['stock', 'etf', 'mutual_fund', 'bond', 'cash', 'crypto', 'other']

export const HOLDINGS_CSV_TEMPLATE = `symbol,name,asset_class,quantity,buy_price,current_price
AAPL,Apple Inc.,stock,10,150.25,227.52
VTI,Vanguard Total Stock Market ETF,etf,25.5,240.00,281.10
VTSAX,"Vanguard Total Stock Market Index Fund, Admiral",mutual_fund,"1,204.337",118.40,142.05
BTC,Bitcoin,crypto,0.0425,,61250
CASH,Settlement cash,cash,1500,1,1
`

// Common spreadsheet headings, mapped onto the canonical columns.
const ALIASES: Record<string, Column> = {
  ticker: 'symbol',
  description: 'name',
  class: 'asset_class',
  type: 'asset_class',
  asset_type: 'asset_class',
  qty: 'quantity',
  shares: 'quantity',
  units: 'quantity',
  buy: 'buy_price',
  purchase_price: 'buy_price',
  avg_cost: 'buy_price',
  average_cost: 'buy_price',
  price: 'current_price',
  last_price: 'current_price',
  market_price: 'current_price',
}

export interface CsvHolding {
  line: number
  symbol: string
  name: string | null
  asset_class: AssetClass
  quantity: string
  buy_price: string | null
  current_price: string
}

export interface CsvIssue {
  line: number | null // null = whole file
  message: string
}

export interface CsvResult {
  holdings: CsvHolding[]
  errors: CsvIssue[]
}

const key = (s: string) => s.trim().toLowerCase().replace(/[\s-]+/g, '_')

/** RFC 4180 records with their starting line number; blank and `#` lines are skipped. */
function records(text: string, delimiter: string): { line: number; cells: string[] }[] {
  const out: { line: number; cells: string[] }[] = []
  let cells: string[] = []
  let cell = ''
  let quoted = false
  let line = 1
  let start = 1
  const push = () => {
    cells.push(cell)
    const blank = cells.length === 1 && !cells[0].trim()
    if (!blank && !cells[0].trimStart().startsWith('#')) out.push({ line: start, cells })
    cells = []
    cell = ''
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"'
        i++
      } else if (ch === '"') quoted = false
      else {
        if (ch === '\n') line++
        cell += ch
      }
    } else if (ch === '"' && !cell.trim()) {
      cell = ''
      quoted = true
    } else if (ch === delimiter) {
      cells.push(cell)
      cell = ''
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      push()
      line++
      start = line
    } else cell += ch
  }
  if (cell || cells.length) push()
  return out
}

function decimal(
  raw: string,
  label: string,
  opts: { min: 'positive' | 'zero'; places: number; digits: number; optional?: boolean },
): string | null | { error: string } {
  const s = raw.trim().replace(/,/g, '')
  if (!s) return opts.optional ? null : { error: `${label} is required` }
  if (!/^\d+(\.\d+)?$/.test(s)) return { error: `${label} "${raw.trim()}" isn't a plain number (no currency symbols or signs)` }
  const [whole, frac = ''] = s.split('.')
  if (frac.length > opts.places) return { error: `${label} allows at most ${opts.places} decimal places` }
  if (whole.replace(/^0+(?=\d)/, '').length > opts.digits - opts.places) return { error: `${label} is too large` }
  const n = Number(s)
  if (opts.min === 'positive' && n <= 0) return { error: `${label} must be greater than 0` }
  return s
}

function assetClass(raw: string): AssetClass | null {
  const k = key(raw)
  if (!k) return 'stock'
  return (ASSET_CLASSES as string[]).includes(k) ? (k as AssetClass) : null
}

export function parseHoldingsCsv(input: string): CsvResult {
  const text = input.replace(/^﻿/, '')
  const firstLine = text.split(/\r?\n/).find((l) => l.trim() && !l.trimStart().startsWith('#')) ?? ''
  // Pasting straight from a spreadsheet gives tab-separated text.
  const rows = records(text, firstLine.includes('\t') ? '\t' : ',')
  const errors: CsvIssue[] = []
  if (rows.length === 0) return { holdings: [], errors: [{ line: null, message: 'Paste a header row and at least one holding' }] }

  const [header, ...body] = rows
  const index = new Map<Column, number>()
  header.cells.forEach((raw, i) => {
    const k = key(raw)
    if (!k) return
    const col = (HOLDINGS_CSV_COLUMNS as readonly string[]).includes(k) ? (k as Column) : ALIASES[k]
    if (!col) errors.push({ line: header.line, message: `Unknown column "${raw.trim()}" — use ${HOLDINGS_CSV_COLUMNS.join(', ')}` })
    else if (index.has(col)) errors.push({ line: header.line, message: `Column "${col}" appears twice` })
    else index.set(col, i)
  })
  const missing = REQUIRED.filter((c) => !index.has(c))
  if (missing.length) errors.push({ line: header.line, message: `Missing required column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}` })
  if (errors.length) return { holdings: [], errors }
  if (body.length === 0) return { holdings: [], errors: [{ line: null, message: 'No holdings below the header row' }] }

  const holdings: CsvHolding[] = []
  const seen = new Map<string, number>()
  for (const { line, cells } of body) {
    const get = (c: Column) => (index.has(c) ? cells[index.get(c)!] ?? '' : '')
    const fail = (message: string) => errors.push({ line, message })
    if (cells.length > header.cells.length) {
      fail(`${cells.length} values but the header has ${header.cells.length} columns — quote values that contain commas`)
      continue
    }
    const symbol = get('symbol').trim().toUpperCase()
    const name = get('name').trim()
    const cls = assetClass(get('asset_class'))
    const qty = decimal(get('quantity'), 'Quantity', { min: 'positive', places: 8, digits: 24 })
    const buy = decimal(get('buy_price'), 'Buy price', { min: 'zero', places: 6, digits: 20, optional: true })
    const price = decimal(get('current_price'), 'Current price', { min: 'zero', places: 6, digits: 20 })
    const before = errors.length
    if (!symbol) fail('Symbol is required')
    else if (symbol.length > 24) fail(`Symbol "${symbol}" is longer than 24 characters`)
    else if (seen.has(symbol)) fail(`${symbol} already appears on line ${seen.get(symbol)} — each symbol once per snapshot`)
    if (name.length > 160) fail('Name is longer than 160 characters')
    if (!cls) fail(`Asset class "${get('asset_class').trim()}" — use one of ${ASSET_CLASSES.join(', ')}`)
    if (qty !== null && typeof qty !== 'string') fail(qty.error)
    if (buy !== null && typeof buy !== 'string') fail(buy.error)
    if (price !== null && typeof price !== 'string') fail(price.error)
    if (symbol && !seen.has(symbol)) seen.set(symbol, line)
    if (errors.length === before)
      holdings.push({
        line,
        symbol,
        name: name || null,
        asset_class: cls as AssetClass,
        quantity: qty as string,
        buy_price: buy as string | null,
        current_price: price as string,
      })
  }
  return { holdings, errors }
}
