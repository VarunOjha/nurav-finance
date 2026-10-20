import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { axisTick, useChartTheme } from '../charts/chartTheme'
import { ChartTooltip, Legend } from '../charts/kit'
import { money } from '../../lib/format'

export interface ProjectionSeries {
  key: string
  label: string
  color: string
}

/**
 * Projected value per plan year: segments as stacked areas (largest at the
 * bottom, 2px surface gap between them), the target as a dashed ink line and
 * the year the target is reached as a vertical rule; optional totals at the
 * other two returns as thin dotted lines. One money axis.
 */
export function ProjectionChart({
  rows,
  series,
  currency,
  fiYear,
  targetLabel = 'Target',
  height = 340,
  compact = false,
  band,
}: {
  rows: Record<string, number | null>[]
  series: ProjectionSeries[]
  currency: string
  /** Plan year (x value) where the target is reached, if any. */
  fiYear?: number | null
  targetLabel?: string
  height?: number
  compact?: boolean
  /** Legend labels for the scen_low / scen_high row values, when present. */
  band?: { low: string; high: string }
}) {
  const theme = useChartTheme()
  const tick = { ...axisTick, fill: theme.inkMuted }
  const hasTarget = rows.some((r) => r.target !== null && r.target !== undefined)
  const byY = new Map(rows.map((r) => [r.y, r]))
  const xLabel = (y: number) => {
    const r = byY.get(y)
    return r ? `${r.year}${r.age !== null && r.age !== undefined ? ` · age ${r.age}` : ''}` : String(y)
  }
  return (
    <div className="flex flex-col gap-3 min-w-0">
      <div style={{ height }} role="img" aria-label={`Projected value by ${series.length > 1 ? 'segment' : 'year'}${hasTarget ? `, with the ${targetLabel.toLowerCase()} line` : ''}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 12, right: compact ? 8 : 20, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={theme.line} />
            <XAxis
              dataKey="y"
              type="number"
              domain={[0, 'dataMax']}
              tickFormatter={(y: number) => String(byY.get(y)?.year ?? '')}
              tick={tick}
              tickLine={false}
              axisLine={{ stroke: theme.line }}
              allowDecimals={false}
              tickCount={compact ? 4 : 7}
            />
            <YAxis tickFormatter={(v: number) => money(v, currency, { compact: true })} tick={tick} tickLine={false} axisLine={false} width={compact ? 52 : 64} />
            <Tooltip
              cursor={{ stroke: theme.inkFaint }}
              content={
                <ChartTooltip
                  // The total comes from the row: summing the payload would add the target line in.
                  labelFormat={(y, row) =>
                    series.length > 1 && row ? `${xLabel(Number(y))} · total ${money(row.total as number, currency)}` : xLabel(Number(y))
                  }
                  valueFormat={(v) => money(v, currency)}
                />
              }
            />
            {series.map((s) => (
              <Area
                key={s.key}
                type="linear"
                dataKey={s.key}
                name={s.label}
                stackId="nw"
                stroke={theme.paper}
                strokeWidth={2}
                fill={s.color}
                fillOpacity={1}
                activeDot={{ r: 4, fill: s.color, stroke: theme.paper, strokeWidth: 2 }}
                isAnimationActive={false}
              />
            ))}
            {band &&
              (['scen_low', 'scen_high'] as const).map((k) => (
                <Line
                  key={k}
                  type="linear"
                  dataKey={k}
                  name={k === 'scen_low' ? band.low : band.high}
                  stroke={theme.ink}
                  strokeWidth={1.5}
                  strokeDasharray="1 4"
                  strokeLinecap="round"
                  dot={false}
                  activeDot={false}
                  isAnimationActive={false}
                />
              ))}
            {hasTarget && (
              <Line
                type="linear"
                dataKey="target"
                name={targetLabel}
                stroke={theme.ink}
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                activeDot={false}
                isAnimationActive={false}
              />
            )}
            {fiYear !== null && fiYear !== undefined && (
              <ReferenceLine x={fiYear} stroke={theme.ink} strokeWidth={1} label={{ value: 'Target', position: fiYear > (rows.length - 1) / 2 ? 'insideTopRight' : 'insideTopLeft', fill: theme.ink, ...axisTick }} />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <Legend
        items={[
          ...series.map((s) => ({ label: s.label, color: s.color })),
          ...(hasTarget ? [{ label: targetLabel, color: theme.ink, line: true }] : []),
          ...(band ? [{ label: `${band.low} / ${band.high}`, color: theme.ink, line: true }] : []),
        ]}
      />
    </div>
  )
}
