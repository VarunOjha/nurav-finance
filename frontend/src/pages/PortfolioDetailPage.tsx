import { useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Trash2 } from 'lucide-react'
import { apiErrorMessage } from '../api/client'
import { axisTick, useChartTheme } from '../components/charts/chartTheme'
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
    () => [...snaps].sort((a, b) => a.as_of.localeCompare(b.as_of)).map((s) => ({ as_of: s.as_of, total: toNumber(s.total) ?? 0 })),
    [snaps],
  )

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
            <div className="border border-line p-5 lg:col-span-2 flex flex-col gap-3">
              <h2 className="font-mono text-[10px] font-medium uppercase tracking-widest text-ink-muted">Value by snapshot</h2>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                    <CartesianGrid stroke={theme.line} vertical={false} />
                    <XAxis
                      dataKey="as_of"
                      tick={{ ...axisTick, fill: theme.inkMuted }}
                      tickLine={false}
                      axisLine={{ stroke: theme.line }}
                      tickFormatter={(v: string) => parseDate(v).toLocaleDateString('en-US', { month: 'short', year: '2-digit' })}
                    />
                    <YAxis
                      tick={{ ...axisTick, fill: theme.inkMuted }}
                      tickLine={false}
                      axisLine={false}
                      width={64}
                      tickFormatter={(v: number) => money(v, cur, { compact: true })}
                    />
                    <Tooltip
                      cursor={{ fill: theme.paperWarm }}
                      contentStyle={{ background: theme.paper, border: `1px solid ${theme.line}`, borderRadius: 0, fontFamily: axisTick.fontFamily, fontSize: 11 }}
                      labelFormatter={(v: string) => formatDate(v)}
                      formatter={(v: number) => [money(v, cur), 'Total']}
                    />
                    <Bar dataKey="total" fill={theme.ink} maxBarSize={36} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="border border-line p-5 flex flex-col gap-4">
              <h2 className="font-mono text-[10px] font-medium uppercase tracking-widest text-ink-muted">Asset class</h2>
              {cmp && cmp.allocation.length > 0 ? (
                <ul className="flex flex-col gap-3">
                  {cmp.allocation.map((s) => (
                    <li key={s.label} className="flex flex-col gap-1.5">
                      <div className="flex justify-between gap-3 font-mono text-xs">
                        <span>{ASSET_CLASS_LABELS[s.label] ?? s.label}</span>
                        <span className="num text-ink-muted">{percent(s.share)}</span>
                      </div>
                      <ShareBar share={toNumber(s.share) ?? 0} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="font-mono text-[11px] text-ink-faint">—</p>
              )}
            </div>
          </div>

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
                    <th className={cn(th, 'text-right')}>Price</th>
                    <th className={cn(th, 'text-right')}>Value</th>
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
                        <td className={cn(td, 'text-right num')}>{h.price ? money(h.price, cur) : '—'}</td>
                        <td className={cn(td, 'text-right num font-medium', sold && 'text-ink-muted font-normal')}>{money(h.value, cur)}</td>
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
