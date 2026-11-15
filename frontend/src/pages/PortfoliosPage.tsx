import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiErrorMessage } from '../api/client'
import { useChartTheme } from '../components/charts/chartTheme'
import {
  AllocationDonut,
  ChangeColumns,
  ChartCard,
  DivergingLegend,
  Legend,
  RankedBars,
  Sparkline,
  StackedColumns,
  type BarRow,
  type StackSeries,
} from '../components/charts/kit'
import { ASSET_CLASS_ORDER, OTHER, colorSlices, nameColors, slotColors } from '../components/charts/palette'
import { BankLogo } from '../components/BankLogo'
import { InvestedTable, NowTable, WinnersLosers, outcomes } from '../components/HoldingsTables'
import { ShareShift } from '../components/charts/ShareShift'
import { AccordionSection } from '../components/ui/Accordion'
import { PortfolioFormModal } from '../components/PortfolioFormModal'
import { Button } from '../components/ui/Button'
import { Empty, ErrorBox, Loading, Page, PageHeader, StatCard, Table, Tabs, onlyBelow, rowLink, showFrom, td, th } from '../components/ui/Primitives'
import { useWorkspace } from '../context/WorkspaceContext'
import { useAccounts, useConsolidated, usePortfolios } from '../hooks/queries'
import { cn } from '../lib/cn'
import { ASSET_CLASS_LABELS, arrow, deltaClass, formatDate, money, percent, signedMoney, signedPercent, toNumber } from '../lib/format'
import type { CurrencyConsolidation } from '../types/api'

// Portfolios — per-currency totals and the portfolio list, then per currency four
// collapsible sections: how the money was invested, how it looks now, which bets
// paid off (invested → now), and the history charts.
export default function PortfoliosPage() {
  const { workspace } = useWorkspace()
  const { data: accounts = [] } = useAccounts()
  const institutionOf = (id: string) => accounts.find((a) => a.id === id)?.institution
  const navigate = useNavigate()
  const portfolios = usePortfolios()
  const consolidated = useConsolidated()
  const [adding, setAdding] = useState(false)
  const [currency, setCurrency] = useState<string | null>(null)

  const list = portfolios.data ?? []
  const currencies = consolidated.data?.currencies ?? []
  const active = currencies.find((c) => c.currency === currency) ?? currencies[0]
  // 12-month trend per portfolio for the table's sparkline column.
  const trend = new Map(currencies.flatMap((c) => c.history.map((h) => [`${c.currency}:${h.portfolio}`, h.values.map(toNumber)] as const)))

  return (
    <Page>
      <PageHeader
        title="Portfolios"
        subtitle={`${workspace?.name ?? ''} · ${list.length} portfolio${list.length === 1 ? '' : 's'} · latest snapshot per portfolio, merged per currency — no conversion`}
        actions={<Button onClick={() => setAdding(true)}>+ Add portfolio</Button>}
      />

      {portfolios.isLoading || consolidated.isLoading ? (
        <Loading />
      ) : portfolios.error ? (
        <ErrorBox message={apiErrorMessage(portfolios.error, 'Could not load portfolios')} />
      ) : list.length === 0 ? (
        <Empty title="No portfolios yet">
          <span>Add one per brokerage account (Robinhood, Zerodha, Fidelity…) with its holdings today, then record new holdings over time.</span>
          <Button onClick={() => setAdding(true)}>+ Add portfolio</Button>
        </Empty>
      ) : (
        <>
          {currencies.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {currencies.map((c) => {
                const change = c.previous_total !== null ? (toNumber(c.total) ?? 0) - (toNumber(c.previous_total) ?? 0) : null
                return (
                  <StatCard
                    key={c.currency}
                    label={`${c.currency} · ${c.by_portfolio.length} portfolio${c.by_portfolio.length === 1 ? '' : 's'}`}
                    value={money(c.total, c.currency)}
                    sub={
                      change === null ? (
                        'no snapshot before this month'
                      ) : (
                        <>
                          <span className={deltaClass(change)}>
                            {arrow(change)} {signedMoney(change, c.currency)}
                          </span>{' '}
                          vs last month
                        </>
                      )
                    }
                  />
                )
              })}
            </div>
          )}

          <Table>
            <thead>
              <tr>
                <th className={th}>Portfolio</th>
                <th className={cn(th, showFrom['2xl'])}>Currency</th>
                <th className={cn(th, showFrom.xl)}>Linked account</th>
                <th className={cn(th, 'text-right')}>Value</th>
                <th className={cn(th, 'text-right', showFrom.sm)}>Δ prev. snapshot</th>
                <th className={cn(th, showFrom.md)}>12 months</th>
                <th className={cn(th, 'text-right', showFrom['2xl'])}>Holdings</th>
                <th className={cn(th, showFrom.xl)}>Last snapshot</th>
                <th className={cn(th, showFrom.md)}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const closed = p.status === 'closed'
                const row = rowLink(() => navigate(`/portfolios/${p.id}`))
                return (
                  <tr key={p.id} onClick={row.onClick} className={cn(row.className, closed && 'text-ink-muted')}>
                    <td className={cn(td, 'whitespace-normal')}>
                      <div className="flex items-center gap-3">
                        <BankLogo institution={p.provider} size="md" />
                        <div className="min-w-0">
                          <Link to={`/portfolios/${p.id}`} className={cn('text-[13px] font-medium hover:underline', closed ? 'text-ink-muted' : 'text-ink')}>
                            {p.name}
                          </Link>
                          <div className="text-[10px] text-ink-muted mt-0.5">
                            {p.provider ?? '—'}
                            {closed && ` · closed ${formatDate(p.closed_on)}`}
                            <span className={onlyBelow['2xl']}> · {p.holdings_count} holdings</span>
                            {!closed && <span className={onlyBelow.xl}> · {formatDate(p.value_as_of)}</span>}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className={cn(td, 'text-[10px] uppercase tracking-widest text-ink-muted', showFrom['2xl'])}>{p.currency}</td>
                    <td className={cn(td, 'text-ink-muted', showFrom.xl)}>
                      {p.account ? (
                        <Link to={`/accounts/${p.account.id}`} className="inline-flex items-center gap-2 hover:underline hover:text-ink">
                          <BankLogo institution={institutionOf(p.account.id)} size="xs" />
                          {p.account.name}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={cn(td, 'text-right num', closed && 'text-ink-muted')}>
                      <div className="text-[13px] font-medium">{money(p.value, p.currency)}</div>
                      <div className={cn('text-[10px] mt-0.5', deltaClass(p.delta), onlyBelow.sm)}>{signedMoney(p.delta, p.currency)}</div>
                    </td>
                    <td className={cn(td, 'text-right num', deltaClass(p.delta), showFrom.sm)}>{signedMoney(p.delta, p.currency)}</td>
                    <td className={cn(td, showFrom.md)}>
                      {closed ? (
                        <span className="text-ink-faint">—</span>
                      ) : (
                        <Sparkline values={trend.get(`${p.currency}:${p.name}`) ?? []} title={`${p.name}: month-end value, last 12 months`} />
                      )}
                    </td>
                    <td className={cn(td, 'text-right num', showFrom['2xl'])}>{p.holdings_count}</td>
                    <td className={cn(td, 'text-ink-muted', showFrom.xl)}>{formatDate(p.value_as_of)}</td>
                    <td className={cn(td, 'text-right', showFrom.md)}>
                      {!closed && (
                        <button
                          type="button"
                          onClick={() => navigate(`/portfolios/${p.id}/snapshots/new`)}
                          className="font-mono text-[10px] uppercase tracking-widest text-ink-muted hover:text-ink hover:underline"
                        >
                          Record holdings
                        </button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </Table>

          {active ? (
            <section className="flex flex-col gap-6">
              <Tabs
                value={active.currency}
                onChange={setCurrency}
                options={currencies.map((c) => ({ value: c.currency, label: `${c.currency} · ${money(c.total, c.currency)}` }))}
              />
              <CurrencyPanel data={active} />
            </section>
          ) : (
            <Empty title="Nothing to consolidate">Only open portfolios with a snapshot are merged here; record holdings on one to see them.</Empty>
          )}
          <p className="font-mono text-[11px] text-ink-muted">
            Consolidation uses each active portfolio&apos;s latest snapshot. Closed portfolios keep their history but aren&apos;t included.
          </p>
        </>
      )}

      <PortfolioFormModal open={adding} onOpenChange={setAdding} onSaved={(url) => navigate(url)} />
    </Page>
  )
}

function CurrencyPanel({ data }: { data: CurrencyConsolidation }) {
  const theme = useChartTheme()
  const cur = data.currency
  // Portfolios keep one colour across the stack and every donut (alphabetical slot).
  const portfolioColor = nameColors(theme, data.history.map((h) => h.portfolio))
  const classColor = slotColors(theme, ASSET_CLASS_ORDER)
  const className = (k: string) => ASSET_CLASS_LABELS[k] ?? k
  const tableProps = { holdings: data.holdings, currency: cur, classColor, className, fallbackColor: theme.inkFaint }

  const bets = outcomes(data.holdings)
  const invested = bets.reduce((s, o) => s + o.cost, 0)
  const investedNow = bets.reduce((s, o) => s + o.value, 0)
  const gain = investedNow - invested
  const gainPct = invested > 0 ? gain / invested : null
  const withCost = bets.length
  const holdingsWord = (k: number) => `${k} holding${k === 1 ? '' : 's'}`

  return (
    <div className="flex flex-col gap-3">
      <AccordionSection
        id={`portfolios:${cur}:invested`}
        defaultOpen
        title="How the money was invested"
        summary={withCost ? `${money(invested, cur)} invested · ${holdingsWord(withCost)} with a buy price` : 'no buy prices recorded'}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartCard title="Invested by portfolio">
            <AllocationDonut slices={colorSlices(data.cost_by_portfolio, portfolioColor, theme)} currency={cur} empty="No buy prices recorded." />
          </ChartCard>
          <ChartCard title="Invested by asset class">
            <AllocationDonut slices={colorSlices(data.cost_by_asset_class, classColor, theme, className)} currency={cur} empty="No buy prices recorded." />
          </ChartCard>
        </div>
        <InvestedTable {...tableProps} />
      </AccordionSection>

      <AccordionSection
        id={`portfolios:${cur}:now`}
        defaultOpen
        title="How it looks now"
        summary={`${money(data.total, cur)} · ${holdingsWord(data.holdings.length)}`}
      >
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <ChartCard title="Value by portfolio">
            <AllocationDonut slices={colorSlices(data.by_portfolio, portfolioColor, theme)} currency={cur} />
          </ChartCard>
          <ChartCard title="Value by asset class">
            <AllocationDonut slices={colorSlices(data.by_asset_class, classColor, theme, className)} currency={cur} />
          </ChartCard>
        </div>
        <NowTable {...tableProps} />
      </AccordionSection>

      <AccordionSection
        id={`portfolios:${cur}:bets`}
        defaultOpen
        title="Invested → now · which bets paid off"
        summary={
          withCost ? (
            <span className={deltaClass(gain)}>
              {arrow(gain)} {signedMoney(gain, cur)} ({signedPercent(gainPct)}) on {money(invested, cur)}
            </span>
          ) : (
            'needs buy prices'
          )
        }
      >
        <ChartCard
          title="Share of invested → share of value"
          aside={withCost < data.holdings.length ? `${withCost} of ${data.holdings.length} holdings have a buy price` : undefined}
        >
          <ShareShift rows={bets} currency={cur} />
        </ChartCard>
        {withCost > 0 && <WinnersLosers rows={bets} currency={cur} />}
        <p className="font-mono text-[10px] text-ink-muted">
          Invested = quantity × average buy price from each portfolio&apos;s latest snapshot (your current cost basis, not a history of deposits). Both
          shares are over the holdings that have a buy price, so each side adds up to 100%.
        </p>
      </AccordionSection>

      <AccordionSection id={`portfolios:${cur}:history`} title="Over time" summary="last 12 months · largest holdings">
        <OverTime data={data} portfolioColor={portfolioColor} classColor={classColor} className={className} />
      </AccordionSection>
    </div>
  )
}

function OverTime({
  data,
  portfolioColor,
  classColor,
  className,
}: {
  data: CurrencyConsolidation
  portfolioColor: (k: string) => string | null
  classColor: (k: string) => string | null
  className: (k: string) => string
}) {
  const theme = useChartTheme()
  const cur = data.currency
  const stack = data.history.filter((h) => portfolioColor(h.portfolio))
  const folded = data.history.filter((h) => !portfolioColor(h.portfolio))
  const series: StackSeries[] = [
    ...stack.map((h, i) => ({ key: `p${i}`, label: h.portfolio, color: portfolioColor(h.portfolio)! })),
    ...(folded.length ? [{ key: 'other', label: OTHER, color: theme.inkFaint }] : []),
  ]
  const rows = data.months.map((month, m) => {
    const row: Record<string, number | string | null> = { month }
    stack.forEach((h, i) => (row[`p${i}`] = toNumber(h.values[m])))
    if (folded.length) row.other = folded.reduce((s, h) => s + (toNumber(h.values[m]) ?? 0), 0) || null
    return row
  })
  const totals = data.months.map((_, m) =>
    data.history.reduce<number | null>((s, h) => (h.values[m] === null ? s : (s ?? 0) + (toNumber(h.values[m]) ?? 0)), null),
  )
  const change = data.months
    .map((month, m) => ({ month, value: m > 0 && totals[m] !== null && totals[m - 1] !== null ? totals[m]! - totals[m - 1]! : null }))
    .slice(1)

  const TOP = 10
  const top: BarRow[] = data.holdings.slice(0, TOP).map((h) => ({
    key: h.symbol,
    label: h.symbol,
    value: toNumber(h.value) ?? 0,
    color: classColor(h.asset_class) ?? theme.inkFaint,
    detail: `${h.name ?? className(h.asset_class)} · ${percent(h.share)}`,
  }))
  const rest = data.holdings.slice(TOP)
  if (rest.length) {
    const value = rest.reduce((s, h) => s + (toNumber(h.value) ?? 0), 0)
    top.push({ key: OTHER, label: `${rest.length} more`, value, color: theme.inkFaint, detail: 'everything else' })
  }
  const classesShown = [...new Set(data.holdings.slice(0, TOP).map((h) => h.asset_class))]

  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <ChartCard title={`Value by portfolio · month-end · ${cur}`} className="lg:col-span-2" aside="last 12 months">
          <StackedColumns rows={rows} series={series} currency={cur} />
          {series.length > 1 && <Legend items={series} />}
        </ChartCard>
        <ChartCard title="Change month over month">
          <ChangeColumns rows={change} currency={cur} />
          <DivergingLegend gain="Up" loss="Down" />
        </ChartCard>
      </div>
      <ChartCard title={`Largest holdings · ${cur}`} aside={rest.length ? `top ${TOP} of ${data.holdings.length}` : undefined}>
        <RankedBars rows={top} currency={cur} />
        <Legend
          items={[
            ...classesShown.map((c) => ({ label: className(c), color: classColor(c) ?? theme.inkFaint })),
            ...(rest.length ? [{ label: 'Rest', color: theme.inkFaint }] : []),
          ]}
        />
      </ChartCard>
    </>
  )
}
