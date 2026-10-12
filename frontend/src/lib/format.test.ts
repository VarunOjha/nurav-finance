import { deltaClass, money, monthLabel, parseDate, signedMoney, toNumber } from './format'

describe('money', () => {
  it('formats USD with two decimals', () => {
    expect(money('1234.5', 'USD')).toBe('$1,234.50')
  })

  it('uses lakh grouping for INR', () => {
    expect(money('843580', 'INR')).toBe('₹8,43,580.00')
  })

  it('shows a dash for missing values', () => {
    expect(money(null, 'USD')).toBe('—')
    expect(money('', 'USD')).toBe('—')
  })
})

describe('signedMoney', () => {
  it('prefixes gains with + and losses with a true minus sign', () => {
    expect(signedMoney('1204.1', 'USD')).toBe('+$1,204.10')
    expect(signedMoney('-2000', 'USD')).toBe('−$2,000.00')
    expect(signedMoney('-2000', 'USD')).not.toContain('-')
  })
})

describe('deltaClass', () => {
  it('maps gains, losses and flat values', () => {
    expect(deltaClass('5')).toBe('text-ink')
    expect(deltaClass('-5')).toBe('text-error')
    expect(deltaClass('0')).toBe('text-ink-muted')
    expect(deltaClass(null)).toBe('text-ink-muted')
  })
})

describe('dates', () => {
  it('parses YYYY-MM-DD as a local date without timezone shift', () => {
    const d = parseDate('2024-03-01')
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2024, 2, 1])
  })

  it('labels months', () => {
    expect(monthLabel('2026-03')).toBe("Mar 26")
    expect(monthLabel('2026-03', true)).toBe('Mar 2026')
  })
})

describe('toNumber', () => {
  it('parses decimal strings', () => {
    expect(toNumber('12.3400')).toBe(12.34)
    expect(toNumber('abc')).toBeNull()
  })
})
