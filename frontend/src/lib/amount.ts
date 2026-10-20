// Live digit grouping for amount inputs. The input shows "12,34,567.89" (INR)
// or "1,234,567.89" (everything else); the app stores and submits the plain
// string ("1234567.89"), so API payloads never contain separators.
// Grouping is done on the digit string, not via Number, so long values keep
// every digit.

export interface AmountOptions {
  /** ISO code; decides the grouping style. Omit for plain quantities (US style). */
  currency?: string
  /** Digits allowed after the decimal point; extra ones are dropped. */
  maxDecimals?: number
  allowNegative?: boolean
}

/** Indian grouping (lakh/crore) for rupees, thousands everywhere else. */
export function groupingStyle(currency?: string): 'indian' | 'thousands' {
  return currency?.toUpperCase() === 'INR' ? 'indian' : 'thousands'
}

export function groupDigits(digits: string, currency?: string): string {
  if (digits.length <= 3) return digits
  const head = digits.slice(0, -3)
  const tail = digits.slice(-3)
  const size = groupingStyle(currency) === 'indian' ? 2 : 3
  const groups: string[] = []
  for (let end = head.length; end > 0; end -= size) groups.unshift(head.slice(Math.max(0, end - size), end))
  return `${groups.join(',')},${tail}`
}

/** Clean and group whatever was typed or pasted. Keeps partial input ("1,234.", "-", "0.0"). */
export function formatAmountInput(raw: string, opts: AmountOptions = {}): string {
  const { currency, maxDecimals = 2, allowNegative = false } = opts
  const s = raw.trim()
  const negative = allowNegative && s.startsWith('-')
  const cleaned = s.replace(/[^\d.]/g, '')
  const dot = cleaned.indexOf('.')
  let int = dot === -1 ? cleaned : cleaned.slice(0, dot)
  const frac = dot === -1 ? '' : cleaned.slice(dot + 1).replace(/\./g, '').slice(0, maxDecimals)
  int = int.replace(/^0+(?=\d)/, '')
  const hasDot = dot !== -1 && maxDecimals > 0
  if (hasDot && !int) int = '0'
  return `${negative ? '-' : ''}${groupDigits(int, currency)}${hasDot ? `.${frac}` : ''}`
}

/** Display → plain decimal for state and the API: no separators, no dangling "." or "-". */
export function parseAmount(display: string): string {
  const s = display.replace(/,/g, '').trim()
  if (s === '-' || s === '.' || s === '-.') return ''
  return s.endsWith('.') ? s.slice(0, -1) : s
}

/** "10.50000000" → "10.5" — API decimals shown without padding (never exponent notation). */
export function trimDecimal(value: string | null | undefined): string {
  if (value === null || value === undefined) return ''
  const s = String(value).trim()
  return s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s
}

const significant = (ch: string) => /[\d.-]/.test(ch)

/**
 * Reformat after an edit and work out where the caret belongs: after the same
 * number of digits/points/signs it followed in the raw text, so separators
 * appearing or vanishing don't make it jump.
 */
export function reformat(raw: string, caret: number, opts: AmountOptions = {}): { value: string; caret: number } {
  const value = formatAmountInput(raw, opts)
  let want = 0
  for (let i = 0; i < Math.min(caret, raw.length); i++) if (significant(raw[i])) want++
  let pos = 0
  let seen = 0
  while (pos < value.length && seen < want) {
    if (significant(value[pos])) seen++
    pos++
  }
  return { value, caret: pos }
}
