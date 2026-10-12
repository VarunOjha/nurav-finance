import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { apiErrorMessage } from '../api/client'
import { axisTick, useChartTheme, type ChartTheme } from '../components/charts/chartTheme'
import { Empty, ErrorBox, Loading, Page, PageHeader, Segmented, ShareBar, Tabs } from '../components/ui/Primitives'
import { useTenant } from '../context/TenantContext'
import { useOverview } from '../hooks/queries'
import { cn } from '../lib/cn'
import {
  ACCOUNT_TYPE_LABELS,
  ASSET_CLASS_LABELS,
  arrow,
  deltaClass,
  formatDate,
  money,
  monthLabel,
  percent,
  signedMoney,
  signedPercent,
  toNumber,
} from '../lib/format'
import type { AnalyticsRange, CurrencyAllocation, CurrencySeries, Overview, Series } from '../types/api'

type Scope = 'both' | 'accounts' | 'portfolios'
type AllocationTab = 'by_type' | 'by_asset_class' | 'by_tag'

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
            <XAxis dataKey="month" tickFormatter={(m: string) => monthLabel(m)} tick={{ ...axisTick, fill: theme.inkMuted }} tickLine={false} axisLine={{ stroke: theme.line }} minTickGap={12} />
            <YAxis tickFormatter={fmt} tick={{ ...axisTick, fill: theme.inkMuted }} tickLine={false} axisLine={false} width={56} />
            <Tooltip
              cursor={{ fill: theme.paperWarm }}
              contentStyle={{ background: theme.paper, border: `1px solid ${theme.line}`, fontFamily: axisTick.fontFamily, fontSize: 11 }}
              labelFormatter={(m: string) => monthLabel(m, true)}
              formatter={(v: number, name: string) => [money(v, data.currency), name === 'accounts' ? 'Accounts' : 'Portfolios']}
            />
            {scope !== 'portfolios' && <Bar dataKey="accounts" stackId="v" fill={theme.ink} isAnimationActive={false} />}
            {scope !== 'accounts' && <Bar dataKey="portfolios" stackId="v" fill={theme.inkFaint} isAnimationActive={false} />}
          </BarChart>
        </ResponsiveContainer>
      </div>
      {scope === 'both' && (
        <div className="flex gap-4 font-mono text-[10px] text-ink-muted">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 bg-ink" aria-hidden="true" /> Accounts
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 bg-ink-faint" aria-hidden="true" /> Portfolios
          </span>
        </div>
      )}
    </section>
  )
}

function TagChart({ currency, values, months, theme }: { currency: string; values: Series; months: string[]; theme: ChartTheme }) {
  const rows = months.map((m, i) => ({ month: m, value: toNumber(values[i]) }))
  return (
    <div className="border border-line p-3 min-w-0">
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink-muted mb-2">{currency}</p>
      <div className="h-32">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke={theme.line} />
            <XAxis dataKey="month" tickFormatter={(m: string) => monthLabel(m)} tick={{ ...axisTick, fill: theme.inkMuted }} tickLine={false} axisLine={{ stroke: theme.line }} minTickGap={12} />
            <YAxis tickFormatter={(v: number) => money(v, currency, { compact: true })} tick={{ ...axisTick, fill: theme.inkMuted }} tickLine={false} axisLine={false} width={56} />
            <Tooltip
              contentStyle={{ background: theme.paper, border: `1px solid ${theme.line}`, fontFamily: axisTick.fontFamily, fontSize: 11 }}
              labelFormatter={(m: string) => monthLabel(m, true)}
              formatter={(v: number) => [money(v, currency), 'Value']}
            />
            <Line type="monotone" dataKey="value" stroke={theme.ink} strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

function TagTrends({ data, theme }: { data: Overview; theme: ChartTheme }) {
  const [picked, setPicked] = useState<string | null>(null)
  const selected = data.tags.find((t) => t.tag === picked) ?? data.tags[0]
  return (
    <section className="flex flex-col gap-3">
      <h2 className={sectionTitle}>Tag trends</h2>
      {data.tags.length === 0 ? (
        <p className="font-mono text-[11px] text-ink-muted">No tagged accounts or portfolios yet.</p>
      ) : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Tag">
            {data.tags.map((t) => {
              const on = t.tag === selected?.tag
              return (
                <button
                  key={t.tag}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setPicked(t.tag)}
                  className={cn(
                    'font-mono text-[10px] lowercase tracking-wide border px-2 py-1 min-h-8 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink',
                    on ? 'border-ink bg-ink text-paper' : 'border-line text-ink-muted hover:text-ink',
                  )}
                >
                  {t.tag}
                </button>
              )
            })}
          </div>
          {selected && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {selected.currencies.map((c) => (
                <TagChart key={c.currency} currency={c.currency} values={c.values} months={data.months} theme={theme} />
              ))}
            </div>
          )}
        </>
      )}
    </section>
  )
}

function labelFor(tab: AllocationTab, label: string): string {
  if (tab === 'by_type') return ACCOUNT_TYPE_LABELS[label] ?? label
  if (tab === 'by_asset_class') return ASSET_CLASS_LABELS[label] ?? label
  return label
}

function AllocationSection({ data }: { data: Overview }) {
  const [tab, setTab] = useState<AllocationTab>('by_type')
  const groups: CurrencyAllocation[] = data.allocation[tab]
  return (
    <section className="flex flex-col gap-4">
      <h2 className={sectionTitle}>Allocation · today</h2>
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'by_type', label: 'By type' },
          { value: 'by_asset_class', label: 'By asset class' },
          { value: 'by_tag', label: 'By tag' },
        ]}
      />
      {groups.length === 0 ? (
        <p className="font-mono text-[11px] text-ink-muted">Nothing to allocate yet.</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {groups.map((g) => (
            <div key={g.currency} className="border border-line p-4 flex flex-col gap-3 min-w-0">
              <p className="font-mono text-[10px] uppercase tracking-widest text-ink-muted">{g.currency}</p>
              {g.slices.map((s) => (
                <div key={s.label} className="flex flex-col gap-1">
                  <div className="flex justify-between gap-3 font-mono text-xs">
                    <span className="text-ink truncate">{labelFor(tab, s.label)}</span>
                    <span className="num text-ink-muted whitespace-nowrap">
                      {money(s.value, g.currency)} · {percent(s.share)}
                    </span>
                  </div>
                  <ShareBar share={toNumber(s.share) ?? 0} />
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
      {tab === 'by_tag' && <p className="font-mono text-[10px] text-ink-faint">An item with several tags counts towards each.</p>}
    </section>
  )
}

function TimelineSection({ data }: { data: Overview }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className={sectionTitle}>Timeline</h2>
      {data.timeline.length === 0 ? (
        <p className="font-mono text-[11px] text-ink-muted">No opened or closed dates recorded yet.</p>
      ) : (
        <ol className="border border-line">
          {data.timeline.map((e, i) => {
            const [kind, action] = e.kind.split('_') as ['account' | 'portfolio', 'opened' | 'closed']
            return (
              <li key={`${e.date}-${e.name}-${i}`} className="flex flex-wrap items-baseline gap-x-4 gap-y-1 px-4 py-2.5 border-b border-line last:border-b-0 font-mono text-xs">
                <span className="text-ink-muted w-28 shrink-0">{formatDate(e.date)}</span>
                <span className={cn('uppercase tracking-widest text-[10px] w-36 shrink-0', action === 'closed' ? 'text-ink-muted' : 'text-ink')}>
                  {action === 'opened' ? 'Opened' : 'Closed'} {kind}
                </span>
                <span className="text-ink flex-1 min-w-0 truncate">{e.name}</span>
                <span className="text-ink-muted">{e.currency}</span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}

export default function AnalyticsPage() {
  const { tenant } = useTenant()
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
        subtitle={`${tenant?.name ?? ''} · month-end values, carried forward · per currency, no conversion`}
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
          <TagTrends data={data} theme={theme} />
          <AllocationSection data={data} />
          <TimelineSection data={data} />
        </>
      )}
    </Page>
  )
}
