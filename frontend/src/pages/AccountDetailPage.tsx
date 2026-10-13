import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { ExternalLink, Trash2 } from 'lucide-react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { apiErrorMessage } from '../api/client'
import { accountsApi } from '../api/endpoints'
import { AccountFormModal } from '../components/AccountFormModal'
import { axisTick, useChartTheme } from '../components/charts/chartTheme'
import { Button } from '../components/ui/Button'
import { FormError, Input, TextArea } from '../components/ui/Field'
import { DateField } from '../components/ui/DateField'
import { ConfirmDialog } from '../components/ui/Modal'
import { Chip, Empty, ErrorBox, Loading, Page, PageHeader, StatCard, Table, td, th } from '../components/ui/Primitives'
import { useAccount, useAccountMutations, useBalances } from '../hooks/queries'
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
  signedMoney,
  toNumber,
  todayISO,
} from '../lib/format'
import type { AccountDetail, BalanceEntry, BalanceHistory } from '../types/api'

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
  const { hash } = useLocation()
  const { data: account, isLoading, error } = useAccount(accountId)
  const { data: history } = useBalances(accountId)
  const { remove } = useAccountMutations()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)

  // "+" in the accounts table links here with #record.
  useEffect(() => {
    if (hash === '#record' && account) document.getElementById('record')?.scrollIntoView({ behavior: 'smooth' })
  }, [hash, account])

  if (isLoading) return <Page><Loading label="Loading account" /></Page>
  if (error || !account) {
    const notFound = (error as { response?: { status?: number } } | null)?.response?.status === 404
    return (
      <Page>
        <ErrorBox message={notFound ? 'This account is not in the selected tenant (or was deleted).' : apiErrorMessage(error, 'Could not load the account')} />
        <Link to="/accounts" className="font-mono text-xs uppercase tracking-widest text-ink-muted hover:text-ink">
          ← Accounts
        </Link>
      </Page>
    )
  }

  const subtitle = [
    account.institution,
    ACCOUNT_TYPE_LABELS[account.account_type],
    [account.city, countryName(account.country)].filter(Boolean).join(', '),
    account.currency,
    account.closed_on ? `closed ${formatDate(account.closed_on)}` : account.opened_on ? `opened ${formatDate(account.opened_on)}` : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <Page>
      <PageHeader
        back={
          <Link to="/accounts" className="font-mono text-[11px] uppercase tracking-widest text-ink-muted hover:text-ink">
            ← Accounts
          </Link>
        }
        title={
          <span className="flex items-center gap-3">
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
            <Button onClick={() => setEditOpen(true)}>Edit details</Button>
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

          {history && <BalanceChart history={history} currency={account.currency} />}
          {history && <HistoryTable account={account} entries={history.entries} />}
        </div>

        <aside className="flex flex-col gap-6 min-w-0">
          {account.status === 'active' ? (
            <RecordBalance account={account} />
          ) : (
            <div id="record" className="border border-line p-5 font-mono text-[11px] text-ink-muted">
              Closed on {formatDate(account.closed_on)}. Backdated entries up to that date can still be recorded by clearing the closed date in Edit.
            </div>
          )}
          <Details account={account} />
        </aside>
      </div>

      <AccountFormModal open={editOpen} onOpenChange={setEditOpen} account={account} />
      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${account.name}?`}
        body="The account, its balance history, identifiers and links disappear from every list, total and chart. Linked portfolios stay, unlinked."
        isLoading={remove.isPending}
        error={remove.error ? apiErrorMessage(remove.error) : null}
        onConfirm={() => remove.mutate(account.id, { onSuccess: () => navigate('/accounts', { replace: true }) })}
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
            <Line type="monotone" dataKey="balance" stroke={theme.ink} strokeWidth={1.5} dot={false} connectNulls={false} isAnimationActive={false} />
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
            <th className={cn(th, 'text-right')}>Change</th>
            <th className={th}>Note</th>
            <th className={th}>Recorded</th>
            <th className={th}>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className={cn(!e.effective && '[&_td]:text-ink-muted')}>
              <td className={td}>
                <span className="flex items-center gap-2">
                  {formatDate(e.as_of)}
                  {!e.effective && <Chip>superseded</Chip>}
                </span>
              </td>
              <td className={cn(td, 'text-right num font-medium')}>{money(e.amount, account.currency)}</td>
              <td className={cn(td, 'text-right num')}>
                <span className={e.effective ? deltaClass(e.change) : undefined}>
                  {arrow(e.change)} {signedMoney(e.change, account.currency)}
                </span>
              </td>
              <td className={cn(td, 'whitespace-normal min-w-[8rem] text-ink-muted')}>{e.note || '—'}</td>
              <td className={cn(td, 'text-ink-muted')}>
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

  const trimmed = amount.replace(/,/g, '').trim()
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
      <Input
        id="rb-amount"
        label={`Balance · ${account.currency}`}
        inputMode="decimal"
        placeholder="0.00"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        error={invalid ? 'Enter a number' : null}
      />
      <DateField
        id="rb-asof"
        label="As of"
        value={asOf}
        max={todayISO()}
        min={account.opened_on ?? undefined}
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

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-2 border-b border-line last:border-b-0">
      <dt className="font-mono text-[10px] uppercase tracking-widest text-ink-muted shrink-0 pt-0.5">{label}</dt>
      <dd className="font-mono text-xs text-ink text-right break-all min-w-0">{children}</dd>
    </div>
  )
}

function Details({ account }: { account: AccountDetail }) {
  const [revealed, setRevealed] = useState<string | null>(null)
  const [revealError, setRevealError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Never keep the plain number around after leaving the account.
  useEffect(() => setRevealed(null), [account.id])

  const reveal = async () => {
    setBusy(true)
    setRevealError(null)
    try {
      setRevealed((await accountsApi.reveal(account.id)).account_number)
    } catch (err) {
      setRevealError(apiErrorMessage(err, 'Could not reveal the number'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="border border-line p-5 flex flex-col gap-2">
      <h2 className="font-mono text-[10px] font-medium uppercase tracking-widest text-ink-muted mb-1">Details</h2>
      <dl>
        <Row label="Holder">{account.holder_name || '—'}</Row>
        <Row label="Account no.">
          {account.has_account_number ? (
            <span className="inline-flex items-center gap-3">
              <span className="num">{revealed ?? account.account_number_masked}</span>
              <button
                type="button"
                disabled={busy}
                onClick={() => (revealed ? setRevealed(null) : reveal())}
                className="font-mono text-[10px] uppercase tracking-widest text-ink-muted hover:text-ink underline-offset-2 hover:underline"
              >
                {revealed ? 'Hide' : busy ? '…' : 'Reveal'}
              </button>
            </span>
          ) : (
            '—'
          )}
        </Row>
        {account.identifiers.map((i) => (
          <Row key={i.id} label={i.label}>
            {i.value}
          </Row>
        ))}
        {account.links.map((l) => (
          <Row key={l.id} label={l.label}>
            <a href={l.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 hover:underline">
              {hostname(l.url)}
              <ExternalLink className="w-3 h-3" aria-hidden="true" />
            </a>
          </Row>
        ))}
        {account.portfolios.length > 0 && (
          <Row label="Portfolios">
            <span className="flex flex-col items-end gap-1">
              {account.portfolios.map((p) => (
                <Link key={p.id} to={`/portfolios/${p.id}`} className="hover:underline">
                  {p.name}
                </Link>
              ))}
            </span>
          </Row>
        )}
        <Row label="Tags">
          <span className="inline-flex flex-wrap justify-end gap-1.5">
            {account.tags.length ? account.tags.map((t) => <Chip key={t.id}>{t.name}</Chip>) : '—'}
          </span>
        </Row>
      </dl>
      {revealError && <p className="font-mono text-[10px] text-error">{revealError}</p>}
      {account.notes && <p className="font-mono text-[11px] text-ink-muted whitespace-pre-wrap border-t border-line pt-3">{account.notes}</p>}
    </section>
  )
}
