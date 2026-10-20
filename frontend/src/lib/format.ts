// Display formatting. Amounts are never converted between currencies.

export function toNumber(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === '') return null
  const n = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

// INR uses lakh/crore grouping (₹8,43,580.00); other currencies their own locale.
const LOCALE_FOR: Record<string, string> = { INR: 'en-IN' }

const formatters = new Map<string, Intl.NumberFormat>()

function formatter(currency: string, compact: boolean): Intl.NumberFormat {
  const key = `${currency}|${compact}`
  let f = formatters.get(key)
  if (!f) {
    f = new Intl.NumberFormat(LOCALE_FOR[currency] ?? 'en-US', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      ...(compact ? { notation: 'compact', maximumFractionDigits: 1 } : { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    })
    formatters.set(key, f)
  }
  return f
}

export function money(value: string | number | null | undefined, currency: string, opts: { compact?: boolean } = {}): string {
  const n = toNumber(value)
  if (n === null) return '—'
  try {
    return formatter(currency, !!opts.compact).format(n)
  } catch {
    return `${currency} ${n.toFixed(2)}` // unknown currency code
  }
}

/** "+$1,204.10" / "−$2,000.00" (true minus sign) / "—". */
export function signedMoney(value: string | number | null | undefined, currency: string, opts: { compact?: boolean } = {}): string {
  const n = toNumber(value)
  if (n === null) return '—'
  if (n === 0) return money(0, currency, opts)
  const body = money(Math.abs(n), currency, opts)
  return n > 0 ? `+${body}` : `−${body}`
}

/** CSS class for a change: gains in ink, losses in error red, flat muted. */
export function deltaClass(value: string | number | null | undefined): string {
  const n = toNumber(value)
  if (n === null || n === 0) return 'text-ink-muted'
  return n > 0 ? 'text-ink' : 'text-error'
}

export function arrow(value: string | number | null | undefined): string {
  const n = toNumber(value)
  if (n === null || n === 0) return ''
  return n > 0 ? '▲' : '▼'
}

export function percent(value: string | number | null | undefined, digits = 1): string {
  const n = toNumber(value)
  if (n === null) return '—'
  return `${(n * 100).toFixed(digits)}%`
}

export function signedPercent(value: string | number | null | undefined, digits = 1): string {
  const n = toNumber(value)
  if (n === null) return '—'
  const body = `${Math.abs(n * 100).toFixed(digits)}%`
  return n > 0 ? `+${body}` : n < 0 ? `−${body}` : body
}

export function quantity(value: string | number | null | undefined): string {
  const n = toNumber(value)
  if (n === null) return '—'
  return n.toLocaleString('en-US', { maximumFractionDigits: 8 })
}

/** Parse YYYY-MM-DD as a local calendar date (no timezone shift). */
export function parseDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return parseDate(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** "2026-03" -> "Mar 26". */
export function monthLabel(key: string, long = false): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', long ? { month: 'short', year: 'numeric' } : { month: 'short', year: '2-digit' })
}

/** Today as YYYY-MM-DD in the browser's timezone. */
export function todayISO(): string {
  const d = new Date()
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export const ACCOUNT_TYPE_LABELS: Record<string, string> = {
  checking: 'Checking',
  savings: 'Savings',
  fixed_deposit: 'Fixed deposit',
  brokerage: 'Brokerage',
  retirement: 'Retirement',
  other: 'Other',
  portfolio: 'Portfolio',
}

export const ASSET_CLASS_LABELS: Record<string, string> = {
  stock: 'Stock',
  etf: 'ETF',
  mutual_fund: 'Mutual fund',
  bond: 'Bond',
  cash: 'Cash',
  crypto: 'Crypto',
  other: 'Other',
}

export const GENDER_LABELS: Record<string, string> = {
  female: 'Female',
  male: 'Male',
  non_binary: 'Non-binary',
  prefer_not_to_say: 'Prefer not to say',
}

/** Common currencies offered in pickers; any ISO 4217 code is accepted by the API. */
export const CURRENCIES = ['USD', 'INR', 'SGD', 'EUR', 'GBP', 'AED', 'AUD', 'CAD', 'JPY', 'CHF']

export const COUNTRIES: { code: string; name: string }[] = [
  { code: 'US', name: 'United States' },
  { code: 'IN', name: 'India' },
  { code: 'SG', name: 'Singapore' },
  { code: 'GB', name: 'United Kingdom' },
  { code: 'AE', name: 'United Arab Emirates' },
  { code: 'CA', name: 'Canada' },
  { code: 'AU', name: 'Australia' },
  { code: 'DE', name: 'Germany' },
  { code: 'JP', name: 'Japan' },
  { code: 'CH', name: 'Switzerland' },
]

export function countryName(code: string | null | undefined): string {
  if (!code) return ''
  return COUNTRIES.find((c) => c.code === code)?.name ?? code
}
