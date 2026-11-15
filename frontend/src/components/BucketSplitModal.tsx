import { useEffect, useMemo, useState } from 'react'
import { Trash2, X } from 'lucide-react'
import { apiErrorMessage } from '../api/client'
import { BucketBar } from './BucketBar'
import { Swatch } from './charts/kit'
import { useChartTheme } from './charts/chartTheme'
import { Button } from './ui/Button'
import { DateField } from './ui/DateField'
import { FormError, Label, Select } from './ui/Field'
import { ConfirmDialog, Modal } from './ui/Modal'
import { Loading } from './ui/Primitives'
import { useAccountSplits, useBuckets, useSplitMutations } from '../hooks/queries'
import { bucketColor, centsText, percentCents, splitLabel } from '../lib/buckets'
import { cn } from '../lib/cn'
import { formatDate, money, toNumber, todayISO } from '../lib/format'
import type { Split } from '../types/api'

export interface SplitAccount {
  id: string
  name: string
  currency: string
}

interface Line {
  bucket_id: string
  percent: string
}

const iconBtn = 'inline-flex items-center justify-center w-8 h-8 text-ink-muted hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink'

function range(s: Split): string {
  const from = s.covers_history ? 'All history' : formatDate(s.effective_from)
  return `${from} → ${s.until ? formatDate(s.until) : 'now'}`
}

/**
 * Edit which buckets an account's money is for. Saving adds a new version:
 * the first one covers all history; later ones take effect from a date
 * (backdating allowed) so past months keep the old split.
 */
export function BucketSplitModal({ account, onOpenChange }: { account: SplitAccount | null; onOpenChange: (open: boolean) => void }) {
  const open = !!account
  const theme = useChartTheme()
  const { data: splits, isLoading } = useAccountSplits(account?.id ?? null)
  const { data: buckets = [] } = useBuckets()
  const { create, remove } = useSplitMutations()
  const [lines, setLines] = useState<Line[]>([])
  const [effective, setEffective] = useState(todayISO())
  const [error, setError] = useState<string | null>(null)
  const [undo, setUndo] = useState<Split | null>(null)
  const [undoError, setUndoError] = useState<string | null>(null)
  const [seeded, setSeeded] = useState<string | null>(null)

  // Start from the split in force today (or empty) each time the modal opens.
  useEffect(() => {
    if (!open) setSeeded(null)
  }, [open])
  useEffect(() => {
    if (!open || !splits || seeded === account?.id) return
    setLines(splits.current ? splits.current.lines.map((l) => ({ bucket_id: l.bucket_id, percent: centsText(Math.round(Number(l.percent) * 100)) })) : [])
    setEffective(todayISO())
    setError(null)
    setSeeded(account?.id ?? null)
  }, [open, splits, seeded, account])

  const byId = useMemo(() => new Map(buckets.map((b) => [b.id, b])), [buckets])
  const first = !splits || splits.history.length === 0
  const value = toNumber(splits?.value ?? null)
  const cents = lines.map((l) => percentCents(l.percent))
  const total = cents.reduce<number>((s, c) => s + (c ?? 0), 0)
  const left = 10000 - total
  const invalid = cents.some((c) => c === null)
  const canSave = lines.length > 0 && !invalid && total === 10000 && (first || !!effective)
  const available = buckets.filter((b) => !b.archived && !lines.some((l) => l.bucket_id === b.id))

  const setLine = (i: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)))
  const add = (bucketId: string) => {
    if (!bucketId) return
    // A new line takes whatever is still unallocated (all of it on an empty split).
    setLines((ls) => [...ls, { bucket_id: bucketId, percent: left > 0 ? centsText(left) : '' }])
  }

  const save = async () => {
    if (!account || !canSave) return
    setError(null)
    try {
      await create.mutateAsync({
        accountId: account.id,
        body: { effective_from: first ? null : effective, lines: lines.map((l) => ({ bucket_id: l.bucket_id, percent: l.percent.trim() })) },
      })
      onOpenChange(false)
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save the split'))
    }
  }

  const confirmUndo = async () => {
    if (!account || !undo) return
    setUndoError(null)
    try {
      await remove.mutateAsync({ accountId: account.id, splitId: undo.id })
      setUndo(null)
      setSeeded(null) // re-seed from what's now in force
    } catch (err) {
      setUndoError(apiErrorMessage(err, 'Could not remove this version'))
    }
  }

  const status =
    lines.length === 0 ? (
      <span className="text-ink-muted">Add a bucket to start</span>
    ) : invalid ? (
      <span className="text-error">Use a percent above 0 with up to 2 decimals</span>
    ) : left === 0 ? (
      <span className="text-ink">100% allocated ✓</span>
    ) : left > 0 ? (
      <span className="text-error">{centsText(left)}% still to allocate</span>
    ) : (
      <span className="text-error">Over by {centsText(-left)}%</span>
    )

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      size="lg"
      title={`Buckets · ${account?.name ?? ''}`}
      subtitle={
        <>
          What this account&apos;s money is for. {value !== null && account ? <>Today: {money(value, account.currency)}.</> : null}
        </>
      }
      footer={
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="font-mono text-[11px] num" aria-live="polite">
            {status}
          </p>
          <div className="flex items-center gap-5">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={save} isLoading={create.isPending} disabled={!canSave}>
              Save split
            </Button>
          </div>
        </div>
      }
    >
      {isLoading || !splits ? (
        <div className="px-5 sm:px-7 py-6">
          <Loading />
        </div>
      ) : (
        <div className="px-5 sm:px-7 py-5 flex flex-col gap-6">
          <BucketBar
            height="h-3"
            parts={[
              ...lines.map((l, i) => ({ name: byId.get(l.bucket_id)?.name ?? '?', color: byId.get(l.bucket_id)?.color ?? null, percent: (cents[i] ?? 0) / 100 })),
              ...(left > 0 ? [{ name: 'Unallocated', color: null, percent: left / 100 }] : []),
            ]}
          />

          <div className="flex flex-col">
            {lines.length === 0 && (
              <p className="font-mono text-[11px] text-ink-muted border border-dashed border-line px-4 py-5 text-center">
                Unassigned — counted as &ldquo;Unassigned&rdquo; in analytics. Add one bucket for 100%, or several that add up to 100%.
              </p>
            )}
            {lines.map((l, i) => {
              const b = byId.get(l.bucket_id)
              const c = cents[i]
              const amount = value !== null && c !== null ? (value * c) / 10000 : null
              return (
                <div key={l.bucket_id} className="grid grid-cols-[minmax(0,1fr)_5.5rem_auto] sm:grid-cols-[minmax(0,1fr)_6rem_8rem_auto] items-center gap-x-3 py-2 border-b border-line">
                  <span className="flex items-center gap-2 min-w-0 font-mono text-xs text-ink">
                    <Swatch color={bucketColor(theme, b?.color)} />
                    <span className="truncate">{b?.name ?? 'Unknown bucket'}</span>
                    {b?.archived && <span className="text-[9px] uppercase tracking-widest text-ink-muted">archived</span>}
                  </span>
                  <div className="flex items-center gap-1">
                    <input
                      aria-label={`Percent for ${b?.name ?? 'bucket'}`}
                      inputMode="decimal"
                      value={l.percent}
                      onChange={(e) => setLine(i, { percent: e.target.value.replace(/[^\d.]/g, '') })}
                      className={cn(
                        'w-full bg-transparent border-0 border-b font-mono text-[13px] text-right text-ink py-1 focus:outline-none num',
                        c === null && l.percent ? 'border-error' : 'border-line focus:border-ink',
                      )}
                    />
                    <span className="font-mono text-xs text-ink-muted">%</span>
                  </div>
                  <span className="hidden sm:block font-mono text-xs text-ink-muted text-right num truncate">
                    {amount !== null && account ? money(amount, account.currency) : '—'}
                  </span>
                  <div className="flex items-center justify-end">
                    {left > 0 && c !== null && (
                      <button
                        type="button"
                        className="font-mono text-[10px] uppercase tracking-widest text-ink-muted hover:text-ink hover:underline px-1"
                        title={`Add the remaining ${centsText(left)}% here`}
                        onClick={() => setLine(i, { percent: centsText(c + left) })}
                      >
                        +rest
                      </button>
                    )}
                    <button type="button" className={iconBtn} aria-label={`Remove ${b?.name ?? 'bucket'}`} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}>
                      <X className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 items-start">
            <Select id="split-add" label="Add bucket" value="" onChange={(e) => add(e.target.value)} disabled={available.length === 0}>
              <option value="">{available.length ? 'Choose…' : 'Every bucket is in the split'}</option>
              {available.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </Select>
            {first ? (
              <div>
                <Label>Effective from</Label>
                <p className="font-mono text-[11px] text-ink-muted py-2 leading-relaxed">All history — this is the account&apos;s first split. Later changes get a date.</p>
              </div>
            ) : (
              <DateField
                id="split-from"
                label="Effective from"
                value={effective}
                onChange={(e) => setEffective(e.target.value)}
                max={todayISO()}
                hint="Earlier months keep the previous split. Same date as an existing change replaces it."
                required
              />
            )}
          </div>
          {buckets.length === 0 && <p className="font-mono text-[11px] text-ink-muted">No buckets yet — create them in Profile.</p>}
          <FormError message={error} />

          {splits.history.length > 0 && (
            <section className="flex flex-col gap-2">
              <h3 className="font-mono text-[10px] uppercase tracking-widest text-ink-muted">Split history</h3>
              <ol className="flex flex-col">
                {splits.history.map((s) => (
                  <li key={s.id} className="flex items-center gap-3 py-2 border-b border-line last:border-b-0">
                    <div className="min-w-0 flex-1 flex flex-col gap-1">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-ink-muted num">{range(s)}</span>
                      <BucketBar parts={s.lines.map((l) => ({ name: l.name, color: l.color, percent: l.percent }))} height="h-1.5" />
                      <span className="font-mono text-[11px] text-ink truncate">{splitLabel(s.lines)}</span>
                    </div>
                    <button
                      type="button"
                      className={iconBtn}
                      aria-label={`Remove the split from ${range(s)}`}
                      onClick={() => {
                        setUndoError(null)
                        setUndo(s)
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      )}
      <ConfirmDialog
        open={!!undo}
        onOpenChange={(o) => !o && setUndo(null)}
        title="Remove this split version"
        body={
          <>
            Remove {undo ? splitLabel(undo.lines) : ''} ({undo ? range(undo) : ''})? The neighbouring version takes over those days
            {splits && splits.history.length === 1 ? ' — with none left, the account is Unassigned again' : ''}. Balances are untouched.
          </>
        }
        confirmLabel="Remove"
        onConfirm={confirmUndo}
        isLoading={remove.isPending}
        error={undoError}
      />
    </Modal>
  )
}
