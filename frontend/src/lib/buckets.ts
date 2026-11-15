import type { ChartTheme } from '../components/charts/chartTheme'

// A bucket's colour is a palette slot chosen in Profile (0-7), so it is the same
// on every page and follows light/dark themes. Unassigned money is always grey.

export const UNASSIGNED = 'Unassigned'
export const COLOR_SLOTS = 8

export function bucketColor(theme: ChartTheme, slot: number | null | undefined): string {
  if (slot === null || slot === undefined) return theme.inkFaint
  return theme.series[((slot % COLOR_SLOTS) + COLOR_SLOTS) % COLOR_SLOTS] ?? theme.inkFaint
}

/** "85" / "33.33" → hundredths (8500 / 3333); null if not a valid split percent (0 < p ≤ 100, ≤ 2 dp). */
export function percentCents(text: string): number | null {
  const t = text.trim()
  if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return null
  const cents = Math.round(Number(t) * 100)
  return cents > 0 && cents <= 10000 ? cents : null
}

export const centsText = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2).replace(/0$/, ''))

/** Short "Growth 85 · Emergency fund 15" description of a split. */
export function splitLabel(lines: { name: string; percent: string | number }[]): string {
  return lines.map((l) => `${l.name} ${Number(l.percent).toLocaleString(undefined, { maximumFractionDigits: 2 })}%`).join(' · ')
}
