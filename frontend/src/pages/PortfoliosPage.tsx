import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { apiErrorMessage } from '../api/client'
import { PortfolioFormModal } from '../components/PortfolioFormModal'
import { Button } from '../components/ui/Button'
import { Chip, Empty, ErrorBox, Loading, Page, PageHeader, ShareBar, StatCard, Table, Tabs, td, th } from '../components/ui/Primitives'
import { useTenant } from '../context/TenantContext'
import { useConsolidated, usePortfolios } from '../hooks/queries'
import { cn } from '../lib/cn'
import { ASSET_CLASS_LABELS, arrow, deltaClass, formatDate, money, percent, quantity, signedMoney, toNumber } from '../lib/format'
import type { AllocationSlice, CurrencyConsolidation } from '../types/api'

// Portfolios — consolidated view (canvas option B): per-currency totals, the
// portfolio list, then share / asset-class / merged holdings per currency.
export default function PortfoliosPage() {
  const { tenant } = useTenant()
  const navigate = useNavigate()
  const portfolios = usePortfolios()
  const consolidated = useConsolidated()
  const [adding, setAdding] = useState(false)
  const [currency, setCurrency] = useState<string | null>(null)

  const list = portfolios.data ?? []
  const currencies = consolidated.data?.currencies ?? []
  const active = currencies.find((c) => c.currency === currency) ?? currencies[0]

  return (
    <Page>
      <PageHeader
        title="Portfolios"
        subtitle={`${tenant?.name ?? ''} · ${list.length} portfolio${list.length === 1 ? '' : 's'} · latest snapshot per portfolio, merged per currency — no conversion`}
        actions={<Button onClick={() => setAdding(true)}>+ Add portfolio</Button>}
      />

      {portfolios.isLoading || consolidated.isLoading ? (
        <Loading />
      ) : portfolios.error ? (
        <ErrorBox message={apiErrorMessage(portfolios.error, 'Could not load portfolios')} />
      ) : list.length === 0 ? (
        <Empty title="No portfolios yet">
          <span>Add Robinhood, Zerodha, Fidelity… then record holdings snapshots over time.</span>
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
                <th className={th}>Currency</th>
                <th className={th}>Linked account</th>
                <th className={th}>Tags</th>
                <th className={cn(th, 'text-right')}>Value</th>
                <th className={cn(th, 'text-right')}>Δ prev. snapshot</th>
                <th className={cn(th, 'text-right')}>Holdings</th>
                <th className={th}>Last snapshot</th>
                <th className={th}>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((p) => {
                const closed = p.status === 'closed'
                return (
                  <tr key={p.id} className={cn('hover:bg-paper-warm/60', closed && 'text-ink-muted')}>
                    <td className={td}>
                      <Link to={`/portfolios/${p.id}`} className={cn('text-[13px] font-medium hover:underline', closed ? 'text-ink-muted' : 'text-ink')}>
                        {p.name}
                      </Link>
                      <div className="text-[10px] text-ink-muted mt-0.5">
                        {p.provider ?? '—'}
                        {closed && ` · closed ${formatDate(p.closed_on)}`}
                      </div>
                    </td>
                    <td className={cn(td, 'text-[10px] uppercase tracking-widest text-ink-muted')}>{p.currency}</td>
                    <td className={cn(td, 'text-ink-muted')}>
                      {p.account ? (
                        <Link to={`/accounts/${p.account.id}`} className="hover:underline hover:text-ink">
                          {p.account.name}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className={td}>
                      <div className="flex gap-1.5 flex-wrap">
                        {p.tags.map((t) => (
                          <Chip key={t.id}>{t.name}</Chip>
                        ))}
                      </div>
                    </td>
                    <td className={cn(td, 'text-right num text-[13px] font-medium', closed && 'text-ink-muted')}>{money(p.value, p.currency)}</td>
                    <td className={cn(td, 'text-right num', deltaClass(p.delta))}>{signedMoney(p.delta, p.currency)}</td>
                    <td className={cn(td, 'text-right num')}>{p.holdings_count}</td>
                    <td className={cn(td, 'text-ink-muted')}>{formatDate(p.value_as_of)}</td>
                    <td className={cn(td, 'text-right')}>
                      {!closed && (
                        <button
                          type="button"
                          onClick={() => navigate(`/portfolios/${p.id}/snapshots/new`)}
                          className="font-mono text-[10px] uppercase tracking-widest text-ink-muted hover:text-ink hover:underline"
                        >
                          Record snapshot
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
            <Empty title="No snapshots yet">Record a snapshot to see consolidated holdings.</Empty>
          )}
          <p className="font-mono text-[11px] text-ink-muted">
            Consolidation uses each active portfolio&apos;s latest snapshot. Closed portfolios keep their history but aren&apos;t included.
          </p>
        </>
      )}

      <PortfolioFormModal open={adding} onOpenChange={setAdding} onSaved={(p) => navigate(`/portfolios/${p.id}`)} />
    </Page>
  )
}

function ShareRows({ slices, currency, labels }: { slices: AllocationSlice[]; currency: string; labels?: Record<string, string> }) {
  if (slices.length === 0) return <p className="font-mono text-[11px] text-ink-faint">Nothing yet.</p>
  return (
    <ul className="flex flex-col gap-3">
      {slices.map((s) => (
        <li key={s.label} className="flex flex-col gap-1.5">
          <div className="flex justify-between gap-3 font-mono text-xs">
            <span className="text-ink truncate">{labels?.[s.label] ?? s.label}</span>
            <span className="num text-ink-muted whitespace-nowrap">
              {money(s.value, currency)} · {percent(s.share)}
            </span>
          </div>
          <ShareBar share={toNumber(s.share) ?? 0} />
        </li>
      ))}
    </ul>
  )
}

function CurrencyPanel({ data }: { data: CurrencyConsolidation }) {
  return (
    <>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="border border-line p-5 flex flex-col gap-4">
          <h2 className="font-mono text-[10px] font-medium uppercase tracking-widest text-ink-muted">Share by portfolio</h2>
          <ShareRows slices={data.by_portfolio} currency={data.currency} />
        </div>
        <div className="border border-line p-5 flex flex-col gap-4">
          <h2 className="font-mono text-[10px] font-medium uppercase tracking-widest text-ink-muted">By asset class</h2>
          <ShareRows slices={data.by_asset_class} currency={data.currency} labels={ASSET_CLASS_LABELS} />
        </div>
      </div>
      <div className="flex flex-col gap-3">
        <h2 className="font-mono text-[10px] font-medium uppercase tracking-widest text-ink-muted">
          Consolidated holdings · {data.currency} · {data.holdings.length}
        </h2>
        <Table>
          <thead>
            <tr>
              <th className={th}>Symbol</th>
              <th className={th}>Name</th>
              <th className={th}>Class</th>
              <th className={cn(th, 'text-right')}>Quantity</th>
              <th className={cn(th, 'text-right')}>Value</th>
              <th className={cn(th, 'w-40')}>Share</th>
              <th className={th}>Held in</th>
            </tr>
          </thead>
          <tbody>
            {data.holdings.map((h) => (
              <tr key={h.symbol}>
                <td className={cn(td, 'font-medium')}>{h.symbol}</td>
                <td className={cn(td, 'text-ink-muted whitespace-normal min-w-[10rem]')}>{h.name ?? '—'}</td>
                <td className={cn(td, 'text-[10px] uppercase tracking-widest text-ink-muted')}>{ASSET_CLASS_LABELS[h.asset_class] ?? h.asset_class}</td>
                <td className={cn(td, 'text-right num')}>{quantity(h.quantity)}</td>
                <td className={cn(td, 'text-right num font-medium')}>{money(h.value, data.currency)}</td>
                <td className={td}>
                  <div className="flex items-center gap-2">
                    <ShareBar share={toNumber(h.share) ?? 0} className="w-20" />
                    <span className="num text-ink-muted">{percent(h.share)}</span>
                  </div>
                </td>
                <td className={cn(td, 'text-ink-muted')}>{h.portfolios.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    </>
  )
}
