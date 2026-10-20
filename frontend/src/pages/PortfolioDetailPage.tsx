import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { apiErrorMessage } from '../api/client'
import { useChartTheme } from '../components/charts/chartTheme'
import { AllocationDonut, ChartCard, DivergingBars, DivergingLegend, Legend, Lines, RankedBars, type BarRow, type StackSeries } from '../components/charts/kit'
import { ASSET_CLASS_ORDER, OTHER, colorSlices, slotColors } from '../components/charts/palette'
import { PortfolioFormModal } from '../components/PortfolioFormModal'
import { Button } from '../components/ui/Button'
import { Select } from '../components/ui/Field'
import { ConfirmDialog } from '../components/ui/Modal'
import { Chip, Empty, ErrorBox, Loading, Page, PageHeader, ShareBar, StatCard, Table, td, th } from '../components/ui/Primitives'
import { usePortfolio, usePortfolioMutations, useSnapshotComparison, useSnapshots } from '../hooks/queries'
import { cn } from '../lib/cn'
import {
  ASSET_CLASS_LABELS,
  arrow,
  deltaClass,
  formatDate,
  formatDateTime,
  money,
  parseDate,
  percent,
  quantity,
  signedMoney,
  signedPercent,
  toNumber,
} from '../lib/format'
import type { HoldingDiff, SnapshotSummary } from '../types/api'

const DAY_MS = 86_400_000

function isBackdated(s: SnapshotSummary): boolean {
  return new Date(s.recorded_at).getTime() - parseDate(s.as_of).getTime() > 2 * DAY_MS
}

function qtyChange(h: HoldingDiff): string | null {
  const n = toNumber(h.quantity_change)
  if (h.status !== 'changed' || n === null || n === 0) return null
  return `${n > 0 ? '+' : '−'}${quantity(Math.abs(n))} sh`
}

// One portfolio: compare any two snapshots (default: previous by date),
// value over time, allocation, holdings diff and the snapshot history.
export default function PortfolioDetailPage() {
  const { portfolioId = '' } = useParams()
  const navigate = useNavigate()
  const portfolio = usePortfolio(portfolioId)
  const snapshots = useSnapshots(portfolioId)
  const { remove, deleteSnapshot } = usePortfolioMutations()
  const theme = useChartTheme()

  const [selected, setSelected] = useState<string | null>(null)
  const [compareTo, setCompareTo] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [snapToDelete, setSnapToDelete] = useState<SnapshotSummary | null>(null)
  const [snapError, setSnapError] = useState<string | null>(null)

  const snaps = useMemo(() => snapshots.data ?? [], [snapshots.data]) // newest first
  const currentId = selected && snaps.some((s) => s.id === selected) ? selected : snaps[0]?.id ?? null
  const compareId = compareTo && compareTo !== currentId && snaps.some((s) => s.id === compareTo) ? compareTo : null
  const comparison = useSnapshotComparison(portfolioId, currentId, compareId)

  const chartData = useMemo(
    () =>
      [...snaps]
        .sort((a, b) => a.as_of.localeCompare(b.as_of))
        .map((s) => ({ as_of: s.as_of, total: toNumber(s.total) ?? 0, cost: toNumber(s.cost) })),
    [snaps],
  )
  const hasCost = snaps.some((s) => s.cost !== null)
  const lineSeries: StackSeries[] = [
    { key: 'total', label: 'Value', color: theme.series[0] },
    ...(hasCost ? [{ key: 'cost', label: 'Invested', color: theme.series[1] }] : []),
  ]
  const classColor = slotColors(theme, ASSET_CLASS_ORDER)
  const className = (k: string) => ASSET_CLASS_LABELS[k] ?? k

  if (portfolio.isLoading) {
    return (
      <Page>
        <Loading />
      </Page>
    )
  }
  if (portfolio.error || !portfolio.data) {
    return (
      <Page>
        <Link to="/portfolios" className="font-mono text-xs uppercase tracking-widest text-ink-muted hover:text-ink">
          ← Portfolios
        </Link>
        <ErrorBox message={apiErrorMessage(portfolio.error, 'Portfolio not found in this tenant')} />
      </Page>
    )
  }

  const p = portfolio.data
  const cur = p.currency
  const cmp = comparison.data
  const newCount = cmp?.holdings.filter((h) => h.status === 'new').length ?? 0
  const soldCount = cmp?.holdings.filter((h) => h.status === 'sold').length ?? 0

  // Chart rows for the selected snapshot.
  const TOP = 10
  const current = (cmp?.holdings ?? []).filter((h) => h.status !== 'sold') // value desc from the API
  const rest = current.slice(TOP)
  const valueBars: BarRow[] = current.slice(0, TOP).map((h) => ({
    key: h.symbol,
    label: h.symbol,
    value: toNumber(h.value) ?? 0,
    color: classColor(h.asset_class) ?? theme.inkFaint,
    detail: `${h.name ?? className(h.asset_class)} · ${percent(h.weight)}`,
  }))
  if (rest.length) {
    valueBars.push({ key: OTHER, label: `${rest.length} more`, value: rest.reduce((s, h) => s + (toNumber(h.value) ?? 0), 0), color: theme.inkFaint })
  }
  const classLegend = [
    ...[...new Set(current.slice(0, TOP).map((h) => h.asset_class))].map((c) => ({ label: className(c), color: classColor(c) ?? theme.inkFaint })),
    ...(rest.length ? [{ label: 'Rest', color: theme.inkFaint }] : []),
  ]
  const gainRows = current
    .filter((h) => h.gain !== null)
    .map((h) => {
      const cost = toNumber(h.cost) ?? 0
      const gain = toNumber(h.gain) ?? 0
      return { key: h.symbol, label: h.symbol, value: gain, detail: cost ? `${signedPercent(gain / cost)} on ${money(cost, cur)}` : undefined }
    })
    .sort((a, b) => b.value - a.value)
  const movedRows = (cmp?.holdings ?? [])
    .map((h) => ({ key: h.symbol, label: h.symbol, value: toNumber(h.value_change) ?? 0, detail: h.status }))
    .filter((r) => r.value !== 0)
    .sort((a, b) => b.value - a.value)

  const doDelete = async () => {
    setDeleteError(null)
    try {
      await remove.mutateAsync(p.id)
      navigate('/portfolios')
    } catch (err) {
      setDeleteError(apiErrorMessage(err, 'Could not delete'))
    }
  }

  const doDeleteSnapshot = async () => {
    if (!snapToDelete) return
    setSnapError(null)
    try {
      await deleteSnapshot.mutateAsync({ id: p.id, snapshotId: snapToDelete.id })
      if (selected === snapToDelete.id) setSelected(null)
      if (compareTo === snapToDelete.id) setCompareTo(null)
      setSnapToDelete(null)
    } catch (err) {
      setSnapError(apiErrorMessage(err, 'Could not delete the snapshot'))
    }
  }

  return (
    <Page>
      <PageHeader
        back={
          <Link to="/portfolios" className="font-mono text-xs uppercase tracking-widest text-ink-muted hover:text-ink hover:underline">
            ← Portfolios
          </Link>
        }
        title={p.name}
        subtitle={
          <>
            {p.provider ?? 'No provider'} · {cur}
            {p.account && (
              <>
                {' · linked to '}
                <Link to={`/accounts/${p.account.id}`} className="text-ink hover:underline">
                  {p.account.name}
                </Link>
              </>
            )}
            {p.status === 'closed' && ` · closed ${formatDate(p.closed_on)}`}
          </>
        }
        actions={
          <>
            <Button variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <Button variant="ghost" className="hover:text-error" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
            {p.status !== 'closed' && <Button onClick={() => navigate(`/portfolios/${p.id}/snapshots/new`)}>+ Record snapshot</Button>}
          </>
        }
      />

      {p.tags.length > 0 && (
        <div className="flex gap-1.5 flex-wrap -mt-2">
          {p.tags.map((t) => (
            <Chip key={t.id}>{t.name}</Chip>
          ))}
        </div>
      )}

      {snapshots.isLoading ? (
        <Loading />
      ) : snaps.length === 0 ? (
        <Empty title="No snapshots yet">
          <span>Record the holdings you have today — or backdate one to start the history.</span>
          {p.status !== 'closed' && <Button onClick={() => navigate(`/portfolios/${p.id}/snapshots/new`)}>+ Record snapshot</Button>}
        </Empty>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 max-w-2xl">
            <Select id="snap-current" label="Snapshot" value={currentId ?? ''} onChange={(e) => setSelected(e.target.value)}>
              {snaps.map((s) => (
                <option key={s.id} value={s.id}>
                  {formatDate(s.as_of)} · {money(s.total, cur)}
                </option>
              ))}
            </Select>
            <Select id="snap-compare" label="Compare with" value={compareId ?? ''} onChange={(e) => setCompareTo(e.target.value || null)}>
              <option value="">Previous by date</option>
              {snaps
                .filter((s) => s.id !== currentId)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatDate(s.as_of)} · {money(s.total, cur)}
                  </option>
                ))}
            </Select>
          </div>

          {comparison.error && <ErrorBox message={apiErrorMessage(comparison.error)} />}

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label={`Value · ${cmp ? formatDate(cmp.current.as_of) : '—'}`} value={cmp ? money(cmp.current.total, cur) : '—'} />
            <StatCard
              label={cmp?.previous ? `Change vs ${formatDate(cmp.previous.as_of)}` : 'Change'}
              value={
                <span className={deltaClass(cmp?.change)}>
                  {cmp?.change != null ? `${arrow(cmp.change)} ${signedMoney(cmp.change, cur)}` : '—'}
                </span>
              }
              sub={cmp?.change_pct != null ? signedPercent(cmp.change_pct) : cmp ? 'first snapshot' : undefined}
            />
            <StatCard label="Holdings" value={cmp ? cmp.current.holdings_count : '—'} />
            <StatCard label="New · sold" value={cmp ? `${newCount} · ${soldCount}` : '—'} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <ChartCard
              title={hasCost ? 'Value vs invested · by snapshot' : 'Value by snapshot'}
              className="lg:col-span-2"
              aside={hasCost ? 'invested = quantity × buy price, for holdings that have one' : undefined}
            >
              <Lines
                rows={chartData}
                series={lineSeries}
                xKey="as_of"
                xFormat={(v) => parseDate(v).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
                xLabel={(v) => formatDate(v)}
                valueFormat={(v) => money(v, cur)}
                axisFormat={(v) => money(v, cur, { compact: true })}
                dots
              />
              {lineSeries.length > 1 && <Legend items={lineSeries.map((l) => ({ ...l, line: true }))} />}
            </ChartCard>
            <ChartCard title={`Asset class${cmp ? ` · ${formatDate(cmp.current.as_of)}` : ''}`}>
              <AllocationDonut slices={cmp ? colorSlices(cmp.allocation, classColor, theme, className) : []} currency={cur} empty="—" />
            </ChartCard>
          </div>

          {cmp && (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ChartCard title="Holdings by value" aside={rest.length ? `top ${TOP} of ${current.length}` : undefined}>
                <RankedBars rows={valueBars} currency={cur} />
                <Legend items={classLegend} />
              </ChartCard>
              <ChartCard
                title="Unrealised gain · per holding"
                aside={current.length ? `buy price known for ${gainRows.length} of ${current.length}` : undefined}
              >
                {gainRows.length ? (
                  <>
                    <DivergingBars rows={gainRows} currency={cur} name="Gain" />
                    <DivergingLegend />
                  </>
                ) : (
                  <p className="font-mono text-[11px] text-ink-faint">Add buy prices when recording a snapshot to see gains.</p>
                )}
              </ChartCard>
            </div>
          )}

          {cmp?.previous && (
            <ChartCard title={`What moved · value change vs ${formatDate(cmp.previous.as_of)}`} aside="price and quantity changes together">
              {movedRows.length ? (
                <>
                  <DivergingBars rows={movedRows} currency={cur} name="Change" />
                  <DivergingLegend gain="Up" loss="Down" />
                </>
              ) : (
                <p className="font-mono text-[11px] text-ink-faint">No holding changed value.</p>
              )}
            </ChartCard>
          )}

          <section className="flex flex-col gap-3">
            <h2 className="font-mono text-[10px] font-medium uppercase tracking-widest text-ink-muted">
              Holdings{cmp?.previous ? ` · vs ${formatDate(cmp.previous.as_of)}` : ''}
            </h2>
            {comparison.isLoading ? (
              <Loading />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <th className={th}>Symbol</th>
                    <th className={th}>Name</th>
                    <th className={th}>Class</th>
                    <th className={cn(th, 'text-right')}>Qty</th>
                    <th className={cn(th, 'text-right')}>Buy price</th>
                    <th className={cn(th, 'text-right')}>Current price</th>
                    <th className={cn(th, 'text-right')}>Value</th>
                    <th className={cn(th, 'text-right')}>Gain</th>
                    <th className={cn(th, 'text-right')}>Δ value</th>
                    <th className={cn(th, 'w-40')}>Weight</th>
                  </tr>
                </thead>
                <tbody>
                  {cmp?.holdings.map((h) => {
                    const sold = h.status === 'sold'
                    const change = qtyChange(h)
                    return (
                      <tr key={h.symbol} className={cn(sold && 'text-ink-muted')}>
                        <td className={td}>
                          <span className={cn('font-medium', sold && 'line-through text-ink-muted')}>{h.symbol}</span>
                          {h.status === 'new' && (
                            <Chip active className="ml-2 uppercase">
                              new
                            </Chip>
                          )}
                          {sold && <Chip className="ml-2 uppercase">sold</Chip>}
                          {change && (
                            <Chip active className="ml-2">
                              {change}
                            </Chip>
                          )}
                        </td>
                        <td className={cn(td, 'text-ink-muted whitespace-normal min-w-[10rem]')}>{h.name ?? '—'}</td>
                        <td className={cn(td, 'text-[10px] uppercase tracking-widest text-ink-muted')}>{ASSET_CLASS_LABELS[h.asset_class] ?? h.asset_class}</td>
                        <td className={cn(td, 'text-right num')}>{sold ? quantity(h.previous_quantity) : quantity(h.quantity)}</td>
                        <td className={cn(td, 'text-right num')}>{h.buy_price ? money(h.buy_price, cur) : '—'}</td>
                        <td className={cn(td, 'text-right num')}>{h.current_price ? money(h.current_price, cur) : '—'}</td>
                        <td className={cn(td, 'text-right num font-medium', sold && 'text-ink-muted font-normal')}>{money(h.value, cur)}</td>
                        <td className={cn(td, 'text-right num', deltaClass(h.gain))}>{h.gain === null ? '—' : signedMoney(h.gain, cur)}</td>
                        <td className={cn(td, 'text-right num', deltaClass(h.value_change))}>{cmp.previous ? signedMoney(h.value_change, cur) : '—'}</td>
                        <td className={td}>
                          <div className="flex items-center gap-2">
                            <ShareBar share={toNumber(h.weight) ?? 0} className="w-20" />
                            <span className="num text-ink-muted">{percent(h.weight)}</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </Table>
            )}
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="font-mono text-[10px] font-medium uppercase tracking-widest text-ink-muted">Snapshot history · {snaps.length}</h2>
            <Table>
              <thead>
                <tr>
                  <th className={th}>As of</th>
                  <th className={cn(th, 'text-right')}>Total</th>
                  <th className={cn(th, 'text-right')}>Holdings</th>
                  <th className={th}>Recorded</th>
                  <th className={th}>Note</th>
                  <th className={th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {snaps.map((s) => (
                  <tr key={s.id} className={cn(s.id === currentId && 'bg-paper-warm/60')}>
                    <td className={td}>
                      <button type="button" onClick={() => setSelected(s.id)} className="hover:underline">
                        {formatDate(s.as_of)}
                      </button>
                    </td>
                    <td className={cn(td, 'text-right num font-medium')}>{money(s.total, cur)}</td>
                    <td className={cn(td, 'text-right num')}>{s.holdings_count}</td>
                    <td className={cn(td, 'text-ink-muted')}>
                      {formatDateTime(s.recorded_at)}
                      {isBackdated(s) && <Chip className="ml-2">backdated</Chip>}
                    </td>
                    <td className={cn(td, 'text-ink-muted whitespace-normal min-w-[8rem]')}>{s.note ?? ''}</td>
                    <td className={cn(td, 'text-right py-0')}>
                      <button
                        type="button"
                        aria-label={`Delete snapshot of ${formatDate(s.as_of)}`}
                        onClick={() => {
                          setSnapError(null)
                          setSnapToDelete(s)
                        }}
                        className="p-2 text-ink-muted hover:text-error"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <p className="font-mono text-[11px] text-ink-muted">Snapshots are immutable. Backdated snapshots slot in by date.</p>
          </section>
        </>
      )}

      <PortfolioFormModal open={editing} onOpenChange={setEditing} portfolio={p} />
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${p.name}?`}
        body="The portfolio and all its snapshots disappear from every list, total and chart. A linked account is not affected."
        onConfirm={doDelete}
        isLoading={remove.isPending}
        error={deleteError}
      />
      <ConfirmDialog
        open={!!snapToDelete}
        onOpenChange={(o) => !o && setSnapToDelete(null)}
        title={snapToDelete ? `Delete the ${formatDate(snapToDelete.as_of)} snapshot?` : 'Delete snapshot?'}
        body="Snapshots can't be edited. Delete it and record it again to fix it."
        onConfirm={doDeleteSnapshot}
        isLoading={deleteSnapshot.isPending}
        error={snapError}
      />
    </Page>
  )
}
