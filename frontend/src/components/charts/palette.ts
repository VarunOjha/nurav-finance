import type { ChartTheme } from './chartTheme'

// Colour follows the entity, never its rank: each kind of thing gets a fixed
// slot (known enums by their declared order, free-text names by sorted order),
// so a filter or a re-sort never repaints the survivors. Anything past the 8
// slots folds into a neutral "Other" — never a generated 9th hue.

export const ASSET_CLASS_ORDER = ['stock', 'etf', 'mutual_fund', 'bond', 'cash', 'crypto', 'other']
export const ACCOUNT_TYPE_ORDER = ['checking', 'savings', 'fixed_deposit', 'brokerage', 'retirement', 'portfolio', 'other']

export const OTHER = 'Other'

export type ColorOf = (key: string) => string | null

/** Slot by position in a fixed list; keys not in it (or past slot 8) get null → fold into Other. */
export function slotColors(theme: ChartTheme, order: readonly string[]): ColorOf {
  return (key) => {
    const i = order.indexOf(key)
    return i >= 0 && i < theme.series.length ? theme.series[i] : null
  }
}

/** Slots for free-text names (portfolios, tags): alphabetical, so stable across views. */
export function nameColors(theme: ChartTheme, names: Iterable<string>): ColorOf {
  const sorted = [...new Set(names)].sort((a, b) => a.localeCompare(b))
  return slotColors(theme, sorted)
}

export interface Slice {
  key: string
  label: string
  value: number
  share: number
  color: string
}

/** Colour slices by entity and fold the colourless ones (and non-positive values) into one grey "Other". */
export function colorSlices(
  slices: { label: string; value: string | number; share: string | number }[],
  colorOf: ColorOf,
  theme: ChartTheme,
  labelOf: (key: string) => string = (k) => k,
): Slice[] {
  const out: Slice[] = []
  let other: Slice | null = null
  for (const s of slices) {
    const value = Number(s.value)
    const share = Number(s.share)
    if (!(value > 0)) continue
    const color = colorOf(s.label)
    if (color) out.push({ key: s.label, label: labelOf(s.label), value, share, color })
    else {
      other ??= { key: OTHER, label: OTHER, value: 0, share: 0, color: theme.inkFaint }
      other.value += value
      other.share += share
    }
  }
  return other ? [...out, other] : out
}
