import type { ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { cn } from '../../lib/cn'
import { money, monthLabel, percent, signedMoney } from '../../lib/format'
import { axisTick, useChartTheme, type ChartTheme } from './chartTheme'
import type { Slice } from './palette'

// Shared chart pieces. Conventions (dataviz method): text stays in ink tokens,
// colour only on marks; recessive grid (horizontal lines only, no axis lines
// on values); 2px lines; thin bars with 4px rounded data ends; a 2px surface
// gap between touching fills; every chart has a hover tooltip; ≥2 series get a
// legend. Gain/loss is polarity (diverging blue ↔ red), not status.

export const chartTitle = 'font-mono text-[10px] font-medium uppercase tracking-widest text-ink-muted'

export function ChartCard({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('border border-line p-4 sm:p-5 flex flex-col gap-3 min-w-0', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className={chartTitle}>{title}</h2>
        {aside && <div className="font-mono text-[10px] text-ink-muted">{aside}</div>}
      </div>
      {children}
    </section>
  )
}

export function Swatch({ color, line = false }: { color: string; line?: boolean }) {
  return <span aria-hidden="true" className={cn('inline-block shrink-0', line ? 'w-3 h-0.5' : 'w-2.5 h-2.5 rounded-[2px]')} style={{ background: color }} />
}

export function Legend({ items, className }: { items: { label: string; color: string; line?: boolean }[]; className?: string }) {
  return (
    <ul className={cn('flex flex-wrap gap-x-4 gap-y-1 font-mono text-[10px] text-ink-muted', className)}>
      {items.map((i) => (
        <li key={i.label} className="inline-flex items-center gap-1.5">
          <Swatch color={i.color} line={i.line} /> {i.label}
        </li>
      ))}
    </ul>
  )
}

interface TooltipItem {
  name?: string | number
  value?: number | string | (number | string)[]
  color?: string
  stroke?: string
  fill?: string
  dataKey?: string | number
  payload?: Record<string, unknown>
}

/** Tooltip body for any recharts chart: label on top, one row per series. */
export function ChartTooltip({
  active,
  payload,
  label,
  labelFormat = (l) => String(l),
  valueFormat,
  total,
  swatch,
}: {
  active?: boolean
  payload?: TooltipItem[]
  label?: string | number
  labelFormat?: (label: string | number, row?: Record<string, unknown>) => ReactNode
  valueFormat: (value: number, item: TooltipItem) => ReactNode
  total?: (sum: number) => ReactNode
  /** Per-item swatch colour, for marks coloured per value (diverging bars). */
  swatch?: (item: TooltipItem) => string | undefined
}) {
  if (!active || !payload?.length) return null
  const items = payload.filter((p) => typeof p.value === 'number')
  const row = payload[0]?.payload
  const sum = items.reduce((s, p) => s + (p.value as number), 0)
  return (
    <div className="bg-paper border border-line px-3 py-2 font-mono text-[11px] text-ink shadow-[3px_3px_0_rgb(var(--ink)/0.08)] min-w-[10rem]">
      {label !== undefined && label !== '' && <p className="text-ink-muted mb-1">{labelFormat(label, row)}</p>}
      <ul className="flex flex-col gap-0.5">
        {items.map((p) => (
          <li key={String(p.dataKey ?? p.name)} className="flex items-center gap-2">
            <Swatch color={swatch?.(p) ?? (p.payload?.color as string) ?? p.color ?? p.stroke ?? p.fill ?? 'currentColor'} />
            {p.name !== undefined && <span className="text-ink-muted flex-1">{p.name}</span>}
            <span className="num ml-auto">{valueFormat(p.value as number, p)}</span>
          </li>
        ))}
      </ul>
      {total && items.length > 1 && (
        <p className="flex justify-between gap-4 border-t border-line mt-1.5 pt-1.5">
          <span className="text-ink-muted">Total</span>
          <span className="num">{total(sum)}</span>
        </p>
      )}
    </div>
  )
}

const tick = (theme: ChartTheme) => ({ ...axisTick, fill: theme.inkMuted })

/** Donut + legend list (label, value, share) — the legend doubles as the table view. */
export function AllocationDonut({ slices, currency, empty = 'Nothing yet.' }: { slices: Slice[]; currency: string; empty?: string }) {
  const theme = useChartTheme()
  if (slices.length === 0) return <p className="font-mono text-[11px] text-ink-faint">{empty}</p>
  const total = slices.reduce((s, x) => s + x.value, 0)
  return (
    <div className="flex flex-col sm:flex-row items-center sm:items-start gap-5">
      <div className="relative w-40 h-40 shrink-0" role="img" aria-label={slices.map((s) => `${s.label} ${percent(s.share)}`).join(', ')}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={slices}
              dataKey="value"
              nameKey="label"
              innerRadius="64%"
              outerRadius="100%"
              startAngle={90}
              endAngle={-270}
              stroke={theme.paper}
              strokeWidth={2}
              isAnimationActive={false}
            >
              {slices.map((s) => (
                <Cell key={s.key} fill={s.color} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip valueFormat={(v, item) => `${money(v, currency)} · ${percent((item.payload?.share as number) ?? 0)}`} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="font-mono text-[9px] uppercase tracking-widest text-ink-muted">Total</span>
          <span className="font-mono text-xs font-bold num text-ink">{money(total, currency, { compact: true })}</span>
        </div>
      </div>
      <ul className="flex-1 min-w-0 w-full flex flex-col gap-1.5">
        {slices.map((s) => (
          <li key={s.key} className="flex items-center gap-2 font-mono text-xs">
            <Swatch color={s.color} />
            <span className="text-ink truncate flex-1">{s.label}</span>
            <span className="num text-ink-muted whitespace-nowrap">{money(s.value, currency)}</span>
            <span className="num text-ink w-12 text-right">{percent(s.share)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export interface BarRow {
  key: string
  label: string
  value: number
  color: string
  detail?: string
}

/** Horizontal bars, largest first, value labelled at the bar end. */
export function RankedBars({ rows, currency }: { rows: BarRow[]; currency: string }) {
  const theme = useChartTheme()
  if (rows.length === 0) return <p className="font-mono text-[11px] text-ink-faint">Nothing yet.</p>
  return (
    <div style={{ height: rows.length * 26 + 8 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 72, bottom: 0, left: 0 }} barCategoryGap={6}>
          <XAxis type="number" hide domain={[0, 'dataMax']} />
          <YAxis type="category" dataKey="label" width={88} tick={tick(theme)} tickLine={false} axisLine={false} interval={0} />
          <Tooltip
            cursor={{ fill: theme.paperWarm }}
            content={<ChartTooltip labelFormat={(l, row) => `${l}${row?.detail ? ` · ${row.detail}` : ''}`} valueFormat={(v) => money(v, currency)} />}
          />
          <Bar dataKey="value" name="Value" radius={[0, 4, 4, 0]} maxBarSize={14} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.key} fill={r.color} />
            ))}
            <LabelList
              dataKey="value"
              position="right"
              formatter={(v: number) => money(v, currency, { compact: true })}
              style={{ ...axisTick, fill: theme.ink }}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

function endLabel(theme: ChartTheme, currency: string) {
  // Signed amount just past the bar's data end, on whichever side that is.
  // eslint-disable-next-line react/display-name
  return (props: { x?: number | string; y?: number | string; width?: number | string; height?: number | string; value?: number | string }) => {
    const x = Number(props.x ?? 0)
    const w = Number(props.width ?? 0)
    const v = Number(props.value ?? 0)
    const end = v >= 0 ? Math.max(x, x + w) : Math.min(x, x + w)
    return (
      <text
        x={end + (v >= 0 ? 4 : -4)}
        y={Number(props.y ?? 0) + Number(props.height ?? 0) / 2}
        dy="0.35em"
        textAnchor={v >= 0 ? 'start' : 'end'}
        style={{ ...axisTick, fill: theme.ink }}
      >
        {signedMoney(v, currency)}
      </text>
    )
  }
}

/** Horizontal bars diverging from zero: gains blue to the right, losses red to the left. */
export function DivergingBars({
  rows,
  currency,
  name = 'Change',
}: {
  rows: { key: string; label: string; value: number; detail?: string }[]
  currency: string
  name?: string
}) {
  const theme = useChartTheme()
  if (rows.length === 0) return <p className="font-mono text-[11px] text-ink-faint">Nothing to show.</p>
  const pos = theme.series[0]
  const neg = theme.series[7]
  const max = Math.max(...rows.map((r) => Math.abs(r.value)), 1)
  return (
    <div style={{ height: rows.length * 26 + 8 }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }} barCategoryGap={6}>
          {/* Head-room on both sides for the end labels. */}
          <XAxis type="number" hide domain={[-max * 1.7, max * 1.7]} />
          <YAxis type="category" dataKey="label" width={88} tick={tick(theme)} tickLine={false} axisLine={false} interval={0} />
          <ReferenceLine x={0} stroke={theme.inkFaint} />
          <Tooltip
            cursor={{ fill: theme.paperWarm }}
            content={<ChartTooltip labelFormat={(l, row) => `${l}${row?.detail ? ` · ${row.detail}` : ''}`} valueFormat={(v) => signedMoney(v, currency)} />}
          />
          <Bar dataKey="value" name={name} radius={[0, 4, 4, 0]} maxBarSize={14} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.key} fill={r.value >= 0 ? pos : neg} />
            ))}
            <LabelList dataKey="value" content={endLabel(theme, currency)} />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

export function DivergingLegend({ gain = 'Gain', loss = 'Loss' }: { gain?: string; loss?: string }) {
  const theme = useChartTheme()
  return (
    <Legend
      items={[
        { label: gain, color: theme.series[0] },
        { label: loss, color: theme.series[7] },
      ]}
    />
  )
}

/** Month columns diverging from zero (month-over-month change). */
export function ChangeColumns({ rows, currency, height = 176 }: { rows: { month: string; value: number | null }[]; currency: string; height?: number }) {
  const theme = useChartTheme()
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={theme.line} />
          <XAxis
            dataKey="month"
            tickFormatter={(m: string) => monthLabel(m)}
            tick={tick(theme)}
            tickLine={false}
            axisLine={{ stroke: theme.line }}
            minTickGap={12}
          />
          <YAxis tickFormatter={(v: number) => money(v, currency, { compact: true })} tick={tick(theme)} tickLine={false} axisLine={false} width={60} />
          <ReferenceLine y={0} stroke={theme.inkFaint} />
          <Tooltip
            cursor={{ fill: theme.paperWarm }}
            content={<ChartTooltip labelFormat={(m) => monthLabel(String(m), true)} valueFormat={(v) => signedMoney(v, currency)} />}
          />
          <Bar dataKey="value" name="Change" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.month} fill={(r.value ?? 0) >= 0 ? theme.series[0] : theme.series[7]} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/**
 * Monthly change columns (up blue, down red) with the trailing average pace as
 * a 2px ink line on the same money axis — how fast the total is moving and
 * whether that speed is holding.
 */
export function VelocityColumns({
  rows,
  currency,
  paceLabel,
  height = 208,
}: {
  rows: { month: string; change: number | null; pace: number | null }[]
  currency: string
  paceLabel: string
  height?: number
}) {
  const theme = useChartTheme()
  const up = theme.series[0]
  const down = theme.series[7]
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={theme.line} />
          <XAxis
            dataKey="month"
            tickFormatter={(m: string) => monthLabel(m)}
            tick={tick(theme)}
            tickLine={false}
            axisLine={{ stroke: theme.line }}
            minTickGap={12}
          />
          <YAxis tickFormatter={(v: number) => money(v, currency, { compact: true })} tick={tick(theme)} tickLine={false} axisLine={false} width={60} />
          <ReferenceLine y={0} stroke={theme.inkFaint} />
          <Tooltip
            cursor={{ fill: theme.paperWarm }}
            content={
              <ChartTooltip
                labelFormat={(m) => monthLabel(String(m), true)}
                valueFormat={(v, item) => (item.dataKey === 'pace' ? `${signedMoney(v, currency)}/mo` : signedMoney(v, currency))}
                swatch={(item) => (item.dataKey === 'change' ? ((item.value as number) >= 0 ? up : down) : theme.ink)}
              />
            }
          />
          <Bar dataKey="change" name="Change" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false}>
            {rows.map((r) => (
              <Cell key={r.month} fill={(r.change ?? 0) >= 0 ? up : down} />
            ))}
          </Bar>
          <Line
            type="monotone"
            dataKey="pace"
            name={paceLabel}
            stroke={theme.ink}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: theme.ink, stroke: theme.paper, strokeWidth: 2 }}
            connectNulls={false}
            isAnimationActive={false}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

export interface StackSeries {
  key: string
  label: string
  color: string
}

/** Stacked month columns (one stack per month), 2px surface gap between segments. */
export function StackedColumns({
  rows,
  series,
  currency,
  height = 208,
}: {
  rows: Record<string, number | string | null>[]
  series: StackSeries[]
  currency: string
  height?: number
}) {
  const theme = useChartTheme()
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={rows} margin={{ top: 4, right: 16, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={theme.line} />
          <XAxis
            dataKey="month"
            tickFormatter={(m: string) => monthLabel(m)}
            tick={tick(theme)}
            tickLine={false}
            axisLine={{ stroke: theme.line }}
            minTickGap={12}
          />
          <YAxis tickFormatter={(v: number) => money(v, currency, { compact: true })} tick={tick(theme)} tickLine={false} axisLine={false} width={60} />
          <Tooltip
            cursor={{ fill: theme.paperWarm }}
            content={
              <ChartTooltip labelFormat={(m) => monthLabel(String(m), true)} valueFormat={(v) => money(v, currency)} total={(s) => money(s, currency)} />
            }
          />
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.label}
              stackId="stack"
              fill={s.color}
              stroke={theme.paper}
              strokeWidth={1}
              maxBarSize={28}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Lines over a category x-axis (dates or months), 2px, markers at points. */
export function Lines({
  rows,
  series,
  xKey,
  xFormat,
  xLabel,
  valueFormat,
  axisFormat,
  height = 224,
  dots = false,
}: {
  rows: Record<string, number | string | null>[]
  series: StackSeries[]
  xKey: string
  xFormat: (v: string) => string
  xLabel: (v: string) => string
  valueFormat: (v: number) => string
  axisFormat: (v: number) => string
  height?: number
  dots?: boolean
}) {
  const theme = useChartTheme()
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={rows} margin={{ top: 8, right: 20, bottom: 0, left: 0 }}>
          <CartesianGrid vertical={false} stroke={theme.line} />
          <XAxis dataKey={xKey} tickFormatter={xFormat} tick={tick(theme)} tickLine={false} axisLine={{ stroke: theme.line }} minTickGap={16} />
          <YAxis tickFormatter={axisFormat} tick={tick(theme)} tickLine={false} axisLine={false} width={60} />
          <Tooltip cursor={{ stroke: theme.inkFaint }} content={<ChartTooltip labelFormat={(v) => xLabel(String(v))} valueFormat={valueFormat} />} />
          {series.map((s) => (
            <Line
              key={s.key}
              type="monotone"
              dataKey={s.key}
              name={s.label}
              stroke={s.color}
              strokeWidth={2}
              dot={dots ? { r: 4, fill: s.color, stroke: theme.paper, strokeWidth: 2 } : false}
              activeDot={{ r: 5, fill: s.color, stroke: theme.paper, strokeWidth: 2 }}
              connectNulls={false}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Tiny trend line for table cells — no axes; the title gives first → last. */
export function Sparkline({ values, title, width = 88, height = 22 }: { values: (number | null)[]; title: string; width?: number; height?: number }) {
  const theme = useChartTheme()
  const pts = values.map((v, i) => (v === null ? null : { i, v })).filter((p): p is { i: number; v: number } => p !== null)
  if (pts.length < 2) return <span className="text-ink-faint">—</span>
  const min = Math.min(...pts.map((p) => p.v))
  const max = Math.max(...pts.map((p) => p.v))
  const span = max - min || 1
  const x = (i: number) => (i / (values.length - 1)) * (width - 4) + 2
  const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4)
  const d = pts.map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`).join(' ')
  const last = pts[pts.length - 1]
  return (
    <svg width={width} height={height} role="img" aria-label={title} className="inline-block align-middle">
      <title>{title}</title>
      <path d={d} fill="none" stroke={theme.inkMuted} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(last.i)} cy={y(last.v)} r={2.5} fill={theme.ink} />
    </svg>
  )
}
