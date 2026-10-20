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

export interface Tenant {
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

export type AccountType = 'checking' | 'savings' | 'fixed_deposit' | 'brokerage' | 'retirement' | 'other'

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
  account_id: string | null
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

// ── Wealth Agent (backend/schemas/wealth.py, services/wealth, services/agent) ─

/** The one number a pot solves for. */
export type SolveFor = 'time' | 'amount' | 'rate' | 'contribution'
export type RiskAppetite = 'cautious' | 'balanced' | 'growth'

export interface WealthPrefs {
  solve_for: SolveFor | null
  horizon_years: number | null
  horizon_age: number | null
  risk_appetite: RiskAppetite | null
}

export interface Contribution {
  amount: number
  per: 'month' | 'year'
  /** Years it runs from now; null = the whole plan. */
  years: number | null
  step_up: number
}

export interface SegmentParams {
  name: string
  share: number | null
  amount: number | null
  rate: number | null
  target: number | null
  contribution: Contribution | null
}

export interface PotParams {
  currency: string
  solve_for: SolveFor
  start_override: number | null
  exclude: string[]
  target: number | null
  target_basis: 'today' | 'nominal'
  horizon_years: number | null
  horizon_age: number | null
  rate: number | null
  rate_options: number[] | null
  contribution: Contribution | null
  one_offs: { year: number; amount: number; note: string }[]
  segments: SegmentParams[]
  monthly_spending: number | null
}

export interface WealthParams {
  title: string
  pots: PotParams[]
  inflation: number
  compounding: 12 | 4 | 1
  risk_appetite: RiskAppetite | null
  defaults: string[]
}

/** A pot as the server resolved it against today's balances. */
export interface DraftPot {
  currency: string
  start: number
  actual_start: number
  items: { alias: string; name: string; kind: 'account' | 'portfolio'; value: number }[]
  excluded: { alias: string; name: string; value: number }[]
  horizon_years: number | null
  target: number | null
  segments: { name: string; start: number }[]
  rate_options: number[] | null
}

/** A validated, resolved draft as the person approves it. Signed by the server; send it back unchanged. */
export interface WealthDraft {
  v: number
  id: string
  params: WealthParams
  as_of: ISODate
  birth_date: ISODate | null
  pots: DraftPot[]
  warnings: string[]
  sig: string
}

export type SolveStatus = 'ok' | 'already' | 'unreachable'

export interface PotAnswer {
  status: SolveStatus
  /** amount: the end amount; rate: % a year; contribution: per `per`. */
  value?: number | null
  real?: number
  /** time: months from today. */
  months?: number | null
  per?: 'month' | 'year'
}

export interface PotLine {
  label: string
  rate: number | null
  shift: number | null
  /** Total per plan year, 0..horizon_years. */
  total: number[]
  end: number
  /** When this line reaches the target (looking up to 60 years). */
  fi_months: number | null
}

export interface SegmentResult {
  name: string
  start: number
  rate: number | null
  target: number | null
  /** Months until the segment reaches its own target on its own. */
  months: number | null
  end: number | null
  target_end: number | null
  reaches?: boolean
  required?: { status: SolveStatus; value: number | null; per: 'month' | 'year'; extra?: boolean }
  runway_months?: number
}

export interface PotResult {
  currency: string
  solve_for: SolveFor
  start: number
  target: number | null
  target_basis: 'today' | 'nominal'
  plan_years: number | null
  /** How many years the chart and tables run. */
  horizon_years: number
  /** The date segments are checked at: the plan's end, or when the pot reaches its target. */
  ref_years: number | null
  answer: PotAnswer
  fi_months: number | null
  flat_rate: number | null
  amounts: Record<string, number>
  main: {
    buckets: { key: string; values: number[]; added: number[] }[]
    total: number[]
    total_real: number[]
    target: number[] | null
    fi_months: number | null
  }
  lines: PotLine[]
  grid_years: number[]
  contribution_effect:
    | { kind: 'time'; with: number | null; without: number | null }
    | { kind: 'amount'; with: number; without: number }
    | { kind: 'rate'; with: PotAnswer; without: PotAnswer }
    | null
  rate_by_horizon: { years: number; status: SolveStatus; value: number | null }[] | null
  contribution_by_rate: { label: string; rate: number; status: SolveStatus; value: number | null }[] | null
  segments: SegmentResult[] | null
}

export interface RiskRead {
  currency: string
  net_worth: number
  currencies: { currency: string; count: number; total: number }[]
  retirement_share: number | null
  cash_share: number | null
  cash_months?: number
  holdings?: {
    count: number
    value: number
    top: { symbol: string; share: number; share_of_net_worth: number | null }
    top3_share: number
    asset_classes: { asset_class: string; share: number }[]
  }
}

export interface Narrative {
  headline: string
  insights: string[]
  watch_outs: string[]
  recommendations: string[]
  glossary: { term: string; meaning: string }[]
  chat_summary: string
  follow_ups: string[]
}

/** One run of an approved draft: what the report draws. */
export interface WealthVersion {
  n?: number
  engine: string
  draft: WealthDraft
  pots: PotResult[]
  /** By currency. */
  risk: Record<string, RiskRead>
  figures: Record<string, string>
  narrative: Narrative | null
}

export interface WealthPlanSummary {
  id: string
  name: string
  as_of: ISODate
  created_at: ISODateTime
  pots: { currency: string; solve_for: SolveFor; start: number; answer: string }[]
}

export interface WealthPlan {
  id: string
  name: string
  as_of: ISODate
  created_at: ISODateTime
  model: string
  report: WealthVersion
}

export interface AgentStatus {
  enabled: boolean
  fake: boolean
  model: string
  stt_model: string
  cap_usd: number
  spent_today_usd: number
}

export interface AgentSnapshot {
  as_of: ISODate
  age: number | null
  currencies: { currency: string; count: number; total: number }[]
  items: { alias: string; kind: 'account' | 'portfolio'; type: string; currency: string; value: number | null; counted_in?: string; linked_account?: string; asset_mix?: Record<string, number> }[]
}

/** The conversation as the browser keeps it (OpenAI chat format, aliases only). */
export interface ChatMessage {
  role: 'user' | 'assistant' | 'tool'
  content?: string | null
  tool_calls?: { id: string; type: 'function'; function: { name: string; arguments: string } }[]
  tool_call_id?: string
}

export type AgentEvent =
  | { type: 'aliases'; map: Record<string, string> }
  | { type: 'text'; delta: string }
  | { type: 'status'; text: string }
  | { type: 'draft'; draft: WealthDraft }
  | { type: 'version'; version: WealthVersion }
  | { type: 'report'; n: number; narrative: Narrative }
  | { type: 'usage'; cost: number; chat?: number; today: number; cap: number }
  | { type: 'error'; message: string }
  | { type: 'done'; messages: ChatMessage[] }
