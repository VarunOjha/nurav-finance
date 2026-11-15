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

// ── Buckets (backend/schemas/buckets.py) ─────────────────────────────────────
// Definitions belong to the user (shared by all workspaces); splits and
// targets are per workspace.

export interface Bucket {
  id: string
  name: string
  description: string | null
  /** Chart palette slot 0-7. */
  color: number
  position: number
  archived: boolean
  created_at: ISODateTime
  /** Accounts (any workspace) whose split in force today uses this bucket. */
  current_accounts: { id: string; name: string; workspace_id: string; workspace_name: string }[]
  /** Has history (splits or milestones): can only be archived, not deleted. */
  used: boolean
  /** Live milestones with a target for this bucket. */
  milestone_count: number
}

export interface BucketShare {
  bucket_id: string
  name: string
  color: number
  percent: Decimal
}

export interface SplitLine {
  bucket_id: string
  name: string
  color: number
  archived: boolean
  percent: Decimal
  /** Today's money in this bucket (current split only). */
  value: Decimal | null
}

export interface Split {
  id: string
  /** null = the first split. */
  effective_from: ISODate | null
  /** The earliest split: it applies to every day before the next one. */
  covers_history: boolean
  /** Last day in force; null = still in force. */
  until: ISODate | null
  note: string | null
  recorded_at: ISODateTime
  lines: SplitLine[]
}

export interface AccountSplits {
  account_id: string
  currency: string
  /** What the split shares out today (balance, or its open portfolios' value). */
  value: Decimal | null
  current: Split | null
  history: Split[]
}

export interface SplitInput {
  effective_from: ISODate | null
  note?: string | null
  lines: { bucket_id: string; percent: string }[]
}

export interface MilestoneLine {
  id: string
  bucket_id: string
  bucket_name: string
  color: number
  /** Archived buckets stay in milestones they were in, but leave the numbers. */
  archived: boolean
  currency: string
  /** The balance to reach. */
  amount: Decimal
  /** Expected annual return in percent. */
  expected_return: Decimal | null
}

/** A named checkpoint ("2030"): one date, several bucket targets. */
export interface Milestone {
  id: string
  name: string
  target_date: ISODate
  /** Measure from: every bucket's needed path starts from its value on this day. */
  start_date: ISODate
  note: string | null
  created_at: ISODateTime
  lines: MilestoneLine[]
}

export interface MilestoneLineInput {
  bucket_id: string
  currency: string
  amount: string
  expected_return: string | null
}

export interface MilestoneInput {
  name: string
  target_date: ISODate
  start_date: ISODate | null
  note: string | null
  lines: MilestoneLineInput[]
}

export type RowStatus = 'achieved' | 'missed' | 'open'
export type Standing = 'ahead' | 'on_track' | 'behind'

export interface Trajectory {
  months: string[]
  actual: (Decimal | null)[]
  required: (Decimal | null)[]
  projection_pace: (Decimal | null)[]
  projection_return: (Decimal | null)[]
}

export interface BucketRef {
  id: string
  name: string
  color: number
}

/** One bucket target of one milestone, measured. */
export interface TargetRow {
  id: string
  milestone_id: string
  milestone_name: string
  target_date: ISODate
  start_date: ISODate
  bucket: BucketRef
  currency: string
  amount: Decimal
  expected_return: Decimal | null
  status: RowStatus
  current: Decimal
  progress_pct: Decimal
  gap: Decimal
  months_left: Decimal | null
  need_flat: Decimal | null
  need_with_return: Decimal | null
  required_now: Decimal | null
  standing: Standing | null
  projected_pace_date: ISODate | null
  projected_return_date: ISODate | null
  value_on_date: Decimal | null
  pace_3m: Decimal | null
  pace_6m: Decimal | null
  pace_12m: Decimal | null
  trajectory: Trajectory
}

export interface CurrencyTotal {
  currency: string
  current: Decimal
  amount: Decimal
  progress_pct: Decimal
  /** Per month over open rows: with expected return where set, else flat. */
  need: Decimal | null
  need_flat: Decimal | null
}

export interface MilestoneView {
  id: string
  name: string
  target_date: ISODate
  start_date: ISODate
  note: string | null
  past: boolean
  months_left: Decimal | null
  totals: CurrencyTotal[]
  rows: TargetRow[]
}

export interface BucketMark {
  row_id: string
  milestone_id: string
  name: string
  target_date: ISODate
  amount: Decimal
  status: RowStatus
}

/** One bucket + currency across every milestone it appears in. */
export interface BucketView {
  bucket: BucketRef
  currency: string
  current: Decimal
  pace_3m: Decimal | null
  pace_6m: Decimal | null
  pace_12m: Decimal | null
  next_row_id: string | null
  marks: BucketMark[]
  trajectory: Trajectory
}

export interface Metrics {
  /** Upcoming by date, then past (latest first). */
  milestones: MilestoneView[]
  buckets: BucketView[]
}

export type AccountType = 'checking' | 'savings' | 'fixed_deposit' | 'brokerage' | 'investment' | 'retirement' | 'asset' | 'other'

export interface AccountSummary {
  id: string
  name: string
  institution: string | null
  account_type: AccountType
  country: string | null
  currency: string
  closed_on: ISODate | null
  status: 'active' | 'closed'
  /** Split in force today; [] = Unassigned. */
  buckets: BucketShare[]
  balance: Decimal | null
  balance_as_of: ISODate | null
  previous_balance: Decimal | null
  delta: Decimal | null
  updated_at: ISODateTime
}

export interface Link {
  id: string
  label: string
  url: string
}

export interface AccountDetail extends AccountSummary {
  links: Link[]
  portfolios: { id: string; name: string }[]
  created_at: ISODateTime
}

export interface AccountInput {
  name: string
  institution: string | null
  account_type: AccountType
  /** A date closes the account (it counts up to that day); null reopens it. */
  closed_on?: ISODate | null
  country: string | null
  currency: string
  links: { label: string; url: string }[]
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
  closed_on: ISODate | null
  status: 'active' | 'closed'
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
  closed_on?: ISODate | null
  /** The first holdings: a portfolio is only created together with them. */
  snapshot?: { as_of: ISODate; note?: string | null; holdings: HoldingInput[] }
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
  // Cost side, over the holdings that have a buy price in every portfolio.
  cost_by_portfolio: AllocationSlice[]
  cost_by_asset_class: AllocationSlice[]
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

export interface BucketRow {
  /** null = Unassigned. */
  bucket_id: string | null
  values: Series
  current: Decimal | null
  /** Of the currency's total today (0-1). */
  share: Decimal
  change_1m: Decimal | null
  /** Average change per month. */
  pace_3m: Decimal | null
  pace_6m: Decimal | null
  pace_12m: Decimal | null
  /** First value in the range → today, in percent. */
  growth_pct: Decimal | null
  sources: { account_id: string; name: string; percent: Decimal; value: Decimal }[]
}

export interface BucketOverview {
  buckets: { id: string; name: string; color: number; archived: boolean }[]
  currencies: { currency: string; rows: BucketRow[] }[]
}

export interface Overview {
  months: string[]
  currencies: CurrencySeries[]
  buckets: BucketOverview
  allocation: {
    by_type: CurrencyAllocation[]
    by_asset_class: CurrencyAllocation[]
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

// ── dashboard ────────────────────────────────────────────────────────────────

export interface YearValue {
  year: number
  value: Decimal
  as_of: ISODate
}

export interface TopEntry {
  kind: 'account' | 'holding'
  name: string
  symbol: string | null
  held_in: string[]
  value: Decimal
  share: Decimal
  bucket_ids: (string | null)[]
}

export interface TopStock {
  symbol: string
  name: string | null
  held_in: string[]
  value: Decimal
  cost: Decimal | null
  gain_pct: Decimal | null
  share: Decimal
}

export interface GridRow {
  account_id: string
  name: string
  cells: (Decimal | null)[]
  total: Decimal
}

export interface BucketGrid {
  buckets: (BucketRef | null)[]
  rows: GridRow[]
  totals: Decimal[]
}

export interface CurrencyDashboard {
  currency: string
  net_worth: Decimal
  account_count: number
  yearly: YearValue[]
  top_entries: TopEntry[]
  top_stocks: TopStock[]
  grid: BucketGrid
}

export interface DashboardAlert {
  kind: 'rebalance' | 'intent' | 'concentration'
  currency: string
  bucket: BucketRef | null
  amount: Decimal | null
  other_bucket: BucketRef | null
  other_amount: Decimal | null
  expected_return: Decimal | null
  label: 'fixed_deposits' | 'cash' | 'deposits_and_cash' | null
  symbol: string | null
  share: Decimal | null
}

export interface CheckinItem {
  kind: 'balance' | 'holdings'
  id: string
  account_id: string | null
  name: string
  currency: string
  last: ISODate | null
}

export interface Dashboard {
  today: ISODate
  next_milestone: { id: string; name: string; target_date: ISODate } | null
  currencies: CurrencyDashboard[]
  attention: DashboardAlert[]
  checkin: { last: ISODate | null; items: CheckinItem[] }
}

// ── wealth estimator ─────────────────────────────────────────────────────────

export type ScenarioKey = 'conservative' | 'balanced' | 'aggressive'
export const SCENARIO_KEYS: ScenarioKey[] = ['conservative', 'balanced', 'aggressive']

export interface PoolAccount {
  id: string
  name: string
  institution: string | null
  account_type: string
  currency: string
  value: Decimal
  fixed: boolean
}

export interface EstimatorPool {
  accounts: PoolAccount[]
  currencies: string[]
}

export interface InquiryInput {
  monthly_expenses: string
  currency: string
  withdrawal_rate_pct: string
  excluded_account_ids: string[]
}

export interface InquirySummary {
  id: string
  created_at: string
  monthly_expenses: Decimal
  currency: string
  withdrawal_rate_pct: number
  pool: number
  fi_years: Record<ScenarioKey, number | null>
  fi_today: number
  progress: number
  fi_age: number | null
  structure: number
  model: string
  changes: string[]
  targets: Record<string, number>
  labels: Record<string, string>
}

export type EffectKind = 'return_pct' | 'inflation_pct' | 'pool_pct' | 'expenses_pct' | 'none'

export interface InquiryScenario {
  return_pct: number
  return_rebalanced_pct: number
  /** Growth after inflation. */
  real_growth_pct: number
  /** After retiring, the growth pays for the withdrawals: the pool never runs out. */
  preserved: boolean
  /** Real growth minus the withdrawal rate (how fast the pool still grows, or shrinks). */
  surplus_pct: number
  /** Years the pool lasts after retiring when not preserved. */
  lasts_years: number | null
  fi_today: number
  fi_nominal: number | null
  years: number | null
  fi_date: string | null
  fi_year: number | null
  fi_age: number | null
  rebalanced_years: number | null
  rebalanced_year: number | null
  progress: number
  curve: { year: number; as_is: number; rebalanced: number }[]
  rebalance: { key: string; label: string; now_pct: number; target_pct: number; move: number }[]
  milestones: { year: number; focus: string; amount: number; fi: boolean }[]
  change_years: (number | null)[]
  risk_years: (number | null)[]
}

export interface InquiryResult {
  currency: string
  today: ISODate
  withdrawal_rate_pct: number
  monthly_expenses: number
  age: number | null
  pool: number
  pool_by_currency: { currency: string; value: number; rate: number; value_in: number }[]
  inflation: { currency: string; rate_pct: number; period: string; index: string }[]
  expense_inflation_pct: number
  fx: { currency: string; value_in_expense_currency: number; drift_pct: number }[]
  scenarios: Record<ScenarioKey, InquiryScenario>
  structure: { overall: number; diversification: number; liquidity: number; growth_mix: number; currency_spread: number }
  keep: string[]
  changes: { title: string; detail: string; effect: { kind: EffectKind; value: number }; label: string | null }[]
  risks: { severity: 'high' | 'medium' | 'low'; title: string; detail: string; stress: { kind: EffectKind; value: number }; label: string }[]
  excluded: { name: string; currency: string; value: number; reason: 'fixed' | 'unticked' }[]
}

export interface InquiryDetail {
  id: string
  created_at: string
  monthly_expenses: Decimal
  currency: string
  model: string
  cost: Decimal
  result: InquiryResult
  previous: InquirySummary | null
}

export type InquiryStage = 'snapshot' | 'review' | 'checks' | 'compute'

export type InquiryEvent =
  | { type: 'stage'; stage: InquiryStage; status: 'running' | 'done' | 'retry'; problems?: string[] }
  | { type: 'result'; id: string; cost: number }
  | { type: 'error'; message: string; problems?: string[] }
