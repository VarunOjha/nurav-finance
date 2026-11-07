import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, ImagePlus, Loader2, X } from 'lucide-react'
import { Button } from './ui/Button'
import { Modal } from './ui/Modal'
import { AmountInput } from './ui/AmountInput'
import { Chip, Table, td, th } from './ui/Primitives'
import { cn } from '../lib/cn'
import { parseAmount } from '../lib/amount'
import { ASSET_CLASS_LABELS, formatDate, money } from '../lib/format'
import { MAX_SCREENSHOTS, importScreenshots, screenshotProblem } from '../lib/screenshotImport'
import type { AssetClass, ScreenshotCheck, ScreenshotEvent, ScreenshotField, ScreenshotResult, ScreenshotRow } from '../types/api'

export interface ImportedHolding {
  symbol: string
  name: string | null
  asset_class: AssetClass
  quantity: string
  buy_price: string | null
  current_price: string
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  portfolioId: string
  currency: string
  /** The snapshot date currently on the page. */
  asOf: string
  /** Called once the person confirms; `asOf` is set when they chose the date shown in the screenshots. */
  onAccept: (holdings: ImportedHolding[], asOf: string | null) => void
  /** Screenshots already chosen elsewhere (Add portfolio); read as soon as it opens. */
  initialFiles?: File[] | null
}

interface Shot {
  key: number
  file: File
  url: string
}

interface EditRow {
  id: string
  symbol: string
  name: string
  asset_class: AssetClass
  quantity: string
  buy_price: string
  current_price: string
  source: ScreenshotRow
}

type Phase = 'pick' | 'working' | 'review'

const cellInput =
  'w-full bg-transparent border-0 border-b border-line focus:border-ink focus:outline-none font-mono text-xs text-ink py-1.5 placeholder:text-ink-faint'

let nextShot = 1

const num = (s: string): number | null => {
  if (!s.trim()) return null
  const n = Number(s.replace(/,/g, ''))
  return Number.isFinite(n) ? n : null
}

const toEdit = (r: ScreenshotRow): EditRow => ({
  id: r.id,
  symbol: r.symbol,
  name: r.name ?? '',
  asset_class: r.asset_class,
  quantity: r.quantity ?? '',
  buy_price: r.buy_price ?? '',
  current_price: r.current_price ?? '',
  source: r,
})

/** Problems that stop a row being saved, from what's in the table now. */
function rowErrors(r: EditRow, duplicate: boolean): string[] {
  const out: string[] = []
  const sym = r.symbol.trim()
  if (!sym) out.push('Needs a symbol')
  else if (sym.length > 24) out.push('Symbol is longer than 24 characters')
  else if (duplicate) out.push(`${sym.toUpperCase()} appears twice — each symbol once per snapshot`)
  const q = num(r.quantity)
  if (q === null || q <= 0) out.push('Needs a quantity greater than 0')
  const p = num(r.current_price)
  if (p === null || p < 0) out.push('Needs a current price (0 or more)')
  if (r.buy_price.trim() && (num(r.buy_price) === null || (num(r.buy_price) as number) < 0)) out.push('Buy price must be 0 or more, or blank')
  return out
}

const CHECK_MARK: Record<ScreenshotCheck['status'], string> = { ok: '✓', warn: '!', error: '✕', info: '·' }

// Screenshots → reader → organiser → checks (→ re-read) → this review. The
// person edits and confirms; accepting fills the snapshot table, and they
// still press "Save snapshot". The images are never stored.
export function ScreenshotImportModal({ open, onOpenChange, portfolioId, currency, asOf, onAccept, initialFiles }: Props) {
  const [phase, setPhase] = useState<Phase>('pick')
  const [shots, setShots] = useState<Shot[]>([])
  const [problems, setProblems] = useState<string[]>([])
  const [stages, setStages] = useState<{ stage: string; text: string }[]>([])
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ScreenshotResult | null>(null)
  const [rows, setRows] = useState<EditRow[]>([])
  const [useShotDate, setUseShotDate] = useState(true)
  const [acknowledged, setAcknowledged] = useState(false)
  const [dragging, setDragging] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const shotsRef = useRef<Shot[]>([])
  shotsRef.current = shots

  const reset = () => {
    abort.current?.abort()
    shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url))
    setShots([])
    setProblems([])
    setStages([])
    setError(null)
    setResult(null)
    setRows([])
    setUseShotDate(true)
    setAcknowledged(false)
    setPhase('pick')
  }

  useEffect(() => () => shotsRef.current.forEach((s) => URL.revokeObjectURL(s.url)), [])

  const close = (next: boolean) => {
    if (!next) reset()
    onOpenChange(next)
  }

  const addFiles = useCallback((incoming: File[]) => {
    const found: string[] = []
    const ok: Shot[] = []
    for (const f of incoming) {
      const p = screenshotProblem(f)
      if (p) found.push(p)
      else ok.push({ key: nextShot++, file: f, url: URL.createObjectURL(f) })
    }
    const room = MAX_SCREENSHOTS - shotsRef.current.length
    if (ok.length > room) {
      ok.slice(room).forEach((s) => URL.revokeObjectURL(s.url))
      found.push(`At most ${MAX_SCREENSHOTS} screenshots at a time — ${ok.length - room} left out`)
    }
    setProblems(found)
    if (room > 0) setShots((s) => [...s, ...ok.slice(0, room)])
  }, [])

  // Paste a screenshot straight from the clipboard while picking.
  useEffect(() => {
    if (!open || phase !== 'pick') return
    const onPaste = (e: ClipboardEvent) => {
      const files = Array.from(e.clipboardData?.files ?? []).filter((f) => f.type.startsWith('image/'))
      if (files.length) {
        e.preventDefault()
        addFiles(files.map((f, i) => (f.name ? f : new File([f], `pasted-${i + 1}.png`, { type: f.type }))))
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [open, phase, addFiles])

  // Screenshots handed over from Add portfolio: load them once and start reading.
  const handedOver = useRef(false)
  const [autoRead, setAutoRead] = useState(false)
  useEffect(() => {
    if (open && initialFiles?.length && !handedOver.current) {
      handedOver.current = true
      addFiles(initialFiles)
      setAutoRead(true)
    }
  }, [open, initialFiles, addFiles])

  const removeShot = (key: number) =>
    setShots((s) => {
      const gone = s.find((x) => x.key === key)
      if (gone) URL.revokeObjectURL(gone.url)
      return s.filter((x) => x.key !== key)
    })

  const read = async () => {
    setError(null)
    setStages([])
    setPhase('working')
    const ctrl = new AbortController()
    abort.current = ctrl
    let finished = false
    const onEvent = (e: ScreenshotEvent) => {
      if (e.type === 'stage') setStages((s) => [...s, { stage: e.stage, text: e.text }])
      else if (e.type === 'error') {
        finished = true
        setError(e.message)
        setPhase('pick')
      } else {
        finished = true
        setResult(e.result)
        setRows(e.result.rows.map(toEdit))
        setUseShotDate(!!e.result.as_of_seen && e.result.as_of_seen !== asOf)
        setAcknowledged(false)
        setPhase('review')
      }
    }
    try {
      await importScreenshots(portfolioId, shots.map((s) => s.file), asOf, onEvent, ctrl.signal)
      if (!finished && !ctrl.signal.aborted) {
        setError('The server stopped before finishing. Try again.')
        setPhase('pick')
      }
    } catch (e) {
      setError((e as Error).message)
      setPhase('pick')
    }
  }

  useEffect(() => {
    if (autoRead && shots.length) {
      setAutoRead(false)
      void read()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, after the handed-over files land
  }, [autoRead, shots.length])

  const cancelReading = () => {
    abort.current?.abort()
    setPhase('pick')
  }

  // ── review ──
  const edit = (id: string, patch: Partial<EditRow>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  const symbolCounts = new Map<string, number>()
  rows.forEach((r) => {
    const s = r.symbol.trim().toUpperCase()
    if (s) symbolCounts.set(s, (symbolCounts.get(s) ?? 0) + 1)
  })
  const errorsById = new Map(rows.map((r) => [r.id, rowErrors(r, (symbolCounts.get(r.symbol.trim().toUpperCase()) ?? 0) > 1)]))
  const errorCount = [...errorsById.values()].filter((e) => e.length).length
  const warnRows = rows.filter((r) => r.source.issues.some((i) => i.level === 'warn')).length
  const warnChecks = (result?.checks ?? []).filter((c) => c.status === 'warn').length
  const warnings = warnRows + warnChecks
  const total = rows.reduce((s, r) => s + (num(r.quantity) ?? 0) * (num(r.current_price) ?? 0), 0)
  const canAccept = phase === 'review' && rows.length > 0 && errorCount === 0 && (warnings === 0 || acknowledged)
  const shotDate = result?.as_of_seen && result.as_of_seen !== asOf ? result.as_of_seen : null

  const accept = () => {
    if (!canAccept) return
    onAccept(
      rows.map((r) => ({
        symbol: r.symbol.trim().toUpperCase(),
        name: r.name.trim() || null,
        asset_class: r.asset_class,
        quantity: parseAmount(r.quantity),
        buy_price: r.buy_price.trim() ? parseAmount(r.buy_price) : null,
        current_price: parseAmount(r.current_price),
      })),
      shotDate && useShotDate ? shotDate : null,
    )
    close(false)
  }

  const marker = (r: EditRow, f: ScreenshotField) => {
    const derived = r.source.derived.includes(f)
    const rechecked = r.source.rechecked.includes(f)
    const printed = r.source.printed[f]
    const title = [
      printed ? `Screenshot shows: ${printed}` : null,
      derived ? 'Calculated by the app' : null,
      rechecked ? 'Corrected on a second read' : null,
    ]
      .filter(Boolean)
      .join(' · ')
    return { title: title || undefined, className: derived || rechecked ? 'bg-paper-warm' : undefined }
  }

  const footer =
    phase === 'review' ? (
      <div className="flex flex-col gap-3">
        {warnings > 0 && (
          <label className="flex items-start gap-2 font-mono text-[11px] text-ink cursor-pointer">
            <input type="checkbox" className="mt-0.5" checked={acknowledged} onChange={(e) => setAcknowledged(e.target.checked)} />
            <span>
              I've checked the {warnings} warning{warnings === 1 ? '' : 's'} (marked !) against my screenshots
            </span>
          </label>
        )}
        <div className="flex flex-wrap items-center justify-end gap-5">
          <Button variant="ghost" onClick={() => setPhase('pick')}>
            ← Screenshots
          </Button>
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button disabled={!canAccept} onClick={accept}>
            {`Use ${rows.length} holding${rows.length === 1 ? '' : 's'}`}
          </Button>
        </div>
      </div>
    ) : phase === 'working' ? (
      <div className="flex justify-end">
        <Button variant="ghost" onClick={cancelReading}>
          Stop
        </Button>
      </div>
    ) : (
      <div className="flex flex-wrap items-center justify-end gap-5">
        <Button variant="ghost" onClick={() => close(false)}>
          Cancel
        </Button>
        <Button disabled={shots.length === 0} onClick={read}>
          {shots.length ? `Read ${shots.length} screenshot${shots.length === 1 ? '' : 's'}` : 'Read screenshots'}
        </Button>
      </div>
    )

  return (
    <Modal
      open={open}
      onOpenChange={close}
      size="xl"
      title="Import holdings from screenshots"
      subtitle={
        phase === 'review'
          ? 'Check every row against your screenshots and fix anything that’s off. Using them fills the snapshot table; you still save it.'
          : 'Screenshots of the holdings page, from the app or the website. They’re read by an AI model and not stored.'
      }
      footer={footer}
    >
      <div className="px-5 sm:px-7 py-5 flex flex-col gap-5">
        {phase === 'pick' && (
          <>
            <div
              role="button"
              tabIndex={0}
              aria-label="Add screenshots"
              onClick={() => fileInput.current?.click()}
              onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setDragging(true)
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragging(false)
                addFiles(Array.from(e.dataTransfer.files))
              }}
              className={cn(
                'border border-dashed px-6 py-8 flex flex-col items-center gap-2 text-center cursor-pointer focus:outline-none focus-visible:ring-1 focus-visible:ring-ink',
                dragging ? 'border-ink bg-paper-warm' : 'border-line hover:border-ink',
              )}
            >
              <ImagePlus className="w-5 h-5 text-ink-muted" aria-hidden="true" />
              <p className="font-mono text-xs text-ink">Drop screenshots here, click to choose, or paste (Ctrl+V)</p>
              <p className="font-mono text-[11px] text-ink-muted">
                Up to {MAX_SCREENSHOTS} · PNG, JPEG or WebP · 10 MB each. Scrolled a long list? Add each screen; overlaps are merged.
              </p>
              <input
                ref={fileInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                multiple
                className="hidden"
                data-testid="screenshot-input"
                onChange={(e) => {
                  addFiles(Array.from(e.target.files ?? []))
                  e.target.value = ''
                }}
              />
            </div>

            {problems.length > 0 && (
              <ul role="alert" className="font-mono text-[11px] text-error space-y-0.5">
                {problems.map((p, i) => (
                  <li key={i}>{p}</li>
                ))}
              </ul>
            )}
            {error && (
              <div role="alert" className="border border-error/40 px-4 py-3 font-mono text-xs text-error">
                {error}
              </div>
            )}

            {shots.length > 0 && (
              <ul className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {shots.map((s, i) => (
                  <li key={s.key} className="border border-line flex flex-col">
                    <div className="h-40 bg-paper-warm flex items-start justify-center overflow-hidden">
                      <img src={s.url} alt={`Screenshot ${i + 1}`} className="w-full object-cover object-top" />
                    </div>
                    <div className="flex items-center justify-between gap-2 px-2 py-1.5 border-t border-line">
                      <span className="font-mono text-[10px] uppercase tracking-widest text-ink-muted truncate">Screenshot {i + 1}</span>
                      <button type="button" aria-label={`Remove screenshot ${i + 1}`} onClick={() => removeShot(s.key)} className="p-1 text-ink-muted hover:text-error">
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        {phase === 'working' && (
          <ol aria-live="polite" className="flex flex-col gap-2 font-mono text-xs py-4">
            {stages.length === 0 && (
              <li className="flex items-center gap-2 text-ink">
                <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> Uploading…
              </li>
            )}
            {stages.map((s, i) => {
              const current = i === stages.length - 1
              return (
                <li key={i} className={cn('flex items-center gap-2', current ? 'text-ink' : 'text-ink-muted')}>
                  {current ? <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> : <Check className="w-3.5 h-3.5" aria-hidden="true" />}
                  {s.text}
                </li>
              )
            })}
            <li className="text-[11px] text-ink-faint pt-2">This usually takes 20–60 seconds.</li>
          </ol>
        )}

        {phase === 'review' && result && (
          <>
            <ul className="flex flex-col gap-1 font-mono text-xs">
              {result.checks.map((c, i) => (
                <li key={i} className={cn('flex gap-2', c.status === 'warn' || c.status === 'error' ? 'text-error' : c.status === 'ok' ? 'text-ink' : 'text-ink-muted')}>
                  <span className="w-3 shrink-0 text-center font-bold">{CHECK_MARK[c.status]}</span>
                  <span>{c.message}</span>
                </li>
              ))}
              {result.recheck && (
                <li className="flex gap-2 text-ink-muted">
                  <span className="w-3 shrink-0 text-center">·</span>
                  <span>{result.recheck}</span>
                </li>
              )}
              {result.notes.map((n, i) => (
                <li key={`n${i}`} className="flex gap-2 text-ink-muted">
                  <span className="w-3 shrink-0 text-center">·</span>
                  <span>{n}</span>
                </li>
              ))}
            </ul>

            {shotDate && (
              <label className="flex items-center gap-2 font-mono text-[11px] text-ink cursor-pointer">
                <input type="checkbox" checked={useShotDate} onChange={(e) => setUseShotDate(e.target.checked)} />
                Use {formatDate(shotDate)} (the date in the screenshots) as the snapshot date, instead of {formatDate(asOf)}
              </label>
            )}

            {rows.length > 0 && (
              <Table>
                <thead>
                  <tr>
                    <th className={th}>Symbol</th>
                    <th className={th}>Name</th>
                    <th className={th}>Class</th>
                    <th className={cn(th, 'text-right')}>Quantity</th>
                    <th className={cn(th, 'text-right')}>Buy price · {currency}</th>
                    <th className={cn(th, 'text-right')}>Current price · {currency}</th>
                    <th className={cn(th, 'text-right')}>Value</th>
                    <th className={th}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const errs = errorsById.get(r.id) ?? []
                    const notes = r.source.issues.filter((i) => i.level !== 'error')
                    const q = num(r.quantity)
                    const p = num(r.current_price)
                    const m = { q: marker(r, 'quantity'), b: marker(r, 'buy_price'), p: marker(r, 'current_price') }
                    return [
                      <tr key={r.id} className={cn(errs.length || notes.some((i) => i.level === 'warn') ? '[&>td]:border-b-0' : undefined)}>
                        <td className={cn(td, 'min-w-[7rem]')}>
                          <div className="flex items-center gap-1.5">
                            <input aria-label="Symbol" className={cn(cellInput, 'uppercase font-medium')} value={r.symbol} onChange={(e) => edit(r.id, { symbol: e.target.value.toUpperCase() })} />
                            {r.source.symbol_basis === 'proposed' && <Chip>new?</Chip>}
                            {r.source.rechecked.includes('added') && <Chip active>found</Chip>}
                          </div>
                        </td>
                        <td className={cn(td, 'min-w-[10rem]')}>
                          <input aria-label="Name" className={cellInput} value={r.name} onChange={(e) => edit(r.id, { name: e.target.value })} />
                        </td>
                        <td className={cn(td, 'min-w-[7rem]')}>
                          <select
                            aria-label="Asset class"
                            className={cn(cellInput, 'cursor-pointer [&>option]:bg-paper')}
                            value={r.asset_class}
                            onChange={(e) => edit(r.id, { asset_class: e.target.value as AssetClass })}
                          >
                            {Object.entries(ASSET_CLASS_LABELS).map(([v, l]) => (
                              <option key={v} value={v}>
                                {l}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className={cn(td, 'min-w-[6rem]', m.q.className)} title={m.q.title}>
                          <AmountInput aria-label="Quantity" maxDecimals={8} className={cn(cellInput, 'text-right num')} value={r.quantity} onValueChange={(v) => edit(r.id, { quantity: v })} />
                        </td>
                        <td className={cn(td, 'min-w-[6rem]', m.b.className)} title={m.b.title}>
                          <AmountInput
                            aria-label="Buy price"
                            currency={currency}
                            maxDecimals={6}
                            className={cn(cellInput, 'text-right num')}
                            value={r.buy_price}
                            onValueChange={(v) => edit(r.id, { buy_price: v })}
                            placeholder="optional"
                          />
                        </td>
                        <td className={cn(td, 'min-w-[6rem]', m.p.className)} title={m.p.title}>
                          <AmountInput
                            aria-label="Current price"
                            currency={currency}
                            maxDecimals={6}
                            className={cn(cellInput, 'text-right num')}
                            value={r.current_price}
                            onValueChange={(v) => edit(r.id, { current_price: v })}
                          />
                        </td>
                        <td className={cn(td, 'text-right num font-medium')}>{q !== null && p !== null ? money(q * p, currency) : '—'}</td>
                        <td className={cn(td, 'text-right py-0')}>
                          <button
                            type="button"
                            aria-label={`Remove ${r.symbol || 'row'}`}
                            onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}
                            className="p-2 text-ink-muted hover:text-error"
                          >
                            <X className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </td>
                      </tr>,
                      errs.length || notes.length ? (
                        <tr key={`${r.id}-issues`}>
                          <td colSpan={8} className="px-4 pb-2.5 pt-0 border-b border-line">
                            <ul className="font-mono text-[11px] space-y-0.5">
                              {errs.map((e, i) => (
                                <li key={`e${i}`} className="text-error">
                                  ✕ {e}
                                </li>
                              ))}
                              {notes.map((n, i) => (
                                <li key={`n${i}`} className={n.level === 'warn' ? 'text-error' : 'text-ink-muted'}>
                                  {n.level === 'warn' ? '!' : '·'} {n.message}
                                </li>
                              ))}
                            </ul>
                          </td>
                        </tr>
                      ) : null,
                    ]
                  })}
                </tbody>
              </Table>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 font-mono text-[11px] text-ink-muted">
              <span>
                {rows.length} holding{rows.length === 1 ? '' : 's'} · total <span className="text-ink num">{money(total, currency)}</span>
                {errorCount > 0 && <span className="text-error"> · fix {errorCount} row{errorCount === 1 ? '' : 's'} to continue</span>}
              </span>
              <span>
                Shaded cells were calculated or re-read; hover for the screenshot’s text · {result.model} · ${result.cost_usd.toFixed(3)}
              </span>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
