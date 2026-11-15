import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { ExternalLink, Plus, Trash2 } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { apiErrorMessage } from '../api/client'
import { AccountFormModal } from '../components/AccountFormModal'
import { BankLogo } from '../components/BankLogo'
import { BucketBar } from '../components/BucketBar'
import { BucketSplitModal } from '../components/BucketSplitModal'
import { Swatch } from '../components/charts/kit'
import { PortfolioFormModal } from '../components/PortfolioFormModal'
import { axisTick, useChartTheme } from '../components/charts/chartTheme'
import { Button } from '../components/ui/Button'
import { AmountField } from '../components/ui/AmountInput'
import { FormError, TextArea } from '../components/ui/Field'
import { DateField } from '../components/ui/DateField'
import { ConfirmDialog } from '../components/ui/Modal'
import { Chip, Empty, ErrorBox, Loading, Page, PageHeader, StatCard, Table, onlyBelow, showFrom, td, th } from '../components/ui/Primitives'
import { useAccount, useAccountMutations, useBalances, usePortfolios } from '../hooks/queries'
import { parseAmount } from '../lib/amount'
import { bucketColor } from '../lib/buckets'
import { cn } from '../lib/cn'
import {
  ACCOUNT_TYPE_LABELS,
  arrow,
  countryName,
  deltaClass,
  formatDate,
  formatDateTime,
  money,
  monthLabel,
  parseDate,
  PORTFOLIO_ACCOUNT_TYPES,
  signedMoney,
  toNumber,
  todayISO,
} from '../lib/format'
import type { AccountDetail, BalanceEntry, BalanceHistory, PortfolioSummary } from '../types/api'

const DECIMAL = /^-?\d+(\.\d{1,4})?$/

function hostname(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

function isBackdated(e: BalanceEntry): boolean {
  const recorded = new Date(e.recorded_at)
  const asOf = parseDate(e.as_of)
  return recorded.getTime() - asOf.getTime() > 2 * 24 * 60 * 60 * 1000
}

export default function AccountDetailPage() {
  const { accountId = '' } = useParams()
  const navigate = useNavigate()
  const { data: account, isLoading, error } = useAccount(accountId)
  const { data: history } = useBalances(accountId)
  const { remove, update } = useAccountMutations()
  const [closeOpen, setCloseOpen] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [addPortfolio, setAddPortfolio] = useState(false)
  const [bucketsOpen, setBucketsOpen] = useState(false)
  const { data: portfolios } = usePortfolios()

  if (isLoading) return <Page><Loading label="Loading account" /></Page>
  if (error || !account) {
    const notFound = (error as { response?: { status?: number } } | null)?.response?.status === 404
    return (
      <Page>
        <ErrorBox message={notFound ? 'This account is not in the selected workspace (or was deleted).' : apiErrorMessage(error, 'Could not load the account')} />
        <Link to="/accounts" className="font-mono text-xs uppercase tracking-widest text-ink-muted hover:text-ink">
          ← Accounts
        </Link>
      </Page>
    )
  }

  const subtitle = [
    account.institution,
    ACCOUNT_TYPE_LABELS[account.account_type],
    countryName(account.country),
    account.currency,
    account.closed_on ? `closed ${formatDate(account.closed_on)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  // One portfolio per account: add it the first time, then record new holdings on it
  // (not on a closed one, and not on a closed account).
  const existing = account.portfolios[0] ?? null
  const existingClosed = !!existing && portfolios?.find((p) => p.id === existing.id)?.status === 'closed'
  const holdingsAction =
    account.status === 'active' && PORTFOLIO_ACCOUNT_TYPES.has(account.account_type) && !existingClosed
      ? {
          label: existing ? 'Record holdings' : 'Add portfolio',
          onClick: () => (existing ? navigate(`/portfolios/${existing.id}/snapshots/new`) : setAddPortfolio(true)),
        }
      : null

  return (
    <Page>
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            <BankLogo institution={account.institution} accountType={account.account_type} size="xl" />
            {account.name}
            {account.status === 'closed' && <Chip>closed</Chip>}
          </span>
        }
        subtitle={subtitle}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDeleteOpen(true)}>
              Delete
            </Button>
            {account.status === 'active' ? (
              <Button variant="secondary" onClick={() => setCloseOpen(true)}>
                Close account
              </Button>
            ) : (
              <Button variant="secondary" isLoading={update.isPending} onClick={() => update.mutate({ id: account.id, body: { closed_on: null } })}>
                Reopen
              </Button>
            )}
            {holdingsAction && (
              <Button variant="secondary" onClick={holdingsAction.onClick}>
                <Plus className="w-3.5 h-3.5" aria-hidden="true" /> {holdingsAction.label}
              </Button>
            )}
            <Button variant="secondary" onClick={() => setEditOpen(true)}>
              Edit details
            </Button>
            <Button onClick={() => setBucketsOpen(true)}>Buckets</Button>
          </>
        }
      />

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-8 items-start">
        <div className="flex flex-col gap-6 min-w-0">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard label="Current balance" value={money(account.balance, account.currency)} sub={account.balance_as_of ? `as of ${formatDate(account.balance_as_of)}` : 'no entries yet'} />
            <StatCard
              label="Change vs previous entry"
              value={<span className={deltaClass(account.delta)}>{signedMoney(account.delta, account.currency)}</span>}
              sub={account.previous_balance !== null ? `from ${money(account.previous_balance, account.currency)}` : '—'}
            />
            <StatCard
              label="Entries"
              value={history ? history.entries.filter((e) => e.effective).length : '—'}
              sub={`updated ${formatDateTime(account.updated_at)}`}
            />
          </div>

          <AccountPortfolio account={account} portfolios={portfolios} action={holdingsAction} />
          {history && <BalanceChart history={history} currency={account.currency} />}
          {history && <HistoryTable account={account} entries={history.entries} />}
        </div>

        <aside className="flex flex-col gap-6 min-w-0">
          {account.status === 'active' ? (
            <RecordBalance account={account} />
          ) : (
            <div id="record" className="border border-line p-5 font-mono text-[11px] text-ink-muted">
              Closed on {formatDate(account.closed_on)}. Reopen it to record more balances.
            </div>
          )}
          <BucketsPanel account={account} onAdjust={() => setBucketsOpen(true)} />
          {account.links.length > 0 && <Links account={account} />}
        </aside>
      </div>

      <AccountFormModal open={editOpen} onOpenChange={setEditOpen} account={account} />
      <BucketSplitModal account={bucketsOpen ? account : null} onOpenChange={setBucketsOpen} />
      <PortfolioFormModal open={addPortfolio} onOpenChange={setAddPortfolio} forAccount={account} onSaved={(url) => navigate(url)} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${account.name}?`}
        body={
          existing
            ? `The account, its balance history and links disappear from every list, total and chart — and so does its portfolio (${existing.name}) with all its snapshots.`
            : 'The account, its balance history and links disappear from every list, total and chart.'
        }
        isLoading={remove.isPending}
        error={remove.error ? apiErrorMessage(remove.error) : null}
        onConfirm={() => remove.mutate(account.id, { onSuccess: () => navigate('/accounts', { replace: true }) })}
      />
      <ConfirmDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        title={`Close ${account.name}?`}
        body="It stays in your history up to today and stops counting after that. You can reopen it any time."
        confirmLabel="Close account"
        isLoading={update.isPending}
        error={update.error ? apiErrorMessage(update.error) : null}
        onConfirm={() => update.mutate({ id: account.id, body: { closed_on: todayISO() } }, { onSuccess: () => setCloseOpen(false) })}
      />
    </Page>
  )
}

function BalanceChart({ history, currency }: { history: BalanceHistory; currency: string }) {
  const theme = useChartTheme()
  const data = useMemo(() => history.monthly.map((m) => ({ month: m.month, balance: toNumber(m.balance) })), [history])
  if (data.length < 2) return null
  return (
    <section className="border border-line p-4">
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink-muted mb-3">Month-end balance · {currency}</p>
      <div className="h-56" role="img" aria-label={`Month-end balance from ${monthLabel(data[0].month, true)} to ${monthLabel(data[data.length - 1].month, true)}`}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid stroke={theme.line} vertical={false} />
            <XAxis dataKey="month" tickFormatter={(m) => monthLabel(m)} tick={{ ...axisTick, fill: theme.inkMuted }} stroke={theme.line} minTickGap={24} />
            <YAxis
              width={64}
              tickFormatter={(v: number) => money(v, currency, { compact: true })}
              tick={{ ...axisTick, fill: theme.inkMuted }}
              stroke={theme.line}
            />
            <Tooltip
              contentStyle={{ background: theme.paper, border: `1px solid ${theme.line}`, fontFamily: axisTick.fontFamily, fontSize: 11 }}
              labelFormatter={(m) => monthLabel(String(m), true)}
              formatter={(v) => [money(v as number, currency), 'Balance']}
            />
            <Line type="monotone" dataKey="balance" stroke={theme.series[0]} strokeWidth={2} dot={false} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}

function HistoryTable({ account, entries }: { account: AccountDetail; entries: BalanceEntry[] }) {
  const { deleteBalance } = useAccountMutations()
  const [target, setTarget] = useState<BalanceEntry | null>(null)

  if (entries.length === 0) {
    return (
      <Empty title="No balance entries yet">
        <p>Record the first balance on the right — any past date works.</p>
      </Empty>
    )
  }

  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-mono text-[10px] uppercase tracking-widest text-ink-muted">History · append-only · newest first</h2>
      <Table>
        <thead>
          <tr>
            <th className={th}>As of</th>
            <th className={cn(th, 'text-right')}>Balance</th>
            <th className={cn(th, 'text-right', showFrom.sm)}>Change</th>
            <th className={cn(th, showFrom.md)}>Note</th>
            <th className={cn(th, showFrom.lg)}>Recorded</th>
            <th className={th}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className={cn(!e.effective && '[&_td]:text-ink-muted')}>
              <td className={cn(td, 'whitespace-normal')}>
                <span className="flex flex-wrap items-center gap-2">
                  {formatDate(e.as_of)}
                  {!e.effective && <Chip>superseded</Chip>}
                  {isBackdated(e) && (
                    <span className={onlyBelow.lg}>
                      <Chip>backdated</Chip>
                    </span>
                  )}
                </span>
                {e.note && <div className={cn('text-[10px] text-ink-muted mt-0.5', onlyBelow.md)}>{e.note}</div>}
              </td>
              <td className={cn(td, 'text-right num')}>
                <div className="font-medium">{money(e.amount, account.currency)}</div>
                <div className={cn('text-[10px] mt-0.5', e.effective && deltaClass(e.change), onlyBelow.sm)}>
                  {arrow(e.change)} {signedMoney(e.change, account.currency)}
                </div>
              </td>
              <td className={cn(td, 'text-right num', showFrom.sm)}>
                <span className={e.effective ? deltaClass(e.change) : undefined}>
                  {arrow(e.change)} {signedMoney(e.change, account.currency)}
                </span>
              </td>
              <td className={cn(td, 'whitespace-normal min-w-[8rem] text-ink-muted', showFrom.md)}>{e.note || '—'}</td>
              <td className={cn(td, 'text-ink-muted', showFrom.lg)}>
                <span className="flex items-center gap-2">
                  {formatDateTime(e.recorded_at)}
                  {isBackdated(e) && <Chip>backdated</Chip>}
                </span>
              </td>
              <td className={cn(td, 'text-right px-2')}>
                <button
                  type="button"
                  aria-label={`Delete entry of ${formatDate(e.as_of)}`}
                  onClick={() => setTarget(e)}
                  className="inline-flex items-center justify-center w-9 h-9 text-ink-muted hover:text-error"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
      <ConfirmDialog
        open={!!target}
        onOpenChange={(o) => !o && setTarget(null)}
        title="Delete this entry?"
        body={
          <>
            {target && `${money(target.amount, account.currency)} as of ${formatDate(target.as_of)}. `}
            Entries can't be edited. Deleting hides it everywhere; add a new entry with the right amount.
          </>
        }
        isLoading={deleteBalance.isPending}
        error={deleteBalance.error ? apiErrorMessage(deleteBalance.error) : null}
        onConfirm={() => target && deleteBalance.mutate({ id: account.id, entryId: target.id }, { onSuccess: () => setTarget(null) })}
      />
    </section>
  )
}

function RecordBalance({ account }: { account: AccountDetail }) {
  const { recordBalance } = useAccountMutations()
  const [amount, setAmount] = useState('')
  const [asOf, setAsOf] = useState(todayISO())
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const trimmed = parseAmount(amount)
  const invalid = trimmed !== '' && !DECIMAL.test(trimmed)

  const submit = (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setSaved(false)
    if (!trimmed || invalid) return setError('Enter the balance as a number')
    if (!asOf) return setError('Pick a date')
    recordBalance.mutate(
      { id: account.id, amount: trimmed, as_of: asOf, note: note.trim() || null },
      {
        onSuccess: () => {
          setAmount('')
          setNote('')
          setSaved(true)
        },
        onError: (err) => setError(apiErrorMessage(err, 'Could not record the balance')),
      },
    )
  }

  return (
    <form id="record" onSubmit={submit} noValidate className="border border-ink p-5 flex flex-col gap-4 scroll-mt-6">
      <h2 className="font-mono text-[10px] font-medium uppercase tracking-widest text-ink">Record balance</h2>
      <AmountField
        id="rb-amount"
        label={`Balance · ${account.currency}`}
        placeholder="0.00"
        currency={account.currency}
        maxDecimals={4}
        allowNegative
        value={amount}
        onValueChange={setAmount}
        error={invalid ? 'Enter a number' : null}
      />
      <DateField
        id="rb-asof"
        label="As of"
        value={asOf}
        max={todayISO()}
        onChange={(e) => setAsOf(e.target.value)}
      />
      <TextArea id="rb-note" label="Note · optional" value={note} onChange={(e) => setNote(e.target.value)} />
      <FormError message={error} />
      {saved && <p className="font-mono text-[11px] text-ink-muted">Saved. A new entry was added.</p>}
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] text-ink-faint">Backdating is fine — month-end values recalculate.</p>
        <Button type="submit" isLoading={recordBalance.isPending}>
          Save
        </Button>
      </div>
    </form>
  )
}

/** Read-only summary of the split in force today; the Buckets button edits it. */
function BucketsPanel({ account, onAdjust }: { account: AccountDetail; onAdjust: () => void }) {
  const theme = useChartTheme()
  const parts = account.buckets.map((b) => ({ name: b.name, color: b.color, percent: b.percent }))
  return (
    <section className="border border-line p-5 flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-mono text-[10px] font-medium uppercase tracking-widest text-ink-muted">Buckets · today</h2>
        <button type="button" onClick={onAdjust} className="font-mono text-[10px] uppercase tracking-widest text-ink-muted hover:text-ink hover:underline">
          Adjust
        </button>
      </div>
      {parts.length === 0 ? (
        <button
          type="button"
          onClick={onAdjust}
          className="font-mono text-[11px] text-ink-muted border border-dashed border-line px-4 py-4 text-left hover:text-ink hover:border-ink-faint"
        >
          Unassigned — this account&apos;s money isn&apos;t in any bucket yet. Split it across buckets →
        </button>
      ) : (
        <>
          <BucketBar parts={parts} height="h-2.5" />
          <ul className="flex flex-col">
            {account.buckets.map((b) => {
              const balance = toNumber(account.balance)
              return (
                <li key={b.bucket_id} className="flex items-center gap-2 py-1.5 border-b border-line last:border-b-0 font-mono text-xs">
                  <Swatch color={bucketColor(theme, b.color)} />
                  <span className="text-ink flex-1 truncate">{b.name}</span>
                  <span className="text-ink-muted num">{Number(b.percent).toLocaleString(undefined, { maximumFractionDigits: 2 })}%</span>
                  {balance !== null && account.portfolios.length === 0 && (
                    <span className="text-ink num w-28 text-right">{money((balance * Number(b.percent)) / 100, account.currency)}</span>
                  )}
                </li>
              )
            })}
          </ul>
          {account.portfolios.length > 0 && (
            <p className="font-mono text-[10px] text-ink-muted">Applies to this account&apos;s portfolio too — open Buckets to see the amounts.</p>
          )}
        </>
      )}
    </section>
  )
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-line last:border-b-0">
      <dt className="font-mono text-[10px] uppercase tracking-widest text-ink-muted shrink-0 pt-0.5">{label}</dt>
      <dd className="font-mono text-xs text-ink text-right break-all min-w-0">{children}</dd>
    </div>
  )
}

function Links({ account }: { account: AccountDetail }) {
  return (
    <section className="border border-line p-5 flex flex-col gap-2">
      <h2 className="font-mono text-[10px] font-medium uppercase tracking-widest text-ink-muted mb-1">Links</h2>
      <dl>
        {account.links.map((l) => (
          <Row key={l.id} label={l.label}>
            <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
              {hostname(l.url)}
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
          </Row>
        ))}
      </dl>
    </section>
  )
}

// Investment-type accounts show their portfolio (one per account) and can add it,
// prefilled from the account; once it exists, the button records new holdings on it.
function AccountPortfolio({
  account,
  portfolios,
  action,
}: {
  account: AccountDetail
  portfolios: PortfolioSummary[] | undefined
  action: { label: string; onClick: () => void } | null
}) {
  const canHave = PORTFOLIO_ACCOUNT_TYPES.has(account.account_type)
  const linked = (portfolios ?? []).filter((p) => p.account?.id === account.id)
  if (!canHave && account.portfolios.length === 0) return null

  return (
    <section aria-labelledby="account-portfolios" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-4">
        <h2 id="account-portfolios" className="font-mono text-[11px] uppercase tracking-widest text-ink">
          Portfolio
        </h2>
        {action && (
          <Button variant="secondary" onClick={action.onClick}>
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> {action.label}
          </Button>
        )}
      </div>
      {linked.length === 0 ? (
        <button
          type="button"
          onClick={action?.onClick}
          disabled={!action}
          className="border border-dashed border-line px-5 py-4 text-left font-mono text-[11px] text-ink-muted hover:text-ink hover:border-ink"
        >
          No portfolio yet — add it to track this account&apos;s holdings as dated snapshots.
        </button>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Portfolio</th>
              <th className={cn(th, 'text-right')}>Value</th>
              <th className={cn(th, 'text-right')}>Change</th>
              <th className={cn(th, 'text-right', showFrom.sm)}>As of</th>
            </tr>
          </thead>
          <tbody>
            {linked.map((p) => (
              <tr key={p.id} className="hover:bg-paper-warm">
                <td className={cn(td, 'whitespace-normal')}>
                  <Link to={`/portfolios/${p.id}`} className="inline-flex items-center gap-2 hover:underline">
                    <BankLogo institution={p.provider} size="xs" />
                    {p.name}
                    {p.status === 'closed' && <Chip>closed</Chip>}
                  </Link>
                  <div className={cn('text-[10px] text-ink-muted mt-0.5', onlyBelow.sm)}>{p.value_as_of ? formatDate(p.value_as_of) : 'no snapshot'}</div>
                </td>
                <td className={cn(td, 'text-right')}>{money(p.value, p.currency)}</td>
                <td className={cn(td, 'text-right', deltaClass(p.delta))}>{p.delta !== null ? signedMoney(p.delta, p.currency) : '—'}</td>
                <td className={cn(td, 'text-right text-ink-muted', showFrom.sm)}>{p.value_as_of ? formatDate(p.value_as_of) : 'no snapshot'}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </section>
  )
}
