import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { apiErrorMessage } from '../api/client'
import { BucketAnalytics } from '../components/BucketAnalytics'
import { axisTick, useChartTheme, type ChartTheme } from '../components/charts/chartTheme'
import { AllocationDonut, ChartCard, ChartTooltip, Legend, Lines, VelocityColumns } from '../components/charts/kit'
import { ACCOUNT_TYPE_ORDER, ALLOCATION_CLASS_ORDER, colorSlices, nameColors, slotColors } from '../components/charts/palette'
import { Empty, ErrorBox, Loading, Page, PageHeader, Segmented } from '../components/ui/Primitives'
import { useWorkspace } from '../context/WorkspaceContext'
import { useOverview } from '../hooks/queries'
import { cn } from '../lib/cn'
import { ACCOUNT_TYPE_LABELS, ASSET_CLASS_LABELS, arrow, deltaClass, money, monthLabel, percent, signedMoney, signedPercent, toNumber } from '../lib/format'
import { compoundMonthlyRate, monthlyChanges, PACE_WINDOW, rollingMean, summarise } from '../lib/velocity'
import type { AnalyticsRange, CurrencyAllocation, CurrencySeries, Overview, TopAsset } from '../types/api'

type Scope = 'both' | 'accounts' | 'portfolios'
type AllocationTab = 'by_type' | 'by_asset_class'

const RANGE_OPTIONS: { value: AnalyticsRange; label: string }[] = [
  { value: '6m', label: '6M' },
  { value: '1y', label: '1Y' },
  { value: '3y', label: '3Y' },
  { value: 'all', label: 'All' },
]

const SCOPE_OPTIONS: { value: Scope; label: string }[] = [
  { value: 'accounts', label: 'Accounts' },
  { value: 'portfolios', label: 'Portfolios' },
  { value: 'both', label: 'Both' },
]

const sectionTitle = 'font-mono text-[10px] font-medium uppercase tracking-widest text-ink-muted'

function changeOf(current: string | null, base: string | null): { abs: number | null; pct: number | null } {
  const c = toNumber(current)
  const b = toNumber(base)
  if (c === null || b === null) return { abs: null, pct: null }
  return { abs: c - b, pct: b !== 0 ? (c - b) / Math.abs(b) : null }
}

function Change({ label, current, base, currency }: { label: string; current: string | null; base: string | null; currency: string }) {
  const { abs, pct } = changeOf(current, base)
  return (
    <p className="font-mono text-[10px] text-ink-muted">
      <span className="uppercase tracking-widest">{label}</span>{' '}
      {abs === null ? (
        '—'
      ) : (
        <span className={deltaClass(abs)}>
          {arrow(abs)} {signedMoney(abs, currency)} {pct !== null && `(${signedPercent(pct)})`}
        </span>
      )}
    </p>
  )
}

function CurrencyCard({ data, months, scope, theme }: { data: CurrencySeries; months: string[]; scope: Scope; theme: ChartTheme }) {
  const current = scope === 'accounts' ? data.current_accounts : scope === 'portfolios' ? data.current_portfolios : data.current_total
  const rows = months.map((m, i) => ({
    month: m,
    accounts: toNumber(data.accounts[i]) ?? 0,
    portfolios: toNumber(data.portfolios[i]) ?? 0,
  }))
  const fmt = (v: number) => money(v, data.currency, { compact: true })
  return (
    <section className="border border-line p-4 flex flex-col gap-3 min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-mono text-xs uppercase tracking-widest text-ink">{data.currency}</h2>
        <span className="font-mono text-[10px] text-ink-muted">
          {data.account_count} acct · {data.portfolio_count} port
        </span>
      </div>
      <p className="font-mono text-2xl font-bold num leading-none text-ink truncate">{money(current, data.currency)}</p>
      {scope === 'both' ? (
        <div className="flex flex-col gap-1">
          <Change label="MoM" current={data.current_total} base={data.last_month_total} currency={data.currency} />
          <Change label="YoY" current={data.current_total} base={data.year_ago_total} currency={data.currency} />
        </div>
      ) : (
        <p className="font-mono text-[10px] text-ink-muted">MoM / YoY shown for Both</p>
      )}
      <div className="h-44" role="img" aria-label={`${data.currency} month-end values, ${months.length} months`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={theme.line} />
            <XAxis
              dataKey="month"
              tickFormatter={(m: string) => monthLabel(m)}
              tick={{ ...axisTick, fill: theme.inkMuted }}
              tickLine={false}
              axisLine={{ stroke: theme.line }}
              minTickGap={12}
            />
            <YAxis tickFormatter={fmt} tick={{ ...axisTick, fill: theme.inkMuted }} tickLine={false} axisLine={false} width={56} />
            <Tooltip
              cursor={{ fill: theme.paperWarm }}
              content={
                <ChartTooltip
                  labelFormat={(m) => monthLabel(String(m), true)}
                  valueFormat={(v) => money(v, data.currency)}
                  total={(v) => money(v, data.currency)}
                />
              }
            />
            {scope !== 'portfolios' && (
              <Bar
                dataKey="accounts"
                name="Accounts"
                stackId="v"
                fill={theme.series[0]}
                stroke={theme.paper}
                strokeWidth={1}
                maxBarSize={28}
                isAnimationActive={false}
              />
            )}
            {scope !== 'accounts' && (
              <Bar
                dataKey="portfolios"
                name="Portfolios"
                stackId="v"
                fill={theme.series[1]}
                stroke={theme.paper}
                strokeWidth={1}
                maxBarSize={28}
                isAnimationActive={false}
              />
            )}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {scope === 'both' && (
        <Legend
          items={[
            { label: 'Accounts', color: theme.series[0] },
            { label: 'Portfolios', color: theme.series[1] },
          ]}
        />
      )}
    </section>
  )
}

function scopeValues(c: CurrencySeries, scope: Scope): (number | null)[] {
  return (scope === 'accounts' ? c.accounts : scope === 'portfolios' ? c.portfolios : c.total).map(toNumber)
}

function VelocityStat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: number | null }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[9px] uppercase tracking-widest text-ink-muted">{label}</dt>
      <dd className={cn('font-mono text-sm font-bold num truncate', tone === undefined ? 'text-ink' : deltaClass(tone))}>{value}</dd>
      {sub && <dd className="font-mono text-[10px] text-ink-muted truncate">{sub}</dd>}
    </div>
  )
}

// How fast wealth is growing, per currency. Rates are comparable across
// currencies, amounts are not — so one shared % chart, then a card per currency.
function VelocitySection({ data, scope, columns }: { data: Overview; scope: Scope; columns: string }) {
  const theme = useChartTheme()
  const label = scope === 'accounts' ? 'accounts' : scope === 'portfolios' ? 'portfolios' : 'accounts + portfolios'
  const colorOf = nameColors(
    theme,
    data.currencies.map((c) => c.currency),
  )
  const perCurrency = data.currencies.map((c) => {
    const values = scopeValues(c, scope)
    const change = monthlyChanges(values)
    return { c, values, change, pace: rollingMean(change), rate: compoundMonthlyRate(values), summary: summarise(values) }
  })
  const rateRows = data.months.map((month, i) => ({ month, ...Object.fromEntries(perCurrency.map((p) => [p.c.currency, p.rate[i]])) }))
  const rateSeries = perCurrency.map((p) => ({ key: p.c.currency, label: p.c.currency, color: colorOf(p.c.currency) ?? theme.inkMuted }))
  const hasRates = perCurrency.some((p) => p.rate.some((r) => r !== null))
  const paceLabel = `${PACE_WINDOW}-month pace`

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className={sectionTitle}>Growth velocity · {label}</h2>
        <p className="font-mono text-[10px] text-ink-muted">
          How fast the total is growing. Change includes saving, spending and market moves. Pace is the average change over the last {PACE_WINDOW} months.
        </p>
      </div>

      <ChartCard
        title={`Growth rate · % per month, compounded over ${PACE_WINDOW} months`}
        aside={hasRates ? <Legend items={rateSeries.map((s) => ({ label: s.label, color: s.color, line: true }))} /> : undefined}
      >
        {hasRates ? (
          <Lines
            rows={rateRows}
            series={rateSeries}
            xKey="month"
            xFormat={(m) => monthLabel(m)}
            xLabel={(m) => monthLabel(m, true)}
            valueFormat={(v) => `${signedPercent(v, 2)} / mo`}
            axisFormat={(v) => signedPercent(v, 1)}
          />
        ) : (
          <p className="font-mono text-[11px] text-ink-muted py-6">
            Needs at least {PACE_WINDOW + 1} months of history with a positive total. Try a longer range.
          </p>
        )}
      </ChartCard>

      <div className={cn('grid grid-cols-1 gap-4', columns)}>
        {perCurrency.map(({ c, change, pace, summary: s }) => {
          const cur = c.currency
          const trend = s.acceleration === null ? undefined : s.acceleration > 0 ? 'speeding up' : s.acceleration < 0 ? 'slowing down' : 'steady'
          const rows = data.months.map((month, i) => ({ month, change: change[i], pace: pace[i] })).slice(1)
          return (
            <ChartCard
              key={cur}
              title={cur}
              aside={
                <Legend
                  items={[
                    { label: 'Up', color: theme.series[0] },
                    { label: 'Down', color: theme.series[7] },
                    { label: paceLabel, color: theme.ink, line: true },
                  ]}
                />
              }
            >
              <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-b border-line pb-3">
                <VelocityStat
                  label={`Pace · last ${PACE_WINDOW} mo`}
                  value={s.pace === null ? '—' : `${signedMoney(s.pace, cur, { compact: true })}/mo`}
                  tone={s.pace}
                  sub={s.monthlyRate === null ? undefined : `${signedPercent(s.monthlyRate, 2)} a month`}
                />
                <VelocityStat
                  label={`vs prior ${PACE_WINDOW} mo`}
                  value={s.acceleration === null ? '—' : `${arrow(s.acceleration)} ${signedMoney(s.acceleration, cur, { compact: true })}/mo`.trim()}
                  tone={s.acceleration}
                  sub={trend}
                />
                <VelocityStat
                  label="Growth · this range"
                  value={signedPercent(s.growth)}
                  tone={s.growth}
                  sub={s.span ? `over ${s.span} month${s.span === 1 ? '' : 's'}` : undefined}
                />
                <VelocityStat
                  label="Annualised"
                  value={signedPercent(s.annualised)}
                  tone={s.annualised}
                  sub={s.annualised === null ? 'needs 3+ months' : 'compound, per year'}
                />
              </dl>
              <VelocityColumns rows={rows} currency={cur} paceLabel={paceLabel} />
            </ChartCard>
          )
        })}
      </div>
    </section>
  )
}

// Account balances in "What it's in": deposits are Cash; investment and retirement
// balances are invested in something not recorded, so they get their own slice.
const ALLOCATION_CLASS_LABELS: Record<string, string> = { ...ASSET_CLASS_LABELS, unclassified: 'Fund · unclassified', property: 'Property & assets' }

function labelFor(tab: AllocationTab, label: string): string {
  if (tab === 'by_type') return ACCOUNT_TYPE_LABELS[label] ?? label
  if (tab === 'by_asset_class') return ALLOCATION_CLASS_LABELS[label] ?? label
  return label
}

const ALLOCATION_VIEWS: { value: AllocationTab; label: string; note: string }[] = [
  {
    value: 'by_type',
    label: "Where it's held",
    note: 'By account type. A portfolio counts as part of the brokerage account it belongs to.',
  },
  {
    value: 'by_asset_class',
    label: "What it's in",
    note: 'Checking, savings, fixed deposits and uninvested brokerage cash are Cash. Portfolio holdings use their own class. Investment and retirement account balances are shown as Fund · unclassified, because what they hold isn’t recorded. Asset accounts (a house, a car…) are Property & assets.',
  },
]

function AllocationGroup({ data, view, label, note }: { data: Overview; view: AllocationTab; label: string; note: string }) {
  const theme = useChartTheme()
  const groups: CurrencyAllocation[] = data.allocation[view]
  const colorOf = slotColors(theme, view === 'by_type' ? ACCOUNT_TYPE_ORDER : ALLOCATION_CLASS_ORDER)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <h3 className="font-mono text-xs uppercase tracking-widest text-ink">{label}</h3>
        <p className="font-mono text-[10px] text-ink-muted">{note}</p>
      </div>
      {groups.length === 0 ? (
        <p className="font-mono text-[11px] text-ink-muted">Nothing to allocate yet.</p>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {groups.map((g) => (
            <ChartCard key={g.currency} title={g.currency}>
              <AllocationDonut slices={colorSlices(g.slices, colorOf, theme, (k) => labelFor(view, k))} currency={g.currency} />
            </ChartCard>
          ))}
        </div>
      )}
    </div>
  )
}

function AllocationSection({ data }: { data: Overview }) {
  return (
    <section className="flex flex-col gap-6">
      <h2 className={sectionTitle}>Allocation · today</h2>
      {ALLOCATION_VIEWS.map((v) => (
        <AllocationGroup key={v.value} data={data} view={v.value} label={v.label} note={v.note} />
      ))}
    </section>
  )
}

const TOP_N = 10

function assetDetail(a: TopAsset): string {
  if (a.kind === 'account') return ACCOUNT_TYPE_LABELS[a.group] ?? a.group
  // Shown in the hover title only; the row itself is just the name.
  const parts = [ASSET_CLASS_LABELS[a.group] ?? a.group]
  if (a.symbol && a.symbol !== a.name) parts.unshift(a.symbol)
  return parts.filter(Boolean).join(' · ')
}

/** Largest accounts and holdings per currency today; accounts and holdings share one ranking. */
export function TopAssetsSection({ data, scope, columns }: { data: Overview; scope: Scope; columns: string }) {
  const theme = useChartTheme()
  const kindColor = { account: theme.series[0], holding: theme.series[1] } // same pair as the currency cards
  const groups = data.top_assets
    .map((g) => {
      const assets = g.assets.filter((a) => scope === 'both' || (scope === 'accounts' ? a.kind === 'account' : a.kind === 'holding'))
      const total = assets.reduce((sum, a) => sum + (toNumber(a.value) ?? 0), 0)
      return { currency: g.currency, total, count: assets.length, top: assets.slice(0, TOP_N) }
    })
    .filter((g) => g.top.length > 0)
  return (
    <section className="flex flex-col gap-3">
      <h2 className={sectionTitle}>Top {TOP_N} assets · today</h2>
      {groups.length === 0 ? (
        <p className="font-mono text-[11px] text-ink-muted">No assets with a positive value yet.</p>
      ) : (
        <>
          <div className={cn('grid grid-cols-1 gap-4', columns)}>
            {groups.map((g) => {
              const max = toNumber(g.top[0].value) ?? 1
              const topShare = g.total > 0 ? g.top.reduce((s, a) => s + (toNumber(a.value) ?? 0), 0) / g.total : null
              return (
                <ChartCard
                  key={g.currency}
                  title={g.currency}
                  aside={
                    <span className="font-mono text-[10px] text-ink-muted num">
                      {g.count > g.top.length ? `top ${g.top.length} of ${g.count} · ${percent(topShare)}` : `${g.count} assets`}
                    </span>
                  }
                >
                  <ol className="flex flex-col" aria-label={`Top assets in ${g.currency}`}>
                    {g.top.map((a, i) => {
                      const value = toNumber(a.value) ?? 0
                      const detail = assetDetail(a)
                      return (
                        <li
                          key={`${a.kind}-${a.symbol ?? a.name}-${i}`}
                          className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-baseline gap-x-3 py-2 border-b border-line last:border-b-0"
                          title={`${a.name} · ${detail} · ${money(value, g.currency)}`}
                        >
                          <span className="font-mono text-[10px] text-ink-faint num">{i + 1}</span>
                          <div className="min-w-0 flex flex-col gap-1">
                            <span className="font-mono text-xs text-ink truncate">{a.name}</span>
                            <span className="block h-1.5 bg-paper-warm" aria-hidden>
                              <span
                                className="block h-full rounded-r"
                                style={{ width: `${Math.max(1, (value / max) * 100)}%`, background: kindColor[a.kind] }}
                              />
                            </span>
                          </div>
                          <div className="flex flex-col items-end gap-1">
                            <span className="font-mono text-xs text-ink num">{money(value, g.currency, { compact: true })}</span>
                            <span className="font-mono text-[10px] text-ink-muted num">{g.total > 0 ? percent(value / g.total) : '—'}</span>
                          </div>
                        </li>
                      )
                    })}
                  </ol>
                  {scope === 'both' && (
                    <Legend
                      items={[
                        { label: 'Account', color: kindColor.account },
                        { label: 'Holding', color: kindColor.holding },
                      ]}
                    />
                  )}
                </ChartCard>
              )
            })}
          </div>
          <p className="font-mono text-[10px] text-ink-faint">
            Accounts by balance, holdings from each portfolio&apos;s latest snapshot (one symbol held in several portfolios is combined). Share is of
            everything shown for that currency. Left out: debts, closed items, and accounts linked to an open portfolio.
          </p>
        </>
      )}
    </section>
  )
}

export default function AnalyticsPage() {
  const { workspace } = useWorkspace()
  const [range, setRange] = useState<AnalyticsRange>('1y')
  const [scope, setScope] = useState<Scope>('both')
  const { data, isLoading, error } = useOverview(range)
  const theme = useChartTheme()

  const columns = useMemo(() => {
    const n = data?.currencies.length ?? 0
    return n >= 3 ? 'lg:grid-cols-3 md:grid-cols-2' : n === 2 ? 'md:grid-cols-2' : ''
  }, [data])

  return (
    <Page>
      <PageHeader
        title="Analytics"
        subtitle={`${workspace?.name ?? ''} · month-end values, carried forward · per currency, no conversion`}
        actions={
          <>
            <Segmented label="Scope" value={scope} options={SCOPE_OPTIONS} onChange={setScope} />
            <Segmented label="Range" value={range} options={RANGE_OPTIONS} onChange={setRange} />
          </>
        }
      />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={apiErrorMessage(error, 'Could not load analytics')} />
      ) : !data || data.currencies.length === 0 ? (
        <Empty title="Add accounts or snapshots to see analytics">
          <span>
            <Link to="/accounts" className="underline hover:text-ink">
              Accounts
            </Link>{' '}
            ·{' '}
            <Link to="/portfolios" className="underline hover:text-ink">
              Portfolios
            </Link>
          </span>
        </Empty>
      ) : (
        <>
          <div className={cn('grid grid-cols-1 gap-4', columns)}>
            {data.currencies.map((c) => (
              <CurrencyCard key={c.currency} data={c} months={data.months} scope={scope} theme={theme} />
            ))}
          </div>
          <VelocitySection data={data} scope={scope} columns={columns} />
          <BucketAnalytics data={data} />
          <AllocationSection data={data} />
          <TopAssetsSection data={data} scope={scope} columns={columns} />
        </>
      )}
    </Page>
  )
}
