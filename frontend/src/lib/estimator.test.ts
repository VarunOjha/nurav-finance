import { adviceRows, afterRetiring, incomeGrowthPct, balancedDeltas, fiYear, fxLabel, monthsToTarget, monthsUntil, movingTargets, savingFor, yearAfter, yearsDelta } from './estimator'
import type { InquirySummary } from '../types/api'

const q = (id: string, b: number | null, changes: string[], targets: Record<string, number> = {}): InquirySummary => ({
  id,
  created_at: `2026-0${id}-01T12:00:00Z`,
  monthly_expenses: '8000',
  currency: 'USD',
  withdrawal_rate_pct: 3.5,
  pool: 760800,
  fi_years: { conservative: null, balanced: b, aggressive: 2046 },
  fi_today: 2742857,
  progress: 0.28,
  fi_age: 63,
  structure: 6,
  model: 'm',
  changes,
  targets,
  labels: { 'USD:stock:MSFT': 'MSFT', 'USD:bonds': 'USD bonds' },
})

describe('estimator formatters', () => {
  it('words years and FI years', () => {
    expect(yearsDelta(-2)).toBe('−2 yrs')
    expect(yearsDelta(0.5)).toBe('+0.5 yrs')
    expect(yearsDelta(1)).toBe('+1 yr')
    expect(yearsDelta(0.04)).toBe('0')
    expect(yearsDelta(null)).toBe('—')
    expect(fiYear(2055)).toBe('2055')
    expect(fiYear(null)).toBe('60+ yrs')
  })

  it('shows the readable side of an exchange rate', () => {
    expect(fxLabel('INR', 1 / 88, 'USD')).toBe('1 USD = 88.0 INR')
    expect(fxLabel('USD', 88, 'INR')).toBe('1 USD = 88.00 INR')
  })

  it('compares each inquiry with the one before', () => {
    expect(balancedDeltas([q('1', 2056, []), q('2', 2055, []), q('3', null, []), q('4', 2054, [])])).toEqual([null, -1, null, null])
  })

  it('tracks advice across inquiries, latest first, dropped advice resolved', () => {
    const rows = adviceRows([q('1', 2056, ['Build emergency fund', 'Cap MSFT at 10%']), q('2', 2055, ['Cap MSFT at 10%', 'Invest excess cash'])])
    expect(rows).toEqual([
      { title: 'Cap MSFT at 10%', marks: [true, true], resolved: false },
      { title: 'Invest excess cash', marks: [false, true], resolved: false },
      { title: 'Build emergency fund', marks: [true, false], resolved: true },
    ])
  })

  it('lists only targets that moved', () => {
    const list = [q('1', 2056, [], { 'USD:stock:MSFT': 15, 'USD:bonds': 15 }), q('2', 2055, [], { 'USD:stock:MSFT': 10, 'USD:bonds': 15 })]
    expect(movingTargets(list)).toEqual([{ label: 'MSFT', values: [15, 10] }])
    expect(movingTargets(list.slice(0, 1))).toEqual([])
  })
})

describe('retire earlier', () => {
  // $760K today, target $96K / 3.5% = $2.743M, 8% growth and 2.5% inflation → 5.37% real.
  const pool = 760000
  const target = 96000 / 0.035
  const real = (1.08 / 1.025 - 1) * 100

  it('reaches the target in ~24.5 years without saving, matching the yearly formula', () => {
    const months = monthsToTarget(pool, target, real, 0)!
    const years = Math.log(target / pool) / Math.log(1.08 / 1.025)
    expect(months / 12).toBeCloseTo(years, 6)
    expect(yearAfter('2026-11-08', months)).toBe(2051)
  })

  it('saving each month brings it forward, and the two directions agree', () => {
    expect(monthsToTarget(pool, target, real, 1400)! / 12).toBeCloseTo(20, 0)
    expect(monthsToTarget(pool, target, real, 4000)! / 12).toBeCloseTo(15, 0)
    expect(monthsToTarget(pool, target, real, 9300)! / 12).toBeCloseTo(10, 0)
    const need = savingFor(pool, target, real, 180)
    expect(monthsToTarget(pool, target, real, need)).toBeCloseTo(180, 6)
  })

  it('handles already there, no growth and never', () => {
    expect(monthsToTarget(3e6, target, real, 0)).toBe(0)
    expect(savingFor(3e6, target, real, 120)).toBe(0)
    expect(monthsToTarget(pool, target, 0, 10000)).toBeCloseTo((target - pool) / 10000, 6) // ~16.5 years
    expect(monthsToTarget(pool, target, 0, 1000)).toBeNull() // 165 years: beyond the horizon
    expect(monthsToTarget(pool, target, -1, 0)).toBeNull()
    expect(monthsUntil('2026-11-08', 2041)).toBe(181)
  })
})

describe('after retiring', () => {
  // $10K a month at 3.5% → $3.43M target; 6.6% growth, 2.5% inflation, retiring in 38.4 years.
  const today = 120000 / 0.035
  const then = today * Math.pow(1.025, 38.41)
  const rows = afterRetiring(today, then, 6.6, 2.5, 3.5)

  it('starts at exactly the expenses and goes every 3 years for 30', () => {
    expect(rows.map((r) => r.after)).toEqual([0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30])
    expect(rows[0].monthlyToday).toBeCloseTo(10000, 6)
    expect(rows[0].monthlyThen).toBeCloseTo(10000 * Math.pow(1.025, 38.41), 6)
  })

  it('grows in today’s money by (1 + r − w) / (1 + i) a year, and by (1 + r − w) in that year’s money', () => {
    expect(rows[10].monthlyToday).toBeCloseTo(10000 * Math.pow(1.031 / 1.025, 30), 6) // ≈ $11,915
    expect(rows[10].monthlyThen / rows[0].monthlyThen).toBeCloseTo(Math.pow(1.031, 30), 6)
    expect(rows[10].poolToday).toBeCloseTo(today * Math.pow(1.031 / 1.025, 30), 6)
    expect(incomeGrowthPct(6.6, 2.5, 3.5)).toBeCloseTo(0.585, 3)
  })

  it('shrinks in today’s money when growth after inflation is below the rate', () => {
    const low = afterRetiring(today, then, 5.2, 2.5, 3.5)
    expect(low[10].monthlyToday).toBeLessThan(10000)
    expect(incomeGrowthPct(5.2, 2.5, 3.5)).toBeLessThan(0)
  })
})
