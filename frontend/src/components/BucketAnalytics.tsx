import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { AllocationDonut, ChartCard, Legend, Lines, Sparkline, StackedColumns, Swatch } from './charts/kit'
import { useChartTheme } from './charts/chartTheme'
import { Segmented, Table, onlyBelow, showFrom, td, th } from './ui/Primitives'
import { bucketColor, UNASSIGNED } from '../lib/buckets'
import { cn } from '../lib/cn'
import { deltaClass, money, monthLabel, percent, signedMoney, signedPercent, toNumber } from '../lib/format'
import type { BucketRow, Overview } from '../types/api'

type View = 'lines' | 'stacked'

const sectionTitle = 'font-mono text-[10px] font-medium uppercase tracking-widest text-ink-muted'

interface Meta {
  key: string
  label: string
  color: string
  archived: boolean
}

function useMeta(data: Overview): (row: BucketRow) => Meta {
  const theme = useChartTheme()
  const byId = new Map(data.buckets.buckets.map((b) => [b.id, b]))
  return (row) => {
    const b = row.bucket_id ? byId.get(row.bucket_id) : undefined
    return {
      key: row.bucket_id ?? 'unassigned',
      label: b?.name ?? UNASSIGNED,
      color: b ? bucketColor(theme, b.color) : theme.inkFaint,
      archived: !!b?.archived,
    }
  }
}

const paceCell = (v: string | null, currency: string) => <span className={deltaClass(v)}>{v === null ? '—' : `${signedMoney(v, currency, { compact: true })}/mo`}</span>

function VelocityTable({ rows, currency, metaOf, months }: { rows: BucketRow[]; currency: string; metaOf: (r: BucketRow) => Meta; months: string[] }) {
  const [open, setOpen] = useState<string | null>(null)
  return (
    <Table>
      <thead>
        <tr>
          <th className={th}>Bucket</th>
          <th className={cn(th, 'text-right')}>Today</th>
          <th className={cn(th, 'text-right', showFrom.sm)}>Share</th>
          <th className={cn(th, 'text-right', showFrom.md)}>MoM</th>
          <th className={cn(th, 'text-right', showFrom.lg)}>Pace 3M</th>
          <th className={cn(th, 'text-right', showFrom.md)}>Pace 6M</th>
          <th className={cn(th, 'text-right', showFrom.xl)}>Pace 12M</th>
          <th className={cn(th, 'text-right', showFrom.lg)}>In range</th>
          <th className={cn(th, showFrom.xl)}>Trend</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const m = metaOf(r)
          const expanded = open === m.key
          return (
            <Fragment key={m.key}>
              <tr className="cursor-pointer hover:bg-paper-warm/60" onClick={() => setOpen(expanded ? null : m.key)}>
                <td className={cn(td, 'whitespace-normal')}>
                  <button
                    type="button"
                    className="inline-flex items-center gap-2 text-left focus:outline-none focus-visible:underline"
                    aria-expanded={expanded}
                    aria-label={`${m.label}: ${expanded ? 'hide' : 'show'} the accounts feeding it`}
                    onClick={(e) => {
                      e.stopPropagation()
                      setOpen(expanded ? null : m.key)
                    }}
                  >
                    {expanded ? <ChevronDown className="w-3 h-3 text-ink-muted" aria-hidden="true" /> : <ChevronRight className="w-3 h-3 text-ink-muted" aria-hidden="true" />}
                    <Swatch color={m.color} />
                    <span className="text-ink">{m.label}</span>
                    {m.archived && <span className="text-[9px] uppercase tracking-widest text-ink-muted">archived</span>}
                  </button>
                  <div className={cn('text-[10px] text-ink-muted mt-0.5 pl-5', onlyBelow.md)}>
                    {percent(r.share)} · 6M {r.pace_6m === null ? '—' : `${signedMoney(r.pace_6m, currency, { compact: true })}/mo`}
                  </div>
                </td>
                <td className={cn(td, 'text-right num')}>{money(r.current, currency)}</td>
                <td className={cn(td, 'text-right num text-ink-muted', showFrom.sm)}>{percent(r.share)}</td>
                <td className={cn(td, 'text-right num', showFrom.md, deltaClass(r.change_1m))}>{r.change_1m === null ? '—' : signedMoney(r.change_1m, currency, { compact: true })}</td>
                <td className={cn(td, 'text-right num', showFrom.lg)}>{paceCell(r.pace_3m, currency)}</td>
                <td className={cn(td, 'text-right num', showFrom.md)}>{paceCell(r.pace_6m, currency)}</td>
                <td className={cn(td, 'text-right num', showFrom.xl)}>{paceCell(r.pace_12m, currency)}</td>
                <td className={cn(td, 'text-right num', showFrom.lg, deltaClass(r.growth_pct))}>{r.growth_pct === null ? '—' : signedPercent(Number(r.growth_pct) / 100)}</td>
                <td className={cn(td, showFrom.xl)}>
                  <Sparkline
                    values={r.values.map(toNumber)}
                    title={`${m.label}: ${monthLabel(months[0])} ${money(r.values.find((v) => v !== null) ?? null, currency, { compact: true })} → ${money(r.current, currency, { compact: true })}`}
                  />
                </td>
              </tr>
              {expanded && (
                <tr>
                  <td colSpan={9} className={cn(td, 'bg-paper-warm/40 whitespace-normal')}>
                    {r.sources.length === 0 ? (
                      <p className="text-[11px] text-ink-muted">Nothing in this bucket today.</p>
                    ) : (
                      <ul className="flex flex-col gap-1 pl-5">
                        {r.sources.map((s) => (
                          <li key={s.account_id} className="flex items-baseline gap-3 text-[11px]">
                            <Link to={`/accounts/${s.account_id}`} className="text-ink hover:underline truncate min-w-0 flex-1">
                              {s.name}
                            </Link>
                            <span className="text-ink-muted num">{Number(s.percent).toLocaleString(undefined, { maximumFractionDigits: 2 })}%</span>
                            <span className="text-ink num w-28 text-right">{money(s.value, currency)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              )}
            </Fragment>
          )
        })}
      </tbody>
    </Table>
  )
}

/** Analytics → Buckets: where the money is meant for, per currency, and how fast each bucket grows. */
export function BucketAnalytics({ data }: { data: Overview }) {
  const metaOf = useMeta(data)
  const [view, setView] = useState<View>('lines')
  const groups = data.buckets.currencies

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className={sectionTitle}>Buckets</h2>
          <p className="font-mono text-[10px] text-ink-muted">
            Each account&apos;s money shared out by its split in force that month (portfolios follow their brokerage account). Pace = average change per
            month, market moves included. Click a bucket to see which accounts feed it.
          </p>
        </div>
        <Segmented
          label="Timeline view"
          value={view}
          onChange={setView}
          options={[
            { value: 'lines', label: 'Lines' },
            { value: 'stacked', label: 'Stacked' },
          ]}
        />
      </div>
      {groups.length === 0 ? (
        <p className="font-mono text-[11px] text-ink-muted">No balances yet.</p>
      ) : (
        groups.map((g) => {
          const metas = g.rows.map(metaOf)
          const slices = g.rows
            .map((r, i) => ({ key: metas[i].key, label: metas[i].label, value: toNumber(r.current) ?? 0, share: toNumber(r.share) ?? 0, color: metas[i].color }))
            .filter((s) => s.value > 0)
          const series = metas.map((m, i) => ({ key: `b${i}`, label: m.label, color: m.color }))
          const rows = data.months.map((month, k) => {
            const row: Record<string, string | number | null> = { month }
            g.rows.forEach((r, i) => (row[`b${i}`] = toNumber(r.values[k]) ?? (view === 'stacked' ? 0 : null)))
            return row
          })
          const unassigned = g.rows.find((r) => r.bucket_id === null)
          return (
            <div key={g.currency} className="flex flex-col gap-4">
              <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-4">
                <ChartCard
                  title={`${g.currency} · today`}
                  aside={unassigned && toNumber(unassigned.current) ? <span>{percent(unassigned.share)} unassigned</span> : undefined}
                >
                  <AllocationDonut slices={slices} currency={g.currency} empty="Nothing held today." />
                </ChartCard>
                <ChartCard title={`${g.currency} · month-end by bucket`} aside={series.length > 1 ? <Legend items={series.map((s) => ({ ...s, line: view === 'lines' }))} /> : undefined}>
                  {view === 'lines' ? (
                    <Lines
                      rows={rows}
                      series={series}
                      xKey="month"
                      xFormat={(m) => monthLabel(m)}
                      xLabel={(m) => monthLabel(m, true)}
                      valueFormat={(v) => money(v, g.currency)}
                      axisFormat={(v) => money(v, g.currency, { compact: true })}
                      height={208}
                    />
                  ) : (
                    <StackedColumns rows={rows} series={series} currency={g.currency} />
                  )}
                </ChartCard>
              </div>
              <VelocityTable rows={g.rows} currency={g.currency} metaOf={metaOf} months={data.months} />
            </div>
          )
        })
      )}
    </section>
  )
}
