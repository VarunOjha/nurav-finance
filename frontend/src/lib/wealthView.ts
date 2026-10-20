// Presentation helpers for Wealth Agent reports: years and ages on the
// timeline, chart rows and milestones.

import { parseDate } from './format'

export function ageOn(birth: string, day: string): number {
  const [by, bm, bd] = birth.split('-').map(Number)
  const [y, m, d] = day.split('-').map(Number)
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0)
}

export interface Timeline {
  /** Plan date (YYYY-MM-DD); plan year y ends y years after it. */
  asOf: string
  birth: string | null
}

export const yearAt = (t: Timeline, y: number) => Number(t.asOf.slice(0, 4)) + y

export const ageAt = (t: Timeline, y: number): number | null => (t.birth ? ageOn(t.birth, t.asOf) + y : null)

/** "2047 · age 55" (or just the year without a birth date). */
export function yearAge(t: Timeline, y: number): string {
  const age = ageAt(t, y)
  return age === null ? String(yearAt(t, y)) : `${yearAt(t, y)} · age ${age}`
}

/** FI as a calendar month: "Mar 2047 · age 55". */
export function fiLabel(t: Timeline, months: number): string {
  const d = parseDate(t.asOf)
  const at = new Date(d.getFullYear(), d.getMonth() + months, 1)
  const label = at.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
  if (!t.birth) return label
  const iso = `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(Math.min(d.getDate(), 28)).padStart(2, '0')}`
  return `${label} · age ${ageOn(t.birth, iso)}`
}

export interface SeriesSet {
  buckets: { key: string; values: number[] }[]
  total: number[]
  target: number[] | null
}

/** Deflate every series to today's money: value / (1 + i)^y. */
export function toReal<T extends SeriesSet>(s: T, inflation: number): T {
  const f = (v: number, y: number) => v / (1 + inflation / 100) ** y
  return {
    ...s,
    buckets: s.buckets.map((b) => ({ ...b, values: b.values.map(f) })),
    total: s.total.map(f),
    target: s.target ? s.target.map(f) : null,
  }
}

/** One row per plan year for the charts: { y, year, age, <bucket>: value, total, target }. */
export function chartRows(s: SeriesSet, t: Timeline): Record<string, number | null>[] {
  return s.total.map((total, y) => {
    const row: Record<string, number | null> = { y, year: yearAt(t, y), age: ageAt(t, y), total, target: s.target ? s.target[y] : null }
    for (const b of s.buckets) row[b.key] = b.values[y]
    return row
  })
}

/** First plan year the total reaches each round amount, plus halfway to the target. */
export function milestones(total: number[], target: number[] | null, steps: number[]): { label: number | 'half'; y: number }[] {
  const out: { label: number | 'half'; y: number }[] = []
  if (target) {
    const half = total.findIndex((v, y) => y > 0 && v >= target[y] / 2 && total[0] < target[0] / 2)
    if (half > 0) out.push({ label: 'half', y: half })
  }
  for (const m of steps) {
    const y = total.findIndex((v) => v >= m)
    if (y > 0) out.push({ label: m, y })
  }
  return out.sort((a, b) => a.y - b.y)
}

/** Round amounts worth calling out for a plan of this size: 1, 2.5, 5 × powers of ten. */
export function milestoneSteps(start: number, end: number): number[] {
  const out: number[] = []
  for (let mag = 1e3; mag <= 1e13; mag *= 10) {
    for (const k of [1, 2.5, 5]) {
      const v = k * mag
      if (v > start && v <= end) out.push(v)
    }
  }
  return out.slice(-6)
}

/** Effective yearly growth from a to b over n years, including contributions. */
export const cagr = (a: number, b: number, years: number) => (a > 0 && b > 0 && years > 0 ? (b / a) ** (1 / years) - 1 : null)
