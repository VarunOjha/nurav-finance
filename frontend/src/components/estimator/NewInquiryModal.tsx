import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Check, Loader2, RotateCcw } from 'lucide-react'
import { Modal } from '../ui/Modal'
import { Button } from '../ui/Button'
import { AmountInput } from '../ui/AmountInput'
import { CONTROL, Label } from '../ui/Field'
import { ErrorBox, Loading } from '../ui/Primitives'
import { useEstimatorPool, useInquiryMutations } from '../../hooks/queries'
import { parseAmount } from '../../lib/amount'
import { cn } from '../../lib/cn'
import { InquiryError, runInquiry } from '../../lib/estimator'
import { CURRENCIES, money, toNumber } from '../../lib/format'
import type { InquiryStage, PoolAccount } from '../../types/api'

const STEPS: { stage: InquiryStage; label: string }[] = [
  { stage: 'snapshot', label: 'Snapshot' },
  { stage: 'review', label: 'AI review' },
  { stage: 'checks', label: 'Checks' },
  { stage: 'compute', label: 'Compute' },
]

type StepState = 'pending' | 'running' | 'done' | 'retry'

function AccountRow({ a, on, toggle }: { a: PoolAccount; on: boolean; toggle: () => void }) {
  return (
    <label
      className={cn(
        'grid grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-2 py-2 border-b border-line font-mono text-xs',
        a.fixed ? 'text-ink-faint' : on ? 'text-ink cursor-pointer' : 'text-ink-faint cursor-pointer',
      )}
    >
      <input type="checkbox" checked={on} disabled={a.fixed} onChange={toggle} className="w-4 h-4 accent-current" />
      <span className="truncate">
        {a.name}
        {a.fixed && <span className="ml-2 text-[9px] uppercase tracking-widest border border-line px-1.5 py-0.5">Fixed</span>}
      </span>
      <span className="num">{money(a.value, a.currency, { compact: true })}</span>
    </label>
  )
}

export function NewInquiryModal({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const pool = useEstimatorPool(open)
  const { refresh } = useInquiryMutations()
  const navigate = useNavigate()
  const [expenses, setExpenses] = useState('')
  const [rate, setRate] = useState('3.5')
  const [currency, setCurrency] = useState<string | null>(null)
  const [off, setOff] = useState<Set<string>>(new Set())
  const [phase, setPhase] = useState<'form' | 'running'>('form')
  const [steps, setSteps] = useState<Record<InquiryStage, StepState>>({ snapshot: 'pending', review: 'pending', checks: 'pending', compute: 'pending' })
  const [error, setError] = useState<string | null>(null)
  const [seconds, setSeconds] = useState(0)
  const abort = useRef<AbortController | null>(null)

  const cur = currency ?? pool.data?.currencies[0] ?? 'USD'
  const accounts = pool.data?.accounts ?? []
  const groups = useMemo(() => {
    const by = new Map<string, PoolAccount[]>()
    for (const a of accounts) by.set(a.currency, [...(by.get(a.currency) ?? []), a])
    const order = pool.data?.currencies ?? []
    const rank = (c: string) => (order.includes(c) ? order.indexOf(c) : order.length)
    return [...by.entries()].sort(([a], [b]) => rank(a) - rank(b))
  }, [accounts, pool.data])
  const isOn = (a: PoolAccount) => !a.fixed && !off.has(a.id)
  const anyOn = accounts.some(isOn)
  const amount = toNumber(parseAmount(expenses))
  const rateNum = Number(rate)
  const rateOk = rate.trim() !== '' && rateNum >= 1 && rateNum <= 10
  const canRun = anyOn && amount !== null && amount > 0 && rateOk

  useEffect(() => {
    if (phase !== 'running' || error) return
    const t = window.setInterval(() => setSeconds((s) => s + 1), 1000)
    return () => window.clearInterval(t)
  }, [phase, error])

  useEffect(() => {
    if (!open) {
      abort.current?.abort()
      setPhase('form')
      setError(null)
    }
  }, [open])

  async function run() {
    setPhase('running')
    setError(null)
    setSeconds(0)
    setSteps({ snapshot: 'running', review: 'pending', checks: 'pending', compute: 'pending' })
    const ctrl = new AbortController()
    abort.current = ctrl
    try {
      await runInquiry(
        { monthly_expenses: parseAmount(expenses), currency: cur, withdrawal_rate_pct: String(rateNum), excluded_account_ids: [...off] },
        (e) => {
          if (e.type === 'stage') setSteps((s) => ({ ...s, [e.stage]: e.status }))
          else if (e.type === 'error') setError(e.message)
          else {
            refresh()
            onOpenChange(false)
            navigate(`/estimator/${e.id}`)
          }
        },
        ctrl.signal,
      )
    } catch (e) {
      setError(e instanceof InquiryError ? e.message : 'Something went wrong')
    }
  }

  const toggle = (id: string) =>
    setOff((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  const footer =
    phase === 'form' ? (
      <div className="flex justify-end gap-5">
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button onClick={run} disabled={!canRun}>
          Run
        </Button>
      </div>
    ) : (
      <div className="flex justify-end gap-5">
        {error ? (
          <Button variant="secondary" onClick={() => setPhase('form')}>
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" /> Back
          </Button>
        ) : (
          <span className="font-mono text-[11px] text-ink-muted num self-center">{seconds}s</span>
        )}
      </div>
    )

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="New inquiry" size="lg" footer={footer}>
      {phase === 'form' ? (
        <div className="px-5 sm:px-7 py-5 flex flex-col gap-6">
          <div>
            <Label htmlFor="inq-expenses">Monthly expenses</Label>
            <div className="flex gap-3 items-end">
              <select aria-label="Currency" value={cur} onChange={(e) => setCurrency(e.target.value)} className={cn(CONTROL, 'w-24')}>
                {[...new Set([...(pool.data?.currencies ?? []), ...CURRENCIES])].map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
              <AmountInput
                id="inq-expenses"
                value={expenses}
                onValueChange={setExpenses}
                currency={cur}
                maxDecimals={2}
                className={cn(CONTROL, 'num flex-1 min-w-0')}
                autoFocus
              />
            </div>
          </div>
          <div>
            <Label htmlFor="inq-rate">Withdrawal rate</Label>
            <div className="flex flex-wrap items-end gap-3">
              <div role="group" aria-label="Common rates" className="inline-flex border border-line">
                {['3', '3.5', '4'].map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={rate === r}
                    onClick={() => setRate(r)}
                    className={cn(
                      'font-mono text-xs px-3 min-h-9 border-r border-line last:border-r-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink',
                      rate === r ? 'bg-ink text-paper' : 'text-ink-muted hover:text-ink',
                    )}
                  >
                    {r}%
                  </button>
                ))}
              </div>
              <span className="inline-flex items-end gap-1">
                <input
                  id="inq-rate"
                  type="number"
                  inputMode="decimal"
                  min={1}
                  max={10}
                  step={0.25}
                  value={rate}
                  onChange={(e) => setRate(e.target.value)}
                  aria-invalid={!rateOk || undefined}
                  className={cn(CONTROL, 'num w-20 text-right')}
                />
                <span className="font-mono text-xs text-ink-muted pb-2">%</span>
              </span>
            </div>
            {!rateOk && <p className="font-mono text-[11px] text-error mt-1.5">1–10%</p>}
          </div>
          {pool.isLoading ? (
            <Loading />
          ) : pool.error ? (
            <ErrorBox message="Couldn't load the accounts" />
          ) : accounts.length === 0 ? (
            <p className="font-mono text-xs text-ink-muted">No accounts with money yet.</p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
              {groups.map(([c, list]) => {
                const total = list.filter(isOn).reduce((s, a) => s + (toNumber(a.value) ?? 0), 0)
                return (
                  <div key={c} className="flex flex-col min-w-0">
                    <div className="flex justify-between items-baseline border-b border-ink pb-1.5">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-ink-muted">{c}</span>
                      <b className="font-mono text-xs num">{money(total, c, { compact: true })}</b>
                    </div>
                    {list.map((a) => (
                      <AccountRow key={a.id} a={a} on={isOn(a)} toggle={() => toggle(a.id)} />
                    ))}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        <div className="px-5 sm:px-7 py-5 flex flex-col gap-4">
          <ol className="flex flex-col">
            {STEPS.map(({ stage, label }) => {
              const s = steps[stage]
              return (
                <li key={stage} className={cn('flex items-center gap-3 py-3 border-b border-line font-mono text-xs', s === 'pending' ? 'text-ink-faint' : 'text-ink')}>
                  <span className="w-4 flex justify-center" aria-hidden="true">
                    {s === 'done' ? (
                      <Check className="w-3.5 h-3.5" />
                    ) : s === 'running' || s === 'retry' ? (
                      error ? '·' : <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      '·'
                    )}
                  </span>
                  <span className="flex-1">{label}</span>
                  {s === 'retry' && <span className="text-[10px] uppercase tracking-widest text-ink-muted">retry</span>}
                </li>
              )
            })}
          </ol>
          {error && <ErrorBox message={error} />}
        </div>
      )}
    </Modal>
  )
}
