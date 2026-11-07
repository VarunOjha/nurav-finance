// Mirrors backend/schemas. Money and quantities arrive as decimal strings
// (exact); convert with toNumber() only for display and charts.

export type Decimal = string
export type ISODate = string // YYYY-MM-DD
export type ISODateTime = string

export interface User {
  id: string
  first_name: string
  last_name: string
  date_of_birth: ISODate | null
  gender: Gender | null
  email: string
  phone: string | null
  created_at: ISODateTime
}

export type Gender = 'female' | 'male' | 'non_binary' | 'prefer_not_to_say'

export interface TokenResponse {
  access_token: string
  token_type: string
  user: User
}

export interface Workspace {
  id: string
  name: string
  description: string | null
  is_default: boolean
  created_at: ISODateTime
  account_count: number
  portfolio_count: number
}

export interface Tag {
  id: string
  name: string
  description: string | null
  account_count: number
  portfolio_count: number
}

export interface TagRef {
  id: string
  name: string
}

export type AccountType = 'checking' | 'savings' | 'fixed_deposit' | 'brokerage' | 'investment' | 'retirement' | 'other'

export interface AccountSummary {
  id: string
  name: string
  institution: string | null
  account_type: AccountType
  account_number_masked: string | null
  country: string | null
  city: string | null
  currency: string
  opened_on: ISODate | null
  closed_on: ISODate | null
  status: 'active' | 'closed'
  tags: TagRef[]
  balance: Decimal | null
  balance_as_of: ISODate | null
  previous_balance: Decimal | null
  delta: Decimal | null
  updated_at: ISODateTime
}

export interface Identifier {
  id: string
  label: string
  value: string
}

export interface Link {
  id: string
  label: string
  url: string
}

export interface AccountDetail extends AccountSummary {
  holder_name: string | null
  notes: string | null
  has_account_number: boolean
  identifiers: Identifier[]
  links: Link[]
  portfolios: { id: string; name: string }[]
  created_at: ISODateTime
}

export interface AccountInput {
  name: string
  institution: string | null
  account_type: AccountType
  holder_name: string | null
  opened_on: ISODate | null
  closed_on: ISODate | null
  country: string | null
  city: string | null
  currency: string
  notes: string | null
  account_number?: string | null
  identifiers: { label: string; value: string }[]
  links: { label: string; url: string }[]
  tag_ids: string[]
  opening_balance?: { amount: string; as_of: ISODate; note?: string | null } | null
}

export interface BalanceEntry {
  id: string
  as_of: ISODate
  amount: Decimal
  note: string | null
  recorded_at: ISODateTime
  effective: boolean
  change: Decimal | null
}

export interface BalanceHistory {
  entries: BalanceEntry[]
  monthly: { month: string; balance: Decimal | null }[]
}

export type AssetClass = 'stock' | 'etf' | 'mutual_fund' | 'bond' | 'cash' | 'crypto' | 'other'

export interface PortfolioSummary {
  id: string
  name: string
  provider: string | null
  currency: string
  account: { id: string; name: string } | null
  opened_on: ISODate | null
  closed_on: ISODate | null
  status: 'active' | 'closed'
  notes: string | null
  tags: TagRef[]
  value: Decimal | null
  value_as_of: ISODate | null
  previous_value: Decimal | null
  delta: Decimal | null
  holdings_count: number
  snapshot_count: number
}

export interface PortfolioInput {
  name: string
  provider: string | null
  currency: string
  account_id: string
  opened_on: ISODate | null
  closed_on: ISODate | null
  notes: string | null
  tag_ids: string[]
}

export interface Holding {
  symbol: string
  name: string | null
  asset_class: AssetClass
  quantity: Decimal
  buy_price: Decimal | null
  current_price: Decimal
  value: Decimal
  cost: Decimal | null
  gain: Decimal | null
}

export interface HoldingInput {
  symbol: string
  name: string | null
  asset_class: AssetClass
  quantity: string
  buy_price: string | null
  current_price: string
}

export interface SnapshotSummary {
  id: string
  as_of: ISODate
  note: string | null
  recorded_at: ISODateTime
  total: Decimal
  holdings_count: number
  cost: Decimal | null // Σ quantity × buy price over holdings that have one
  cost_holdings: number
}

export interface HoldingDiff {
  symbol: string
  name: string | null
  asset_class: AssetClass
  status: 'new' | 'sold' | 'changed' | 'unchanged'
  quantity: Decimal | null
  previous_quantity: Decimal | null
  quantity_change: Decimal | null
  buy_price: Decimal | null
  current_price: Decimal | null
  value: Decimal
  cost: Decimal | null
  gain: Decimal | null
  previous_value: Decimal
  value_change: Decimal
  weight: Decimal
}

export interface AllocationSlice {
  label: string
  value: Decimal
  share: Decimal
}

export interface SnapshotComparison {
  current: SnapshotSummary
  previous: SnapshotSummary | null
  change: Decimal | null
  change_pct: Decimal | null
  holdings: HoldingDiff[]
  allocation: AllocationSlice[]
}

export interface SnapshotPrefill {
  based_on: SnapshotSummary | null
  holdings: Holding[]
}

export interface ConsolidatedHolding {
  symbol: string
  name: string | null
  asset_class: AssetClass
  quantity: Decimal
  value: Decimal
  share: Decimal
  current_price: Decimal
  cost: Decimal | null
  avg_buy_price: Decimal | null
  cost_share: Decimal | null
  gain: Decimal | null
  gain_pct: Decimal | null
  portfolios: string[]
}

export interface CurrencyConsolidation {
  currency: string
  total: Decimal
  previous_total: Decimal | null
  by_portfolio: AllocationSlice[]
  by_asset_class: AllocationSlice[]
  holdings: ConsolidatedHolding[]
  months: string[] // YYYY-MM, last 12; current month as of today
  history: { portfolio: string; values: Series }[] // sorted by name
}

export type Series = (Decimal | null)[]

export interface CurrencySeries {
  currency: string
  accounts: Series
  portfolios: Series
  total: Series
  current_total: Decimal | null
  current_accounts: Decimal | null
  current_portfolios: Decimal | null
  last_month_total: Decimal | null
  year_ago_total: Decimal | null
  account_count: number
  portfolio_count: number
}

export interface CurrencyAllocation {
  currency: string
  slices: AllocationSlice[]
}

export type AnalyticsRange = '6m' | '1y' | '3y' | 'all'

export interface TopAsset {
  kind: 'account' | 'holding'
  name: string
  symbol: string | null
  /** Account type, or the holding's asset class. */
  group: string
  /** Portfolios holding this symbol; empty for accounts. */
  held_in: string[]
  value: Decimal
}

export interface CurrencyTopAssets {
  currency: string
  /** Every positive asset held today, largest first. */
  assets: TopAsset[]
}

export interface Overview {
  months: string[]
  currencies: CurrencySeries[]
  tags: { tag: string; currencies: { currency: string; values: Series }[] }[]
  allocation: {
    by_type: CurrencyAllocation[]
    by_asset_class: CurrencyAllocation[]
    by_tag: CurrencyAllocation[]
  }
  top_assets: CurrencyTopAssets[]
  timeline: {
    date: ISODate
    kind: 'account_opened' | 'account_closed' | 'portfolio_opened' | 'portfolio_closed'
    name: string
    currency: string
  }[]
}

// ── Screenshot import (backend/routers/screenshot_import.py, services/screenshot) ─

export type ScreenshotField = 'quantity' | 'buy_price' | 'current_price' | 'value' | 'invested'

export interface ScreenshotIssue {
  /** error: can't be saved as is · warn: numbers disagree or look off · info: worth knowing */
  level: 'error' | 'warn' | 'info'
  field: ScreenshotField | 'symbol' | null
  message: string
}

export interface ScreenshotRow {
  id: string
  symbol: string
  /** previous: matched to the last snapshot · shown: ticker printed · proposed: made up from the name */
  symbol_basis: 'previous' | 'shown' | 'proposed'
  name: string | null
  asset_class: AssetClass
  quantity: string | null
  buy_price: string | null
  current_price: string | null
  value: string | null
  /** The text as printed in the screenshot, per field. */
  printed: Record<ScreenshotField, string | null>
  /** Fields worked out by the app (e.g. price = value ÷ quantity). */
  derived: ScreenshotField[]
  /** Fields the re-read step corrected; "added" = a row it found that was missed. */
  rechecked: (ScreenshotField | 'added')[]
  issues: ScreenshotIssue[]
}

export interface ScreenshotCheck {
  kind: 'total' | 'invested' | 'currency' | 'missing' | 'empty'
  status: 'ok' | 'warn' | 'error' | 'info'
  message: string
}

export interface ScreenshotResult {
  rows: ScreenshotRow[]
  checks: ScreenshotCheck[]
  currency_seen: string | null
  as_of_seen: ISODate | null
  notes: string[]
  recheck: string | null
  screenshots: number
  model: string
  cost_usd: number
}

export type ScreenshotEvent =
  | { type: 'stage'; stage: 'reading' | 'read' | 'organising' | 'checking' | 'rechecking'; text: string }
  | { type: 'result'; result: ScreenshotResult }
  | { type: 'error'; message: string }
