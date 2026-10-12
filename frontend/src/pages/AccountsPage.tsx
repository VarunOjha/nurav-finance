import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import { apiErrorMessage } from '../api/client'
import { AccountFormModal } from '../components/AccountFormModal'
import { Button } from '../components/ui/Button'
import { Input, Select } from '../components/ui/Field'
import { Chip, Empty, ErrorBox, Loading, Page, PageHeader, Segmented, StatCard, Table, td, th } from '../components/ui/Primitives'
import { useTenant } from '../context/TenantContext'
import { useAccounts, useTags } from '../hooks/queries'
import { cn } from '../lib/cn'
import { ACCOUNT_TYPE_LABELS, arrow, countryName, deltaClass, formatDate, money, signedMoney, toNumber } from '../lib/format'
import type { AccountSummary } from '../types/api'

type Status = 'active' | 'closed' | 'all'

function location(a: AccountSummary): string {
  return [a.city, countryName(a.country)].filter(Boolean).join(', ') || '—'
}

export default function AccountsPage() {
  const { tenant } = useTenant()
  const { data: accounts, isLoading, error } = useAccounts()
  const { data: tags = [] } = useTags()
  const [modalOpen, setModalOpen] = useState(false)
  const [status, setStatus] = useState<Status>('active')
  const [search, setSearch] = useState('')
  const [tag, setTag] = useState('')
  const [type, setType] = useState('')
  const [currency, setCurrency] = useState('')

  const all = useMemo(() => accounts ?? [], [accounts])
  const active = all.filter((a) => a.status === 'active')
  const currencies = useMemo(() => Array.from(new Set(all.map((a) => a.currency))).sort(), [all])

  // Per-currency totals over active accounts — never converted.
  const totals = useMemo(() => {
    const map = new Map<string, { count: number; total: number; delta: number }>()
    for (const a of active) {
      const t = map.get(a.currency) ?? { count: 0, total: 0, delta: 0 }
      t.count += 1
      t.total += toNumber(a.balance) ?? 0
      t.delta += toNumber(a.delta) ?? 0
      map.set(a.currency, t)
    }
    return Array.from(map.entries()).sort((x, y) => y[1].count - x[1].count)
  }, [active])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return all.filter((a) => {
      if (status !== 'all' && a.status !== status) return false
      if (tag && !a.tags.some((t) => t.id === tag)) return false
      if (type && a.account_type !== type) return false
      if (currency && a.currency !== currency) return false
      if (q) {
        const hay = [a.name, a.institution, a.account_number_masked].filter(Boolean).join(' ').toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [all, status, tag, type, currency, search])

  const closedCount = all.length - active.length

  return (
    <Page>
      <PageHeader
        title="Accounts"
        subtitle={
          <>
            <span className="text-ink">{tenant?.name}</span> · {all.length} account{all.length === 1 ? '' : 's'} · {active.length} active ·{' '}
            {closedCount} closed · balances are the latest entry per account
          </>
        }
        actions={
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add account
          </Button>
        }
      />

      {isLoading && <Loading label="Loading accounts" />}
      {error && <ErrorBox message={apiErrorMessage(error, 'Could not load accounts')} />}

      {accounts && all.length === 0 && (
        <Empty title="No accounts yet">
          <p>Add checking, savings, deposits or brokerage cash accounts. Balances are recorded as dated entries — backdate as far as you like.</p>
          <Button onClick={() => setModalOpen(true)}>
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add account
          </Button>
        </Empty>
      )}

      {all.length > 0 && (
        <>
          {totals.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {totals.map(([code, t]) => (
                <StatCard
                  key={code}
                  label={`${code} · ${t.count} account${t.count === 1 ? '' : 's'}`}
                  value={money(t.total, code)}
                  sub={
                    <span className={deltaClass(t.delta)}>
                      {arrow(t.delta)} {signedMoney(t.delta, code)} <span className="text-ink-muted">vs previous entries</span>
                    </span>
                  }
                />
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="flex flex-wrap items-end gap-4">
              <Input
                id="acc-search"
                aria-label="Search accounts"
                placeholder="Search name, bank, number…"
                className="w-full sm:w-64"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              <Select id="acc-tag" aria-label="Filter by tag" className="w-36" value={tag} onChange={(e) => setTag(e.target.value)}>
                <option value="">All tags</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>
              <Select id="acc-type" aria-label="Filter by type" className="w-36" value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">All types</option>
                {Object.entries(ACCOUNT_TYPE_LABELS)
                  .filter(([k]) => k !== 'portfolio')
                  .map(([k, label]) => (
                    <option key={k} value={k}>
                      {label}
                    </option>
                  ))}
              </Select>
              <Select id="acc-cur" aria-label="Filter by currency" className="w-28" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                <option value="">All ccy</option>
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <Segmented
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'closed', label: 'Closed' },
                { value: 'all', label: 'All' },
              ]}
            />
          </div>

          {rows.length === 0 ? (
            <Empty title="No accounts match these filters" />
          ) : (
            <Table>
              <thead>
                <tr>
                  <th className={th}>Account</th>
                  <th className={th}>Type</th>
                  <th className={th}>Location</th>
                  <th className={th}>Tags</th>
                  <th className={cn(th, 'text-right')}>Balance</th>
                  <th className={cn(th, 'text-right')}>Δ last entry</th>
                  <th className={th}>Updated</th>
                  <th className={th}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => {
                  const closed = a.status === 'closed'
                  return (
                    <tr key={a.id} className={cn(closed && '[&_td]:text-ink-muted')}>
                      <td className={td}>
                        <Link to={`/accounts/${a.id}`} className="text-[13px] font-medium text-ink hover:underline">
                          {a.name}
                        </Link>
                        <div className="text-[10px] text-ink-muted mt-0.5">{[a.institution, a.account_number_masked].filter(Boolean).join(' · ') || '—'}</div>
                      </td>
                      <td className={cn(td, 'text-[10px] uppercase tracking-widest text-ink-muted')}>{ACCOUNT_TYPE_LABELS[a.account_type]}</td>
                      <td className={cn(td, 'text-ink-muted')}>{location(a)}</td>
                      <td className={td}>
                        <div className="flex flex-wrap gap-1.5">
                          {a.tags.map((t) => (
                            <Chip key={t.id}>{t.name}</Chip>
                          ))}
                        </div>
                      </td>
                      <td className={cn(td, 'text-right num text-[13px] font-medium')}>{money(a.balance, a.currency)}</td>
                      <td className={cn(td, 'text-right num')}>
                        {closed ? <span className="text-ink-muted">closed</span> : <span className={deltaClass(a.delta)}>{signedMoney(a.delta, a.currency)}</span>}
                      </td>
                      <td className={cn(td, 'text-ink-muted')}>{closed ? `Closed ${formatDate(a.closed_on)}` : formatDate(a.balance_as_of)}</td>
                      <td className={cn(td, 'text-right px-2')}>
                        {!closed && (
                          <Link
                            to={`/accounts/${a.id}#record`}
                            aria-label={`Record balance for ${a.name}`}
                            className="inline-flex items-center justify-center w-9 h-9 text-ink-muted hover:text-ink"
                          >
                            <Plus className="w-4 h-4" aria-hidden="true" />
                          </Link>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </Table>
          )}
          <p className="font-mono text-[11px] text-ink-muted">Totals are per currency — no conversion. Closed accounts keep their full history.</p>
        </>
      )}

      <AccountFormModal open={modalOpen} onOpenChange={setModalOpen} />
    </Page>
  )
}
