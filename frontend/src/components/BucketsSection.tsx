import { useEffect, useState } from 'react'
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Pencil, Trash2 } from 'lucide-react'
import { apiErrorMessage } from '../api/client'
import { Swatch } from './charts/kit'
import { useChartTheme } from './charts/chartTheme'
import { Button } from './ui/Button'
import { FormError, Input, Label } from './ui/Field'
import { ConfirmDialog, Modal } from './ui/Modal'
import { Loading, Table, onlyBelow, showFrom, td, th } from './ui/Primitives'
import { useBucketMutations, useBuckets } from '../hooks/queries'
import { bucketColor, COLOR_SLOTS } from '../lib/buckets'
import { cn } from '../lib/cn'
import type { Bucket } from '../types/api'

const sectionTitle = 'font-mono text-[10px] font-medium uppercase tracking-widest text-ink-muted'
const iconBtn =
  'inline-flex items-center justify-center w-9 h-9 text-ink-muted hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink disabled:opacity-30 disabled:cursor-not-allowed'

function usage(b: Bucket): string {
  const n = b.current_accounts.length
  const parts = [n ? `${n} account${n === 1 ? '' : 's'} now` : 'no account now']
  if (b.milestone_count) parts.push(`in ${b.milestone_count} milestone${b.milestone_count === 1 ? '' : 's'}`)
  return parts.join(' · ')
}

function BucketModal({ open, bucket, onClose }: { open: boolean; bucket: Bucket | null; onClose: () => void }) {
  const theme = useChartTheme()
  const { create, update } = useBucketMutations()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(bucket?.name ?? '')
      setDescription(bucket?.description ?? '')
      setColor(bucket?.color ?? null)
      setError(null)
    }
  }, [open, bucket])

  const valid = name.trim().length > 0
  const save = async () => {
    if (!valid) return
    setError(null)
    const body = { name: name.trim(), description: description.trim() || null, color }
    try {
      if (bucket) await update.mutateAsync({ id: bucket.id, ...body })
      else await create.mutateAsync(body)
      onClose()
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save the bucket'))
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={bucket ? 'Edit bucket' : 'New bucket'}
      size="md"
      footer={
        <div className="flex justify-end gap-5">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} isLoading={create.isPending || update.isPending} disabled={!valid}>
            Save
          </Button>
        </div>
      }
    >
      <div className="px-5 sm:px-7 py-5 flex flex-col gap-5">
        <Input
          id="bucket-name"
          label="Bucket name"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          hint="What the money is for, e.g. Emergency fund, Rivian, GPU rack"
          autoFocus
        />
        <Input id="bucket-desc" label="Description · optional" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
        <div>
          <Label>Colour</Label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Colour">
            {Array.from({ length: COLOR_SLOTS }, (_, i) => (
              <button
                key={i}
                type="button"
                role="radio"
                aria-checked={color === i}
                aria-label={`Colour ${i + 1}`}
                onClick={() => setColor(i)}
                className={cn('w-8 h-8 border flex items-center justify-center', color === i ? 'border-ink' : 'border-transparent hover:border-line')}
              >
                <span className="block w-5 h-5 rounded-[2px]" style={{ background: bucketColor(theme, i) }} />
              </button>
            ))}
          </div>
          {color === null && <p className="font-mono text-[10px] text-ink-faint mt-1">Unpicked: the next free colour is used.</p>}
        </div>
        <FormError message={error} />
      </div>
    </Modal>
  )
}

/** Profile → Buckets: the user's bucket list, shared by every workspace. */
export function BucketsSection() {
  const theme = useChartTheme()
  const { data: buckets = [], isLoading } = useBuckets()
  const { archive, unarchive, remove, reorder, seed } = useBucketMutations()
  const [modal, setModal] = useState<{ open: boolean; bucket: Bucket | null }>({ open: false, bucket: null })
  const [deleting, setDeleting] = useState<Bucket | null>(null)
  const [archiving, setArchiving] = useState<Bucket | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rowError, setRowError] = useState<string | null>(null)

  const live = buckets.filter((b) => !b.archived)
  const archived = buckets.filter((b) => b.archived)
  const ordered = [...live, ...archived]

  const move = (b: Bucket, dir: -1 | 1) => {
    const ids = ordered.map((x) => x.id)
    const i = ids.indexOf(b.id)
    const j = i + dir
    if (j < 0 || j >= ids.length) return
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    reorder.mutate(ids)
  }

  const run = async (fn: () => Promise<unknown>, fail: string, done: () => void) => {
    setError(null)
    try {
      await fn()
      done()
    } catch (err) {
      setError(apiErrorMessage(err, fail))
    }
  }

  return (
    <section className="flex flex-col gap-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={sectionTitle}>Buckets · {live.length} · shared by all your workspaces</h2>
        <div className="flex items-center gap-5">
          <Button variant="secondary" onClick={() => seed.mutate()} isLoading={seed.isPending}>
            Seed defaults
          </Button>
          <Button onClick={() => setModal({ open: true, bucket: null })}>+ New bucket</Button>
        </div>
      </div>
      <p className="font-mono text-[10px] text-ink-muted leading-relaxed">
        Buckets say what money is for. Each account splits its balance across buckets by percent (on the account&apos;s page); milestones with bucket
        targets are set per workspace in Metrics.
      </p>
      {isLoading ? (
        <Loading />
      ) : buckets.length === 0 ? (
        <p className="font-mono text-[11px] text-ink-muted border border-dashed border-line px-4 py-6 text-center">No buckets. Seed the defaults or add your own.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Bucket</th>
              <th className={cn(th, showFrom.md)}>Description</th>
              <th className={cn(th, showFrom.sm)}>In use</th>
              <th className={th}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {ordered.map((b, i) => (
              <tr key={b.id} className={cn(b.archived && '[&_td]:text-ink-muted')}>
                <td className={cn(td, 'whitespace-normal')}>
                  <span className="inline-flex items-center gap-2">
                    <Swatch color={bucketColor(theme, b.color)} />
                    <span className="text-[13px] text-ink">{b.name}</span>
                    {b.archived && <span className="text-[9px] uppercase tracking-widest border border-line px-1">archived</span>}
                  </span>
                  {b.description && <div className={cn('text-[10px] text-ink-muted mt-1', onlyBelow.md)}>{b.description}</div>}
                  <div className={cn('text-[10px] text-ink-muted mt-0.5', onlyBelow.sm)}>{usage(b)}</div>
                </td>
                <td className={cn(td, 'text-ink-muted whitespace-normal min-w-[12rem]', showFrom.md)}>{b.description ?? '—'}</td>
                <td className={cn(td, 'text-ink-muted whitespace-normal', showFrom.sm)} title={b.current_accounts.map((a) => `${a.name} (${a.workspace_name})`).join(', ')}>
                  {usage(b)}
                </td>
                <td className={cn(td, 'text-right py-0')}>
                  <div className="inline-flex items-center">
                    <button type="button" className={iconBtn} aria-label={`Move ${b.name} up`} disabled={i === 0 || reorder.isPending} onClick={() => move(b, -1)}>
                      <ArrowUp className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={iconBtn}
                      aria-label={`Move ${b.name} down`}
                      disabled={i === ordered.length - 1 || reorder.isPending}
                      onClick={() => move(b, 1)}
                    >
                      <ArrowDown className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <button type="button" className={iconBtn} aria-label={`Edit bucket ${b.name}`} onClick={() => setModal({ open: true, bucket: b })}>
                      <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    {b.archived ? (
                      <button
                        type="button"
                        className={iconBtn}
                        aria-label={`Unarchive ${b.name}`}
                        title="Unarchive"
                        onClick={() => run(() => unarchive.mutateAsync(b.id), 'Could not unarchive', () => setRowError(null))}
                      >
                        <ArchiveRestore className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={iconBtn}
                        aria-label={`Archive ${b.name}`}
                        title={b.current_accounts.length ? `In use by ${b.current_accounts.map((a) => a.name).join(', ')} — move them first` : 'Archive'}
                        onClick={() => {
                          setError(null)
                          setRowError(null)
                          setArchiving(b)
                        }}
                      >
                        <Archive className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    )}
                    <button
                      type="button"
                      className={iconBtn}
                      aria-label={`Delete bucket ${b.name}`}
                      disabled={b.used}
                      title={b.used ? 'Has history (splits or milestones) — archive it instead' : 'Delete'}
                      onClick={() => {
                        setError(null)
                        setDeleting(b)
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <FormError message={rowError} />
      <BucketModal open={modal.open} bucket={modal.bucket} onClose={() => setModal({ open: false, bucket: null })} />
      <ConfirmDialog
        open={!!archiving}
        onOpenChange={(o) => !o && setArchiving(null)}
        title="Archive bucket"
        confirmLabel="Archive"
        body={
          archiving && archiving.current_accounts.length ? (
            <>
              “{archiving.name}” still holds money from {archiving.current_accounts.map((a) => `${a.name} (${a.workspace_name})`).join(', ')}. Change
              those accounts&apos; splits first, then archive it.
            </>
          ) : (
            <>
              Archive “{archiving?.name}”? It disappears from new splits and Metrics, but past months in analytics still show it. You can unarchive it
              any time.
            </>
          )
        }
        onConfirm={() => archiving && run(() => archive.mutateAsync(archiving.id), 'Could not archive', () => setArchiving(null))}
        isLoading={archive.isPending}
        error={error}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete bucket"
        body={<>Delete “{deleting?.name}”? It has never been used, so nothing else changes.</>}
        onConfirm={() => deleting && run(() => remove.mutateAsync(deleting.id), 'Could not delete', () => setDeleting(null))}
        isLoading={remove.isPending}
        error={error}
      />
    </section>
  )
}
