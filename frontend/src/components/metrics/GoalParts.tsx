// Building blocks shared by the Metrics views (by milestone, by bucket).
import type { ReactNode } from 'react'
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { axisTick, useChartTheme } from '../charts/chartTheme'
import { ChartCard, ChartTooltip, Legend } from '../charts/kit'
import { trimDecimal } from '../../lib/amount'
import { cn } from '../../lib/cn'
import { deltaClass, formatDate, money, monthLabel, percent, signedMoney, toNumber, todayISO } from '../../lib/format'
import type { RowStatus, Standing, TargetRow, Trajectory as TrajectoryData } from '../../types/api'

export const sectionTitle = 'font-mono text-[10px] font-medium uppercase tracking-widest text-ink-muted'

type Tone = 'ink' | 'muted' | 'error' | 'solid'

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: Tone }) {
  return (
    <span
      className={cn(
        'inline-block font-mono text-[9px] uppercase tracking-widest border px-1.5 py-0.5 whitespace-nowrap',
        tone === 'ink' && 'border-ink text-ink',
        tone === 'solid' && 'border-ink bg-ink text-paper',
        tone === 'error' && 'border-error text-error',
        tone === 'muted' && 'border-line text-ink-muted',
      )}
    >
      {children}
    </span>
  )
}

const STANDING_LABEL: Record<Standing, string> = { ahead: 'Ahead', on_track: 'On track', behind: 'Behind' }
/** A target row's state in one word: Achieved / Missed / Ahead / On track / Behind / Not started. */
export function RowBadge({ row }: { row: Pick<TargetRow, 'status' | 'standing'> }) {
  if (row.status === 'achieved') return <Badge tone="solid">Achieved</Badge>
  if (row.status === 'missed') return <Badge tone="error">Missed</Badge>
  if (!row.standing) return <Badge>Not started</Badge>
  return <Badge tone={row.standing === 'behind' ? 'error' : 'ink'}>{STANDING_LABEL[row.standing]}</Badge>
}

/** Value reached: on the date once it has passed, else today. */
function reached(row: Pick<TargetRow, 'value_on_date' | 'current'>): number {
  return toNumber(row.value_on_date ?? row.current) ?? 0
}

/** How far above its target the bucket is (exact amount), or null when it isn't. */
export function overBy(row: Pick<TargetRow, 'value_on_date' | 'current' | 'amount'>): number | null {
  const diff = reached(row) - (toNumber(row.amount) ?? 0)
  return diff > 0 ? diff : null
}

/** How far short a missed target ended up, or null. */
export function shortBy(row: Pick<TargetRow, 'status' | 'value_on_date' | 'current' | 'amount'>): number | null {
  if (row.status !== 'missed') return null
  const diff = (toNumber(row.amount) ?? 0) - reached(row)
  return diff > 0 ? diff : null
}

export const STATUS_WORD: Record<RowStatus, string> = { achieved: 'Achieved', missed: 'Missed', open: 'Open' }

/** "3 years 5 months", "1 year", "8 months". */
export function yearsMonthsText(m: string | null): string {
  const n = toNumber(m)
  if (n === null) return '—'
  if (n < 1) return 'under a month'
  let years = Math.floor(n / 12)
  let months = Math.round(n - years * 12)
  if (months === 12) {
    years += 1
    months = 0
  }
  const part = (k: number, word: string) => (k ? `${k} ${word}${k === 1 ? '' : 's'}` : '')
  return [part(years, 'year'), part(months, 'month')].filter(Boolean).join(' ')
}

/** Progress toward a target, with a tick where the needed path says the bucket should be today. */
export function ProgressBar({ row, color, className }: { row: TargetRow; color: string; className?: string }) {
  const pct = Math.min(1, Math.max(0, (toNumber(row.progress_pct) ?? 0) / 100))
  const required = toNumber(row.required_now)
  const amount = toNumber(row.amount) || 1
  return (
    <div className={cn('relative h-2.5 bg-paper-warm', className)} role="img" aria-label={`${percent(pct)} of ${money(row.amount, row.currency)}`}>
      <div className="h-full" style={{ width: `${pct * 100}%`, background: row.status === 'missed' ? 'rgb(var(--error))' : color }} />
      {required !== null && (
        <div
          className="absolute top-[-3px] bottom-[-3px] w-0.5 bg-ink"
          style={{ left: `${Math.min(100, Math.max(0, (required / amount) * 100))}%` }}
          title={`Where the needed path is today: ${money(required, row.currency)}`}
        />
      )}
    </div>
  )
}

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[9px] uppercase tracking-widest text-ink-muted">{label}</dt>
      <dd className="font-mono text-sm font-bold num text-ink truncate">{value}</dd>
      {sub && <dd className="font-mono text-[10px] text-ink-muted">{sub}</dd>}
    </div>
  )
}

/** The numbers behind one target: where it stands, what it needs, when it gets there. */
export function TargetStats({ row, color }: { row: TargetRow; color: string }) {
  const cur = row.currency
  const pct = Math.min(1, Math.max(0, (toNumber(row.progress_pct) ?? 0) / 100))
  const required = toNumber(row.required_now)
  const current = toNumber(row.current) ?? 0
  const noPace = row.pace_3m === null && row.pace_6m === null && row.pace_12m === null
  const late = (d: string | null) => (d ? (d > row.target_date ? 'late' : 'on time') : null)
  const title = `${row.milestone_name} · ${row.bucket.name} · ${money(row.amount, cur, { compact: true })} by ${formatDate(row.target_date)}`

  if (row.status !== 'open') {
    const had = row.value_on_date ?? row.current
    const over = overBy(row)
    const short = shortBy(row)
    return (
      <ChartCard title={title} aside={<RowBadge row={row} />}>
        <div className="flex items-baseline justify-between gap-3 font-mono">
          <span className="text-2xl font-bold num text-ink">{money(had, cur)}</span>
          <span className="text-xs text-ink-muted num">
            {percent(pct)} of {money(row.amount, cur)}
          </span>
        </div>
        <ProgressBar row={row} color={color} />
        <p className="font-mono text-[11px] text-ink-muted">
          {row.value_on_date !== null
            ? `Value on ${formatDate(row.target_date)}: ${money(row.value_on_date, cur)}.`
            : `Already at ${money(row.current, cur)}, ahead of the ${formatDate(row.target_date)} date.`}
          {over !== null && <span className="text-ink"> Over the target by {money(over, cur, { compact: true })}.</span>}
          {short !== null && <span className="text-error"> Short of the target by {money(short, cur, { compact: true })}.</span>}
        </p>
      </ChartCard>
    )
  }

  return (
    <ChartCard title={title} aside={<RowBadge row={row} />}>
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-3 font-mono">
          <span className="text-2xl font-bold num text-ink">{money(row.current, cur)}</span>
          <span className="text-xs text-ink-muted num">
            {percent(pct)} of {money(row.amount, cur)}
          </span>
        </div>
        <ProgressBar row={row} color={color} />
        {required !== null ? (
          <p className="font-mono text-[10px] text-ink-muted">
            Tick = where the needed path says you should be today ({money(required, cur, { compact: true })}){' '}
            <span className={deltaClass(current - required)}>{signedMoney(current - required, cur, { compact: true })}</span>
          </p>
        ) : (
          <p className="font-mono text-[10px] text-ink-muted">Measured from {formatDate(row.start_date)}, so there is no standing yet.</p>
        )}
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 pt-2 border-t border-line">
        <Stat label="Still to go" value={money(row.gap, cur)} />
        <Stat label="Time left" value={yearsMonthsText(row.months_left)} sub={formatDate(row.target_date)} />
        <Stat label="Needed / month" value={row.need_flat ? money(row.need_flat, cur) : '—'} sub="flat · gap ÷ months" />
        {row.expected_return !== null && (
          <Stat
            label={`Needed at ${trimDecimal(row.expected_return)}%/yr`}
            value={row.need_with_return ? money(row.need_with_return, cur) : '—'}
            sub="today's value compounds too"
          />
        )}
        <Stat
          label="At current pace"
          value={row.projected_pace_date ? formatDate(row.projected_pace_date) : noPace ? '—' : 'not on this pace'}
          sub={row.projected_pace_date ? (late(row.projected_pace_date) ?? undefined) : noPace ? 'needs 3+ months of history' : 'pace is flat or falling'}
        />
        {row.expected_return !== null && (
          <Stat
            label="On growth alone"
            value={row.projected_return_date ? formatDate(row.projected_return_date) : '—'}
            sub={row.projected_return_date ? `${late(row.projected_return_date)} · no new money` : 'no new money'}
          />
        )}
      </dl>
    </ChartCard>
  )
}

interface Paces {
  pace_3m: string | null
  pace_6m: string | null
  pace_12m: string | null
}

/** Actual change per month over 3/6/12 months against what the target needs. */
export function PaceCheck({
  paces,
  need,
  withReturn,
  currency,
  trajectory,
  color,
}: {
  paces: Paces
  need: string | null
  withReturn: boolean
  currency: string
  trajectory: TrajectoryData
  color: string
}) {
  const theme = useChartTheme()
  const needed = toNumber(need)
  const rows = [
    { label: 'Needed', value: needed, color: theme.ink },
    { label: 'Last 3 months', value: toNumber(paces.pace_3m), color },
    { label: 'Last 6 months', value: toNumber(paces.pace_6m), color },
    { label: 'Last 12 months', value: toNumber(paces.pace_12m), color },
  ]
  const max = Math.max(1, ...rows.map((r) => Math.abs(r.value ?? 0)))
  const firstSeen = trajectory.months.find((_, i) => trajectory.actual[i] !== null)
  return (
    <ChartCard title="Pace check · per month" aside={withReturn ? 'need allows for expected return' : undefined}>
      <ul className="flex flex-col gap-2.5">
        {rows.map((r) => {
          const ok = needed !== null && r.label !== 'Needed' && r.value !== null ? r.value >= needed : null
          return (
            <li key={r.label} className="grid grid-cols-[7rem_minmax(0,1fr)_auto] items-center gap-3 font-mono text-[11px]">
              <span className="text-ink-muted">{r.label}</span>
              <span className="h-2 bg-paper-warm relative" aria-hidden="true">
                {r.value !== null && r.value > 0 && (
                  <span className="absolute inset-y-0 left-0 rounded-r" style={{ width: `${(r.value / max) * 100}%`, background: r.color }} />
                )}
                {needed !== null && needed > 0 && r.label !== 'Needed' && (
                  <span className="absolute -top-1 -bottom-1 w-0.5 bg-ink" style={{ left: `${(needed / max) * 100}%` }} />
                )}
              </span>
              <span className={cn('num text-right w-32', r.value !== null && r.value < 0 ? 'text-error' : 'text-ink')}>
                {r.value === null ? '—' : r.label === 'Needed' ? money(r.value, currency) : signedMoney(r.value, currency)}
                {ok !== null && <span className={cn('ml-1.5', ok ? 'text-ink' : 'text-error')}>{ok ? '✓' : '✗'}</span>}
              </span>
            </li>
          )
        })}
      </ul>
      {rows.slice(1).every((r) => r.value === null) && (
        <p className="font-mono text-[11px] text-ink-muted">
          No pace yet: your balances only go back to {firstSeen ? monthLabel(firstSeen, true) : 'this month'}. A pace needs a recorded value at least 3 months ago
          (backdated entries count).
        </p>
      )}
      <p className="font-mono text-[10px] text-ink-faint">
        Pace = how much the bucket actually changed per month (new money and market moves). ✓ = fast enough for the target.
      </p>
    </ChartCard>
  )
}

/** A text label beside the last point of a line (recharts calls this for every point). */
function endLabel(last: number, text: string, fill: string, dy = 0) {
  function EndLabel(props: { x?: number | string; y?: number | string; index?: number }) {
    if (props.index !== last || props.x === undefined || props.y === undefined) return <g />
    return (
      <text x={Number(props.x) + 8} y={Number(props.y) + dy} dy={3} fill={fill} fontSize={10} fontFamily="ui-monospace, monospace">
        {text}
      </text>
    )
  }
  return EndLabel
}

function lastIndex(xs: (number | null)[]): number {
  for (let i = xs.length - 1; i >= 0; i--) if (xs[i] !== null) return i
  return -1
}

interface ChartMark {
  key: string
  date: string
  amount: string
  label: string
  status: RowStatus
}

/** Month-end actuals, the needed path, and the two estimates, with the targets as circles. */
export function TrajectoryChart({
  trajectory: tr,
  color,
  currency,
  marks,
  footnote,
}: {
  trajectory: TrajectoryData
  color: string
  currency: string
  marks: ChartMark[]
  footnote: string
}) {
  const theme = useChartTheme()
  const cur = currency
  const rows = tr.months.map((month, i) => ({
    month,
    actual: toNumber(tr.actual[i]),
    required: toNumber(tr.required[i]),
    pace: toNumber(tr.projection_pace[i]),
    growth: toNumber(tr.projection_return[i]),
  }))
  type Key = 'actual' | 'required' | 'pace' | 'growth'
  const last = Object.fromEntries((['actual', 'required', 'pace', 'growth'] as Key[]).map((k) => [k, lastIndex(rows.map((r) => r[k]))])) as Record<Key, number>
  const at = (k: Key) => (last[k] >= 0 ? rows[last[k]][k] : null)
  const hasPace = last.pace >= 0
  const hasGrowth = last.growth >= 0
  const hasRequired = last.required >= 0
  // With only a few month-ends recorded a bare line is invisible (one point) or easy to miss.
  const fewActuals = rows.filter((r) => r.actual !== null).length < 4
  const today = todayISO().slice(0, 7)
  const end = tr.months[tr.months.length - 1]
  const short = (v: number | null | undefined) => money(v ?? null, cur, { compact: true })

  // End labels of lines finishing in the same month at nearly the same height get pushed apart.
  const top = Math.max(1, ...rows.map((r) => Math.max(r.actual ?? 0, r.required ?? 0, r.pace ?? 0, r.growth ?? 0)))
  const close = (a: Key, b: Key) => last[a] >= 0 && last[a] === last[b] && Math.abs((at(a) ?? 0) - (at(b) ?? 0)) < top * 0.05
  const nudge = { pace: 0, growth: 0 }
  if (close('required', 'pace')) nudge.pace = 12
  if (close('required', 'growth')) nudge.growth = 12
  if (close('pace', 'growth')) nudge.growth = nudge.pace + 12

  // Solid = what happened and what's needed; dashed = estimates of what will happen.
  const series = [
    { label: 'Actual', color, line: true },
    ...(hasRequired ? [{ label: 'Needed path', color: theme.ink, line: true }] : []),
    ...(hasPace ? [{ label: 'At current pace', color, line: true, dashed: true }] : []),
    ...(hasGrowth ? [{ label: 'Growth only (no new money)', color: theme.inkMuted, line: true, dashed: true }] : []),
  ]

  return (
    <ChartCard title="Trajectory · month-end" aside={<Legend items={series} />} className="lg:col-span-2">
      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 24, right: 124, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={theme.line} />
            {tr.months.includes(today) && today !== end && (
              <ReferenceArea
                x1={today}
                x2={end}
                fill={theme.paperWarm}
                fillOpacity={0.7}
                stroke="none"
                label={{ value: 'today → projected', position: 'insideTopLeft', fill: theme.inkMuted, fontSize: 10 }}
              />
            )}
            <XAxis
              dataKey="month"
              tickFormatter={(m: string) => monthLabel(m)}
              tick={{ ...axisTick, fill: theme.inkMuted }}
              tickLine={false}
              axisLine={{ stroke: theme.line }}
              minTickGap={24}
            />
            <YAxis tickFormatter={(v: number) => short(v)} tick={{ ...axisTick, fill: theme.inkMuted }} tickLine={false} axisLine={false} width={64} domain={[0, 'auto']} />
            <Tooltip cursor={{ stroke: theme.inkFaint }} content={<ChartTooltip labelFormat={(m) => monthLabel(String(m), true)} valueFormat={(v) => money(v, cur)} />} />
            {tr.months.includes(today) && <ReferenceLine x={today} stroke={theme.inkMuted} />}
            {hasRequired && (
              <Line
                dataKey="required"
                name="Needed path"
                stroke={theme.ink}
                strokeWidth={1.5}
                dot={false}
                connectNulls
                isAnimationActive={false}
                label={endLabel(last.required, 'needed', theme.ink)}
              />
            )}
            {hasGrowth && (
              <Line
                dataKey="growth"
                name="Growth only"
                stroke={theme.inkMuted}
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                isAnimationActive={false}
                label={endLabel(last.growth, `growth only ${short(at('growth'))}`, theme.inkMuted, nudge.growth)}
              />
            )}
            {hasPace && (
              <Line
                dataKey="pace"
                name="At current pace"
                stroke={color}
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                isAnimationActive={false}
                label={endLabel(last.pace, `at pace ${short(at('pace'))}`, theme.ink, nudge.pace)}
              />
            )}
            <Line
              dataKey="actual"
              name="Actual"
              stroke={color}
              strokeWidth={2.5}
              dot={fewActuals ? { r: 4, fill: color, stroke: theme.paper, strokeWidth: 2 } : false}
              activeDot={{ r: 5, fill: color, stroke: theme.paper, strokeWidth: 2 }}
              isAnimationActive={false}
              label={endLabel(last.actual, short(at('actual')), theme.ink, 14)}
            />
            {marks.map((m) => {
              const month = m.date.slice(0, 7)
              if (!tr.months.includes(month)) return null
              return (
                <ReferenceDot
                  key={m.key}
                  x={month}
                  y={toNumber(m.amount) ?? 0}
                  r={6}
                  fill={m.status === 'achieved' ? color : theme.paper}
                  stroke={m.status === 'missed' ? theme.error : theme.ink}
                  strokeWidth={2}
                  ifOverflow="extendDomain"
                  label={{ value: `${m.label} ${short(toNumber(m.amount))}`, position: 'top', offset: 10, fill: theme.ink, fontSize: 10 }}
                />
              )
            })}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <p className="font-mono text-[10px] text-ink-faint">{footnote}</p>
    </ChartCard>
  )
}
