import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { ArrowUpRight, ChevronDown, CircleAlert, PieChart } from 'lucide-react'
import { BucketSplitModal, type SplitAccount } from '../components/BucketSplitModal'
import { axisTick, useChartTheme } from '../components/charts/chartTheme'
import { ChartCard, ChartTooltip, Swatch } from '../components/charts/kit'
import { BucketGrid } from '../components/dashboard/BucketGrid'
import { LifeMap } from '../components/dashboard/LifeMap'
import { sectionTitle } from '../components/metrics/GoalParts'
import { Empty, ErrorBox, Loading, Page, PageHeader, StatCard, th } from '../components/ui/Primitives'
import { useBuckets, useDashboard, useMetrics } from '../hooks/queries'
import { trimDecimal } from '../lib/amount'
import { UNASSIGNED, bucketColor } from '../lib/buckets'
import { cn } from '../lib/cn'
import { formatDate, money, parseDate, percent, signedPercent, toNumber } from '../lib/format'
import type { CurrencyDashboard, Dashboard, DashboardAlert, MilestoneView, TargetRow } from '../types/api'

const short = (v: string | number | null | undefined, cur: string) => money(v, cur, { compact: true })
/** $794,608 / ₹71,43,620: whole units, the currency's own grouping. */
const whole = (v: string | number | null | undefined, cur: string) => {
  const n = toNumber(v)
  return n === null ? '—' : money(Math.round(n), cur).replace(/\.00$/, '')
}

// ── check-in ─────────────────────────────────────────────────────────────────

function CheckinPanel({ checkin }: { checkin: Dashboard['checkin'] }) {
  const counts = new Map<string, number>()
  for (const i of checkin.items) {
    const key = i.kind === 'holdings' ? 'holdings' : i.currency
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  const parts = [...counts.entries()].filter(([k]) => k !== 'holdings').map(([cur, n]) => `${n} ${cur} balance${n === 1 ? '' : 's'}`)
  const snaps = counts.get('holdings')
  if (snaps) parts.push(`${snaps} holdings`)
  return (
    <div className="border border-ink p-4 flex flex-col gap-3">
      <p className="font-mono text-xs text-ink flex flex-wrap gap-x-6 gap-y-1">
        <span>
          Last <b>{formatDate(checkin.last)}</b>
        </span>
        {parts.map((p) => (
          <span key={p}>{p}</span>
        ))}
      </p>
      <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6">
        {checkin.items.map((i) => (
          <li key={i.id} className="border-b border-line">
            <Link
              to={i.kind === 'holdings' ? `/portfolios/${i.id}/snapshots/new` : `/accounts/${i.id}`}
              className="flex items-center justify-between gap-3 py-2 font-mono text-[11px] text-ink hover:underline focus:outline-none focus-visible:underline"
            >
              <span className="truncate">{i.name}</span>
              <span className="text-ink-muted num whitespace-nowrap">{i.last ? formatDate(i.last) : 'never'}</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── tiles ────────────────────────────────────────────────────────────────────

function Tiles({ data, next }: { data: Dashboard; next: MilestoneView | undefined }) {
  const accounts = data.currencies.reduce((s, c) => s + c.account_count, 0)
  return (
    <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      {data.currencies.map((c) => (
        <StatCard key={c.currency} label={`Net worth · ${c.currency}`} value={whole(c.net_worth, c.currency)} />
      ))}
      <StatCard label="Accounts" value={accounts} sub={data.currencies.map((c) => `${c.account_count} ${c.currency}`).join(' · ')} />
      {next && (
        <>
          <StatCard label={`Time left · ${next.name}`} value={`${Number(next.months_left ?? 0).toFixed(1)} mo`} sub={formatDate(next.target_date)} />
          <div className="border border-line p-4 min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink-muted mb-2">Save / month · {next.name}</p>
            <div className="flex flex-col gap-1.5">
              {next.totals.map((t) => (
                <p key={t.currency} className="font-mono text-xl font-bold num leading-none text-ink truncate">
                  {t.need === null ? '—' : short(t.need, t.currency)}
                </p>
              ))}
            </div>
          </div>
        </>
      )}
    </section>
  )
}

// ── net worth by year ────────────────────────────────────────────────────────

function YearlyChart({ c, untilYear }: { c: CurrencyDashboard; untilYear: number }) {
  const theme = useChartTheme()
  const byYear = new Map(c.yearly.map((y) => [y.year, toNumber(y.value)]))
  const first = c.yearly[0]?.year ?? untilYear
  const rows = []
  for (let y = first; y <= Math.max(untilYear, first); y++) rows.push({ year: String(y), value: byYear.get(y) ?? null })
  const tick = { ...axisTick, fill: theme.inkMuted }
  return (
    <ChartCard title={c.currency}>
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={theme.line} />
            <XAxis dataKey="year" tick={tick} tickLine={false} axisLine={{ stroke: theme.ink }} />
            <YAxis tickFormatter={(v: number) => short(v, c.currency)} tick={tick} tickLine={false} axisLine={false} width={64} />
            <Tooltip cursor={{ fill: theme.paperWarm }} content={<ChartTooltip valueFormat={(v) => whole(v, c.currency)} />} />
            <Bar dataKey="value" name="Net worth" fill={theme.ink} radius={[4, 4, 0, 0]} maxBarSize={48} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

// ── buckets toward the next milestone ────────────────────────────────────────

function BucketTile({ row }: { row: TargetRow }) {
  const theme = useChartTheme()
  const color = bucketColor(theme, row.bucket.color)
  const cur = row.currency
  const current = toNumber(row.current) ?? 0
  const amount = toNumber(row.amount) ?? 0
  const ratio = amount > 0 ? current / amount : 0
  const over = current - amount
  const need = toNumber(row.need_with_return ?? row.need_flat)
  const chip =
    row.status === 'achieved' ? { text: '✓ Funded', solid: true } : need !== null && need <= 0 ? { text: '✓ On track', solid: true } : { text: `Save ${short(need, cur)} / mo`, solid: false }
  return (
    <div className="border border-line p-4 flex flex-col gap-2.5 min-w-0">
      <span className="flex items-center gap-2 font-mono text-xs uppercase tracking-widest text-ink min-w-0">
        <Swatch color={color} />
        <span className="truncate">{row.bucket.name}</span>
      </span>
      <span className="font-mono text-lg font-bold num text-ink">
        {short(row.current, cur)} <span className="text-xs font-normal text-ink-muted">/ {short(row.amount, cur)}</span>
      </span>
      <span className="relative h-2.5 bg-paper-warm" aria-hidden="true">
        <span className="absolute inset-y-0 left-0" style={{ width: `${Math.min(ratio, 1) * 100}%`, background: color }} />
        <span className="absolute -top-1 h-[18px] w-0.5 bg-ink" style={{ left: `calc(${Math.min(1 / Math.max(ratio, 1), 1) * 100}% - 2px)` }} />
      </span>
      <span className="font-mono text-[11px] text-ink-muted num">
        {percent(ratio, 0)} · {over > 0 ? `${short(over, cur)} over` : `gap ${short(row.gap, cur)}`}
      </span>
      <span className={cn('self-start font-mono text-[10px] uppercase tracking-widest border border-ink px-2 py-1', chip.solid ? 'bg-ink text-paper' : 'text-ink')}>{chip.text}</span>
    </div>
  )
}

function BucketTiles({ next, currencies }: { next: MilestoneView; currencies: string[] }) {
  const groups = currencies.map((cur) => ({ cur, rows: next.rows.filter((r) => r.currency === cur) })).filter((g) => g.rows.length)
  return (
    <>
      {groups.map((g) => (
        <section key={g.cur} className="flex flex-col gap-3">
          <h2 className={sectionTitle}>
            Buckets toward {next.name} · {g.cur}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            {g.rows.map((r) => (
              <BucketTile key={r.id} row={r} />
            ))}
          </div>
        </section>
      ))}
    </>
  )
}

// ── needs attention ──────────────────────────────────────────────────────────

const LOW_YIELD: Record<NonNullable<DashboardAlert['label']>, string> = {
  fixed_deposits: 'is in fixed deposits',
  cash: 'is cash',
  deposits_and_cash: 'is in deposits and cash',
}

function alertLine(a: DashboardAlert): { icon: typeof ArrowUpRight; title: string; text: string } {
  const name = a.bucket?.name ?? UNASSIGNED
  if (a.kind === 'rebalance')
    return {
      icon: ArrowUpRight,
      title: 'Rebalance',
      text: `${name} is ${short(a.amount, a.currency)} over target; ${a.other_bucket?.name} is ${short(a.other_amount, a.currency)} short.`,
    }
  if (a.kind === 'intent')
    return {
      icon: CircleAlert,
      title: 'Intent vs reality',
      text: `${name} expects ${trimDecimal(a.expected_return ?? '0')}%; ${percent(a.share, 0)} of it ${LOW_YIELD[a.label ?? 'deposits_and_cash']}.`,
    }
  return { icon: PieChart, title: 'Concentration', text: `${a.symbol} is ${percent(a.share, 0)} of ${name}.` }
}

function Attention({ alerts }: { alerts: DashboardAlert[] }) {
  if (!alerts.length) return null
  return (
    <section className="flex flex-col">
      <h2 className={sectionTitle}>Needs attention</h2>
      <ul>
        {alerts.map((a, i) => {
          const { icon: Icon, title, text } = alertLine(a)
          return (
            <li key={i} className="flex gap-3 py-3 border-b border-line font-mono text-xs text-ink leading-relaxed">
              <Icon className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
              <span>
                <b>{title}:</b> {text}
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

// ── top 5 tables ─────────────────────────────────────────────────────────────

const tcell = 'font-mono text-xs text-ink px-1 py-2 border-b border-line whitespace-nowrap overflow-hidden text-ellipsis'
const thead = cn(th, 'bg-transparent px-1 border-b border-ink')

function TopEntries({ c, bucketOf }: { c: CurrencyDashboard; bucketOf: (id: string | null) => { name: string; color: string } }) {
  return (
    <table className="w-full table-fixed">
      <thead>
        <tr>
          <th className={cn(thead, 'w-[42%]')}>{c.currency}</th>
          <th className={thead}>Bucket</th>
          <th className={cn(thead, 'text-right w-[18%]')}>Value</th>
          <th className={cn(thead, 'text-right w-[13%]')}>Share</th>
        </tr>
      </thead>
      <tbody>
        {c.top_entries.map((e) => (
          <tr key={`${e.kind}-${e.name}`}>
            <td className={tcell} title={e.held_in.join(', ')}>
              {e.name}
              {e.held_in.length > 0 && <span className="text-ink-muted text-[11px]"> · {e.held_in.join(', ')}</span>}
            </td>
            <td className={tcell}>
              <span className="inline-flex items-center gap-1.5 max-w-full">
                {e.bucket_ids.map((id) => (
                  <Swatch key={id ?? 'none'} color={bucketOf(id).color} />
                ))}
                <span className="truncate">{e.bucket_ids.map((id) => bucketOf(id).name).join(' · ')}</span>
              </span>
            </td>
            <td className={cn(tcell, 'text-right num')}>{short(e.value, c.currency)}</td>
            <td className={cn(tcell, 'text-right num')}>{percent(e.share, 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function TopStocks({ c }: { c: CurrencyDashboard }) {
  return (
    <table className="w-full table-fixed">
      <thead>
        <tr>
          <th className={cn(thead, 'w-[46%]')}>{c.currency}</th>
          <th className={cn(thead, 'text-right')}>Value</th>
          <th className={cn(thead, 'text-right')}>Gain</th>
          <th className={cn(thead, 'text-right w-[13%]')}>Share</th>
        </tr>
      </thead>
      <tbody>
        {c.top_stocks.map((s) => {
          const gain = toNumber(s.gain_pct)
          return (
            <tr key={s.symbol}>
              <td className={tcell} title={s.name ?? s.symbol}>
                {s.symbol}
                <span className="text-ink-muted text-[11px]"> · {s.held_in.join(', ')}</span>
              </td>
              <td className={cn(tcell, 'text-right num')}>{short(s.value, c.currency)}</td>
              <td className={cn(tcell, 'text-right num', gain !== null && gain < 0 && 'text-error')}>{gain === null ? '—' : signedPercent(gain / 100, Math.abs(gain) < 10 ? 1 : 0)}</td>
              <td className={cn(tcell, 'text-right num')}>{percent(s.share, 0)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function PairSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className={sectionTitle}>{title}</h2>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">{children}</div>
    </section>
  )
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const theme = useChartTheme()
  const { data, isLoading, error } = useDashboard()
  const { data: metrics } = useMetrics()
  const { data: buckets = [] } = useBuckets()
  const [checkinOpen, setCheckinOpen] = useState(false)
  const [splitFor, setSplitFor] = useState<SplitAccount | null>(null)

  const next = metrics?.milestones.find((m) => !m.past)
  const bucketOf = (id: string | null) => {
    const b = buckets.find((x) => x.id === id)
    return { name: b?.name ?? UNASSIGNED, color: bucketColor(theme, b?.color) }
  }
  const header = (
    <PageHeader
      title="Dashboard"
      actions={
        data && data.checkin.items.length > 0 ? (
          <button
            type="button"
            aria-expanded={checkinOpen}
            onClick={() => setCheckinOpen((o) => !o)}
            className={cn(
              'inline-flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest border border-ink px-3 py-2 min-h-[36px]',
              checkinOpen ? 'bg-ink text-paper' : 'text-ink hover:bg-paper-warm',
            )}
          >
            Check-in
            <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', checkinOpen && 'rotate-180')} aria-hidden="true" />
          </button>
        ) : undefined
      }
    />
  )

  if (isLoading) return <Page>{header}<Loading /></Page>
  if (error || !data) return <Page>{header}<ErrorBox message="Couldn’t load the dashboard." /></Page>
  if (data.currencies.length === 0)
    return (
      <Page>
        {header}
        <Empty title="Add an account to see your dashboard">
          <Link to="/accounts" className="underline">
            Go to Accounts
          </Link>
        </Empty>
      </Page>
    )

  const todayYear = parseDate(data.today).getFullYear()
  const untilYear = Math.max(todayYear, next ? parseDate(next.target_date).getFullYear() : todayYear)
  const withStocks = data.currencies.filter((c) => c.top_stocks.length)

  return (
    <Page>
      {header}
      {checkinOpen && <CheckinPanel checkin={data.checkin} />}
      <Tiles data={data} next={next} />

      <section className="flex flex-col gap-3">
        <h2 className={sectionTitle}>Net worth by year</h2>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {data.currencies.map((c) => (
            <YearlyChart key={c.currency} c={c} untilYear={untilYear} />
          ))}
        </div>
      </section>

      {next && <BucketTiles next={next} currencies={data.currencies.map((c) => c.currency)} />}

      <Attention alerts={data.attention} />

      <PairSection title="Top 5">
        {data.currencies.map((c) => (
          <TopEntries key={c.currency} c={c} bucketOf={bucketOf} />
        ))}
      </PairSection>

      {withStocks.length > 0 && (
        <PairSection title="Top 5 stocks">
          {withStocks.map((c) => (
            <TopStocks key={c.currency} c={c} />
          ))}
        </PairSection>
      )}

      {metrics && metrics.buckets.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className={sectionTitle}>Life map</h2>
          <LifeMap today={data.today} buckets={metrics.buckets} milestones={metrics.milestones} />
        </section>
      )}

      <PairSection title="Accounts × buckets">
        {data.currencies.map((c) => (
          <BucketGrid
            key={c.currency}
            currency={c.currency}
            grid={c.grid}
            onRow={(r) => setSplitFor({ id: r.account_id, name: r.name, currency: c.currency })}
          />
        ))}
      </PairSection>

      <BucketSplitModal account={splitFor} onOpenChange={(o) => !o && setSplitFor(null)} />
    </Page>
  )
}
