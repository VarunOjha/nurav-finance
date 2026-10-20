import { compoundMonthlyRate, monthlyChanges, rollingMean, summarise } from './velocity'

describe('growth velocity', () => {
  it('computes monthly changes and a 3-month pace', () => {
    const values = [null, 100, 110, 130, 130, 160]
    expect(monthlyChanges(values)).toEqual([null, null, 10, 20, 0, 30])
    expect(rollingMean(monthlyChanges(values))).toEqual([null, null, null, null, 10, 50 / 3])
  })

  it('compounds the monthly rate and skips non-positive bases', () => {
    const [rate] = compoundMonthlyRate([100, 110, 121, 133.1]).slice(3)
    expect(rate).toBeCloseTo(0.1, 10)
    expect(compoundMonthlyRate([0, 5, 10, 20])[3]).toBeNull()
    expect(compoundMonthlyRate([-50, 5, 10, 20])[3]).toBeNull()
  })

  it('summarises pace, acceleration and annualised growth', () => {
    // +10/month for 3 months, then +40/month for 3 months.
    const s = summarise([1000, 1010, 1020, 1030, 1070, 1110, 1150])
    expect(s.pace).toBe(40)
    expect(s.previousPace).toBe(10)
    expect(s.acceleration).toBe(30)
    expect(s.growth).toBeCloseTo(0.15, 10)
    expect(s.span).toBe(6)
    expect(s.annualised).toBeCloseTo(1.15 ** 2 - 1, 10)
  })

  it('stays null when there is too little history', () => {
    expect(summarise([null, null, 500])).toMatchObject({ pace: null, acceleration: null, growth: null, annualised: null, span: 0 })
    const short = summarise([100, 120])
    expect(short.growth).toBeCloseTo(0.2, 10)
    expect(short.annualised).toBeNull() // under 3 months: annualising would exaggerate
  })
})
