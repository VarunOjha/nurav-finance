import { useState } from 'react'
import { cn } from '../../lib/cn'
import { money, percent, signedMoney, signedPercent } from '../../lib/format'
import type { Outcome } from '../HoldingsTables'
import { useChartTheme } from './chartTheme'
import { Legend } from './kit'

const TOP = 5 // biggest movers each way: the five whose weight grew most, and the five that shrank most
const HEIGHT = 320
const PAD = 14 // room for the end dots and labels at the top and bottom
const LABEL_GAP = 16 // minimum vertical distance between two labels on one side
const FLAT = 0.0025 // a weight change under a quarter of a point reads as "about the same"

interface Line {
  key: string
  label: string
  from: number // share of invested
  to: number // share of value today
  gainPct: number | null
  detail: string
  color: string
  muted?: boolean
}

/** Spread label positions so none are closer than `gap`, keeping their order and staying in [lo, hi]. */
export function spread(ys: number[], gap: number, lo: number, hi: number): number[] {
  const order = ys.map((y, i) => ({ y, i })).sort((a, b) => a.y - b.y)
  const out = order.map((o) => o.y)
  for (let k = 1; k < out.length; k++) out[k] = Math.max(out[k], out[k - 1] + gap)
  const overflow = out.length ? out[out.length - 1] - hi : 0
  if (overflow > 0) {
    out[out.length - 1] = hi
    for (let k = out.length - 2; k >= 0; k--) out[k] = Math.min(out[k], out[k + 1] - gap)
  }
  const result: number[] = []
  order.forEach((o, k) => (result[o.i] = Math.max(lo, out[k])))
  return result
}

const shift = (o: Outcome) => o.valueShare - o.costShare

/** The TOP holdings whose weight grew most and the TOP that shrank most; everything else folds into one line. */
export function pickMovers(rows: Outcome[], top = TOP): { grew: Outcome[]; shrank: Outcome[]; rest: Outcome[] } {
  const grew = rows.filter((o) => shift(o) > 0).sort((a, b) => shift(b) - shift(a)).slice(0, top)
  const shrank = rows.filter((o) => shift(o) < 0).sort((a, b) => shift(a) - shift(b)).slice(0, top)
  const picked = new Set([...grew, ...shrank])
  return { grew, shrank, rest: rows.filter((o) => !picked.has(o)) }
}

/**
 * Slope chart: each holding's share of the money invested (left) against its
 * share of the value today (right). A line climbing means that bet grew faster
 * than the rest; falling means it lagged. Shares are over the holdings that have
 * a buy price, so both sides add up to 100%.
 */
export function ShareShift({ rows, currency }: { rows: Outcome[]; currency: string }) {
  const theme = useChartTheme()
  const [active, setActive] = useState<string | null>(null)
  if (rows.length === 0) return <p className="font-mono text-[11px] text-ink-faint">No holdings with a buy price yet.</p>

  const up = theme.series[0]
  const down = theme.series[7]
  const { grew, shrank, rest } = pickMovers(rows)
  const shown = [...grew, ...shrank]

  const lines: Line[] = shown.map((o) => {
    const d = o.valueShare - o.costShare
    return {
      key: o.holding.symbol,
      label: o.holding.symbol,
      from: o.costShare,
      to: o.valueShare,
      gainPct: o.gainPct,
      detail: `${money(o.cost, currency)} invested → ${money(o.value, currency)} now · ${signedMoney(o.gain, currency)} (${signedPercent(o.gainPct)})`,
      color: Math.abs(d) < FLAT ? theme.inkMuted : d > 0 ? up : down,
    }
  })
  if (rest.length) {
    const cost = rest.reduce((s, o) => s + o.cost, 0)
    const value = rest.reduce((s, o) => s + o.value, 0)
    lines.push({
      key: '__rest__',
      label: `${rest.length} more`,
      from: rest.reduce((s, o) => s + o.costShare, 0),
      to: rest.reduce((s, o) => s + o.valueShare, 0),
      gainPct: cost > 0 ? (value - cost) / cost : null,
      detail: `${money(cost, currency)} invested → ${money(value, currency)} now, together`,
      color: theme.inkFaint,
      muted: true,
    })
  }

  const max = Math.max(...lines.flatMap((l) => [l.from, l.to]), 0.01)
  const y = (share: number) => PAD + (1 - share / max) * (HEIGHT - 2 * PAD)
  const leftY = spread(lines.map((l) => y(l.from)), LABEL_GAP, 6, HEIGHT - 6)
  const rightY = spread(lines.map((l) => y(l.to)), LABEL_GAP, 6, HEIGHT - 6)
  const focus = lines.find((l) => l.key === active)
  // A holding's weight grows exactly when it returned more than the whole set did.
  const totalCost = rows.reduce((s, o) => s + o.cost, 0)
  const overall = totalCost > 0 ? rows.reduce((s, o) => s + o.value, 0) / totalCost - 1 : null
  const dim = (key: string) => active !== null && active !== key

  const hover = (key: string) => ({
    onMouseEnter: () => setActive(key),
    onMouseLeave: () => setActive(null),
    onFocus: () => setActive(key),
    onBlur: () => setActive(null),
  })

  const label = 'font-mono text-[11px] whitespace-nowrap absolute -translate-y-1/2 transition-opacity focus:outline-none focus-visible:underline'

  return (
    <div className="flex flex-col gap-3">
      <div className="max-w-3xl grid grid-cols-[minmax(0,7rem)_minmax(4rem,1fr)_minmax(0,9.5rem)] sm:grid-cols-[9rem_minmax(6rem,1fr)_11rem] gap-x-3">
        <p className="font-mono text-[10px] uppercase tracking-widest text-ink-muted text-right pb-2">Invested</p>
        <span />
        <p className="font-mono text-[10px] uppercase tracking-widest text-ink-muted pb-2">Now</p>

        {/* Left labels: symbol and share of invested */}
        <div className="relative" style={{ height: HEIGHT }}>
          {lines.map((l, i) => (
            <span
              key={l.key}
              tabIndex={0}
              {...hover(l.key)}
              className={cn(label, 'right-0 text-right', dim(l.key) && 'opacity-30', l.muted ? 'text-ink-muted' : 'text-ink')}
              style={{ top: leftY[i] }}
            >
              {l.label} <span className="num text-ink-muted">{percent(l.from)}</span>
            </span>
          ))}
        </div>

        {/* Lines between the two axes */}
        <div className="relative" style={{ height: HEIGHT }} role="img" aria-label={lines.map((l) => `${l.label}: ${percent(l.from)} of invested, ${percent(l.to)} of value now`).join('; ')}>
          <svg className="absolute inset-0 w-full h-full overflow-visible" viewBox={`0 0 100 ${HEIGHT}`} preserveAspectRatio="none" aria-hidden="true">
            <line x1={0} x2={0} y1={0} y2={HEIGHT} stroke={theme.line} vectorEffect="non-scaling-stroke" />
            <line x1={100} x2={100} y1={0} y2={HEIGHT} stroke={theme.line} vectorEffect="non-scaling-stroke" />
            {lines.map((l) => (
              <g key={l.key} {...hover(l.key)} style={{ opacity: dim(l.key) ? 0.2 : 1 }}>
                <line x1={0} y1={y(l.from)} x2={100} y2={y(l.to)} stroke="transparent" strokeWidth={14} vectorEffect="non-scaling-stroke" />
                <line
                  x1={0}
                  y1={y(l.from)}
                  x2={100}
                  y2={y(l.to)}
                  stroke={l.color}
                  strokeWidth={active === l.key ? 3 : 2}
                  strokeDasharray={l.muted ? '4 3' : undefined}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            ))}
          </svg>
          {lines.map((l) =>
            (['from', 'to'] as const).map((side) => (
              <span
                key={`${l.key}-${side}`}
                aria-hidden="true"
                className="absolute w-2.5 h-2.5 rounded-full -translate-y-1/2 pointer-events-none transition-opacity"
                style={{
                  top: y(l[side]),
                  [side === 'from' ? 'left' : 'right']: -5,
                  background: l.color,
                  boxShadow: `0 0 0 2px ${theme.paper}`,
                  opacity: dim(l.key) ? 0.2 : 1,
                }}
              />
            )),
          )}
        </div>

        {/* Right labels: share of value now, then the return */}
        <div className="relative" style={{ height: HEIGHT }}>
          {lines.map((l, i) => (
            <span
              key={l.key}
              tabIndex={0}
              {...hover(l.key)}
              className={cn(label, 'left-0', dim(l.key) && 'opacity-30', l.muted ? 'text-ink-muted' : 'text-ink')}
              style={{ top: rightY[i] }}
            >
              <span className="num text-ink-muted">{percent(l.to)}</span> {l.label}{' '}
              <span className={cn('num', l.gainPct !== null && l.gainPct < 0 ? 'text-error' : 'text-ink-muted')}>{signedPercent(l.gainPct)}</span>
            </span>
          ))}
        </div>
      </div>

      <p className="font-mono text-[11px] min-h-[1.25rem]" aria-live="polite">
        {focus ? (
          <>
            <span className="text-ink font-medium">{focus.label}</span>{' '}
            <span className="text-ink-muted">
              · {percent(focus.from)} of invested → {percent(focus.to)} of value · {focus.detail}
            </span>
          </>
        ) : (
          <span className="text-ink-faint">Hover or focus a holding for its numbers.</span>
        )}
      </p>
      <Legend
        items={[
          { label: `Weight grew · returned more than the overall ${signedPercent(overall)}`, color: up, line: true },
          { label: 'Weight shrank · returned less', color: down, line: true },
          { label: 'About the same', color: theme.inkMuted, line: true },
        ]}
      />
    </div>
  )
}
