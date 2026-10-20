// Growth velocity: how fast wealth grows, per currency, from month-end values.
// Change includes everything that moves the total (saving, spending, market
// returns), which is what "wealth velocity" means here. All arrays line up with
// Overview.months; a null value (no data yet) yields null rates around it.

export const PACE_WINDOW = 3

type Values = (number | null)[]

/** Month-over-month change; index i is values[i] − values[i−1]. */
export function monthlyChanges(values: Values): Values {
  return values.map((v, i) => (i > 0 && v !== null && values[i - 1] !== null ? v - values[i - 1]! : null))
}

/** Trailing mean of `window` consecutive changes ending at i (needs all of them). */
export function rollingMean(changes: Values, window = PACE_WINDOW): Values {
  return changes.map((_, i) => {
    if (i + 1 < window) return null
    const slice = changes.slice(i + 1 - window, i + 1)
    return slice.some((c) => c === null) ? null : slice.reduce<number>((s, c) => s + (c ?? 0), 0) / window
  })
}

/**
 * Compound monthly growth rate over the trailing `window` months ending at i:
 * (V[i] / V[i−window])^(1/window) − 1. Null when either end is missing or the
 * base isn't positive (a rate off zero or a negative base means nothing).
 */
export function compoundMonthlyRate(values: Values, window = PACE_WINDOW): Values {
  return values.map((v, i) => {
    const base = i >= window ? values[i - window] : null
    if (v === null || base === null || base <= 0 || v < 0) return null
    return Math.pow(v / base, 1 / window) - 1
  })
}

export interface VelocitySummary {
  /** Average change per month over the last PACE_WINDOW months. */
  pace: number | null
  /** The same for the PACE_WINDOW months before that. */
  previousPace: number | null
  /** pace − previousPace: positive means growth is speeding up. */
  acceleration: number | null
  /** Growth from the first to the last month with data, as a fraction. */
  growth: number | null
  /** That growth annualised (compound), only over spans of 3+ months. */
  annualised: number | null
  /** Months between the first and last value used for growth. */
  span: number
  /** Latest compound monthly rate over PACE_WINDOW months. */
  monthlyRate: number | null
}

export function summarise(values: Values): VelocitySummary {
  const pace = rollingMean(monthlyChanges(values))
  const last = values.length - 1
  const current = pace[last] ?? null
  const previous = last - PACE_WINDOW >= 0 ? (pace[last - PACE_WINDOW] ?? null) : null

  const first = values.findIndex((v) => v !== null && v > 0)
  let lastIdx = last
  while (lastIdx >= 0 && values[lastIdx] === null) lastIdx--
  const span = first >= 0 && lastIdx > first ? lastIdx - first : 0
  const growth = span > 0 ? values[lastIdx]! / values[first]! - 1 : null
  const annualised = growth !== null && span >= 3 && values[lastIdx]! >= 0 ? Math.pow(1 + growth, 12 / span) - 1 : null

  return {
    pace: current,
    previousPace: previous,
    acceleration: current !== null && previous !== null ? current - previous : null,
    growth,
    annualised,
    span,
    monthlyRate: compoundMonthlyRate(values)[last] ?? null,
  }
}
