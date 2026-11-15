import { useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { apiErrorMessage } from '../../api/client'
import { useAccounts, useBuckets, useMilestoneMutations, useOverview } from '../../hooks/queries'
import { parseAmount, trimDecimal } from '../../lib/amount'
import { bucketColor } from '../../lib/buckets'
import { CURRENCIES, money, todayISO } from '../../lib/format'
import { useChartTheme } from '../charts/chartTheme'
import { Swatch } from '../charts/kit'
import { AmountInput } from '../ui/AmountInput'
import { Button } from '../ui/Button'
import { DateField } from '../ui/DateField'
import { FormError, Input } from '../ui/Field'
import { ConfirmDialog, Modal } from '../ui/Modal'
import type { Milestone } from '../../types/api'

interface LineDraft {
  key: string
  bucket_id: string
  currency: string
  amount: string
  expected_return: string
}

const RETURN_RE = /^-?\d{1,3}(\.\d{1,3})?$/
const cell = 'w-full bg-transparent border-b border-line focus:border-ink focus:outline-none font-mono text-xs text-ink py-1.5 min-h-9'
const iconBtn = 'inline-flex items-center justify-center w-8 h-8 text-ink-muted hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink'

let seq = 0
const newKey = () => `l${++seq}`

/** "2035" → "2035-12-31"; anything else → null. */
export function yearEnd(name: string): string | null {
  return /^\s*(19|20|21)\d{2}\s*$/.test(name) ? `${name.trim()}-12-31` : null
}

/**
 * Create or edit a milestone: name, one date, measure-from, and a target balance per bucket (skip any).
 * With `copyFrom` (and no `milestone`) it creates a NEW milestone prefilled from that one, to tweak.
 */
export function MilestoneModal({
  open,
  milestone,
  copyFrom = null,
  onClose,
}: {
  open: boolean
  milestone: Milestone | null
  copyFrom?: Milestone | null
  onClose: () => void
}) {
  const theme = useChartTheme()
  const { data: buckets = [] } = useBuckets()
  const { data: accounts = [] } = useAccounts()
  const { data: overview } = useOverview('6m')
  const { create, update, remove } = useMilestoneMutations()
  const [name, setName] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [dateFromName, setDateFromName] = useState(false)
  const [startDate, setStartDate] = useState(todayISO())
  const [note, setNote] = useState('')
  const [lines, setLines] = useState<LineDraft[]>([])
  const [error, setError] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const currencies = useMemo(() => {
    // Most-used currency first (the default for new lines), then the rest.
    const count = new Map<string, number>()
    for (const a of accounts) count.set(a.currency, (count.get(a.currency) ?? 0) + 1)
    const used = [...count.keys()].sort((x, y) => (count.get(y) ?? 0) - (count.get(x) ?? 0) || x.localeCompare(y))
    return [...used, ...CURRENCIES.filter((c) => !used.includes(c))]
  }, [accounts])
  const byId = useMemo(() => new Map(buckets.map((b) => [b.id, b])), [buckets])
  const live = buckets.filter((b) => !b.archived)
  // Today's value of each bucket per currency, to set targets against.
  const now = useMemo(() => {
    const out = new Map<string, string | null>()
    for (const c of overview?.buckets.currencies ?? []) for (const r of c.rows) if (r.bucket_id) out.set(`${r.bucket_id}|${c.currency}`, r.current)
    return out
  }, [overview])

  useEffect(() => {
    if (!open) return
    setError(null)
    setDeleteError(null)
    if (milestone) {
      setName(milestone.name)
      setTargetDate(milestone.target_date)
      setDateFromName(false)
      setStartDate(milestone.start_date)
      setNote(milestone.note ?? '')
      setLines(
        milestone.lines.map((l) => ({
          key: newKey(),
          bucket_id: l.bucket_id,
          currency: l.currency,
          amount: trimDecimal(l.amount),
          expected_return: l.expected_return ? trimDecimal(l.expected_return) : '',
        })),
      )
    } else if (copyFrom) {
      // A copy: same buckets, amounts, returns, date and note; measured from today; a new name.
      // If the date was the year in the name, renaming it to another year moves the date too.
      setName(`${copyFrom.name} copy`)
      setTargetDate(copyFrom.target_date)
      setDateFromName(yearEnd(copyFrom.name) === copyFrom.target_date)
      setStartDate(todayISO())
      setNote(copyFrom.note ?? '')
      setLines(
        copyFrom.lines
          .filter((l) => !l.archived) // archived buckets can't go in a new milestone
          .map((l) => ({
            key: newKey(),
            bucket_id: l.bucket_id,
            currency: l.currency,
            amount: trimDecimal(l.amount),
            expected_return: l.expected_return ? trimDecimal(l.expected_return) : '',
          })),
      )
    } else {
      setName('')
      setTargetDate('')
      setDateFromName(false)
      setStartDate(todayISO())
      setNote('')
      setLines(live[0] ? [{ key: newKey(), bucket_id: live[0].id, currency: currencies[0] ?? 'USD', amount: '', expected_return: '' }] : [])
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, milestone, copyFrom])

  const onName = (value: string) => {
    setName(value)
    // A year as the name fills in Dec 31 of that year, until the date is set by hand.
    const auto = yearEnd(value)
    if (auto && (!targetDate || dateFromName)) {
      setTargetDate(auto)
      setDateFromName(true)
    }
  }

  const setLine = (key: string, patch: Partial<LineDraft>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)))
  const addLine = () => {
    const currency = lines[lines.length - 1]?.currency ?? currencies[0] ?? 'USD'
    const taken = new Set(lines.filter((l) => l.currency === currency).map((l) => l.bucket_id))
    const bucket = live.find((b) => !taken.has(b.id)) ?? live[0]
    if (bucket) setLines((ls) => [...ls, { key: newKey(), bucket_id: bucket.id, currency, amount: '', expected_return: '' }])
  }

  // Validation, per line and overall.
  const seen = new Map<string, number>()
  for (const l of lines) seen.set(`${l.bucket_id}|${l.currency}`, (seen.get(`${l.bucket_id}|${l.currency}`) ?? 0) + 1)
  const lineError = (l: LineDraft): string | null => {
    if ((seen.get(`${l.bucket_id}|${l.currency}`) ?? 0) > 1) return `${byId.get(l.bucket_id)?.name ?? 'This bucket'} · ${l.currency} is here twice`
    if (l.amount && !(Number(parseAmount(l.amount)) > 0)) return 'The target must be above 0'
    if (l.expected_return.trim() && !RETURN_RE.test(l.expected_return.trim())) return 'Return: a percent like 7 or 6.5'
    return null
  }
  const nameTrim = name.trim()
  const dateError = targetDate && startDate && targetDate <= startDate ? 'Must be after the measure-from date' : null
  const lineErrors = lines.map(lineError)
  const valid =
    !!nameTrim &&
    !!targetDate &&
    !!startDate &&
    !dateError &&
    lines.length > 0 &&
    lineErrors.every((e) => e === null) &&
    lines.every((l) => Number(parseAmount(l.amount)) > 0)

  const save = async () => {
    if (!valid) return
    setError(null)
    const body = {
      name: nameTrim,
      target_date: targetDate,
      start_date: startDate,
      note: note.trim() || null,
      lines: lines.map((l) => ({ bucket_id: l.bucket_id, currency: l.currency, amount: parseAmount(l.amount), expected_return: l.expected_return.trim() || null })),
    }
    try {
      if (milestone) await update.mutateAsync({ id: milestone.id, body })
      else await create.mutateAsync(body)
      onClose()
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save the milestone'))
    }
  }

  const doDelete = async () => {
    if (!milestone) return
    setDeleteError(null)
    try {
      await remove.mutateAsync(milestone.id)
      setConfirmDelete(false)
      onClose()
    } catch (err) {
      setDeleteError(apiErrorMessage(err, 'Could not delete the milestone'))
    }
  }

  return (
    <>
      <Modal
        open={open}
        onOpenChange={(o) => !o && onClose()}
        title={milestone ? `Edit milestone · ${milestone.name}` : copyFrom ? `New milestone · copy of ${copyFrom.name}` : 'New milestone'}
        subtitle="A named checkpoint with one date. Give each bucket the balance it should hold by then; leave out any bucket you don't want to track."
        size="lg"
        footer={
          <div className="flex items-center justify-between gap-5">
            <span>
              {milestone && (
                <Button variant="ghost" onClick={() => setConfirmDelete(true)}>
                  Delete<span className="hidden sm:inline">&nbsp;milestone</span>
                </Button>
              )}
            </span>
            <span className="flex gap-5">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={save} isLoading={create.isPending || update.isPending} disabled={!valid}>
                Save<span className="hidden sm:inline">&nbsp;milestone</span>
              </Button>
            </span>
          </div>
        }
      >
        <div className="px-5 sm:px-7 py-5 flex flex-col gap-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-5">
            <Input id="ms-name" label="Name" placeholder="e.g. 2030" value={name} maxLength={80} onChange={(e) => onName(e.target.value)} required />
            <DateField
              id="ms-date"
              label="Date"
              value={targetDate}
              onChange={(e) => {
                setTargetDate(e.target.value)
                setDateFromName(false)
              }}
              min={startDate || undefined}
              error={dateError}
              hint={dateFromName ? 'Dec 31 of the year in the name' : undefined}
              required
            />
            <DateField
              id="ms-start"
              label="Measure from"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              hint="Each bucket's needed path starts from its value on this day"
              required
            />
          </div>

          <section className="flex flex-col gap-2" aria-label="Bucket targets">
            <div className="hidden sm:grid grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,9rem)_5rem_2rem] gap-3 font-mono text-[10px] uppercase tracking-widest text-ink-muted">
              <span>Bucket</span>
              <span>Currency</span>
              <span>Target balance</span>
              <span>Return %/yr</span>
              <span />
            </div>
            {lines.length === 0 && <p className="font-mono text-[11px] text-ink-muted">Add at least one bucket.</p>}
            {lines.map((l) => {
              const bucket = byId.get(l.bucket_id)
              const archived = !!bucket?.archived
              const nowValue = now.get(`${l.bucket_id}|${l.currency}`)
              const err = lineError(l)
              const label = bucket?.name ?? 'bucket'
              return (
                <div key={l.key} className="border-b border-line sm:border-0 pb-3 sm:pb-0">
                  <div className="grid grid-cols-[minmax(0,1fr)_5.5rem_2rem] sm:grid-cols-[minmax(0,1fr)_5.5rem_minmax(0,9rem)_5rem_2rem] gap-x-3 gap-y-2 items-center">
                    <span className="flex items-center gap-2 min-w-0">
                      {bucket && <Swatch color={bucketColor(theme, bucket.color)} />}
                      <select
                        aria-label={`Bucket for line ${label}`}
                        className={cell}
                        value={l.bucket_id}
                        disabled={archived}
                        onChange={(e) => setLine(l.key, { bucket_id: e.target.value })}
                      >
                        {buckets
                          .filter((b) => !b.archived || b.id === l.bucket_id)
                          .map((b) => (
                            <option key={b.id} value={b.id}>
                              {b.name}
                              {b.archived ? ' (archived)' : ''}
                            </option>
                          ))}
                      </select>
                    </span>
                    <select aria-label={`Currency for ${label}`} className={cell} value={l.currency} onChange={(e) => setLine(l.key, { currency: e.target.value })}>
                      {currencies.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                    {/* Phones: amount and return wrap to a second row. */}
                    <span className="row-start-2 sm:row-start-auto">
                      <AmountInput
                        aria-label={`Target balance for ${label}`}
                        className={`${cell} num`}
                        placeholder="1,000,000"
                        currency={l.currency}
                        value={l.amount}
                        onValueChange={(v) => setLine(l.key, { amount: v })}
                      />
                    </span>
                    <span className="row-start-2 col-span-2 sm:row-start-auto sm:col-span-1">
                      <input
                        aria-label={`Expected return for ${label}`}
                        className={`${cell} num`}
                        inputMode="decimal"
                        placeholder="% / yr"
                        value={l.expected_return}
                        onChange={(e) => setLine(l.key, { expected_return: e.target.value.replace(/[^\d.-]/g, '') })}
                      />
                    </span>
                    <button
                      type="button"
                      className={`${iconBtn} row-start-1 col-start-3 sm:row-start-auto sm:col-start-auto`}
                      aria-label={`Remove ${label}`}
                      onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
                    >
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                  <p className="font-mono text-[10px] mt-1 pl-5">
                    {err ? (
                      <span className="text-error">{err}</span>
                    ) : (
                      <span className="text-ink-faint">
                        {archived ? 'Archived: kept here, left out of the numbers · ' : ''}
                        {nowValue != null ? `now ${money(nowValue, l.currency)}` : `nothing in ${l.currency} yet`}
                      </span>
                    )}
                  </p>
                </div>
              )
            })}
            <span>
              <Button variant="secondary" onClick={addLine} disabled={live.length === 0}>
                <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Add bucket
              </Button>
            </span>
          </section>

          <Input id="ms-note" label="Note · optional" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
          <FormError message={error} />
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(false)}
        title="Delete milestone"
        body={<>Delete {milestone ? `“${milestone.name}”` : 'this milestone'} and its bucket targets? Balances and splits are untouched.</>}
        onConfirm={doDelete}
        isLoading={remove.isPending}
        error={deleteError}
      />
    </>
  )
}
