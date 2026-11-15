import { useId, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, Copy, Pencil, Plus } from 'lucide-react'
import { apiErrorMessage } from '../api/client'
import { useChartTheme } from '../components/charts/chartTheme'
import { Swatch } from '../components/charts/kit'
import {
  PaceCheck,
  ProgressBar,
  RowBadge,
  STATUS_WORD,
  TargetStats,
  TrajectoryChart,
  overBy,
  shortBy,
  yearsMonthsText,
  sectionTitle,
} from '../components/metrics/GoalParts'
import { MilestoneModal } from '../components/metrics/MilestoneModal'
import { Button } from '../components/ui/Button'
import { Empty, ErrorBox, Loading, Page, PageHeader } from '../components/ui/Primitives'
import { useWorkspace } from '../context/WorkspaceContext'
import { useBuckets, useMetrics, useMilestones } from '../hooks/queries'
import { trimDecimal } from '../lib/amount'
import { bucketColor } from '../lib/buckets'
import { cn } from '../lib/cn'
import { formatDate, money, percent, toNumber } from '../lib/format'
import type { CurrencyTotal, MilestoneView, TargetRow } from '../types/api'

const iconBtn = 'inline-flex items-center justify-center w-8 h-8 text-ink-muted hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink'

// ── milestone summary ────────────────────────────────────────────────────────

const total3 = (v: string | number | null, cur: string) => money(v, cur, { compact: true, digits: 3 })

/** "USD $1.145M ▰▰▰▱ 59.5%": one currency's target and how much of it is done (no conversion).
 *  The bar is split by bucket, in each bucket's colour, each capped at its own target. */
function TotalLine({ total, rows }: { total: CurrencyTotal; rows: TargetRow[] }) {
  const theme = useChartTheme()
  const cur = total.currency
  const goal = toNumber(total.amount) || 1
  const pct = toNumber(total.progress_pct) ?? 0
  const segments = rows
    .filter((r) => r.currency === cur)
    .map((r) => {
      const reached = Math.max(0, toNumber(r.value_on_date ?? r.current) ?? 0)
      return { id: r.id, name: r.bucket.name, color: bucketColor(theme, r.bucket.color), width: (Math.min(reached, toNumber(r.amount) ?? 0) / goal) * 100 }
    })
    .filter((s) => s.width > 0)
  return (
    <span className="grid grid-cols-[2.5rem_6rem_minmax(4rem,12rem)_auto] items-center gap-x-3">
      <span className="text-ink-muted">{cur}</span>
      <span>{total3(total.amount, cur)}</span>
      <span className="flex h-2 bg-paper-warm overflow-hidden" role="img" aria-label={`${cur} ${trimDecimal(String(pct))}% of ${total3(total.amount, cur)}`}>
        {segments.map((s) => (
          <span key={s.id} className="h-full" style={{ width: `${s.width}%`, background: s.color }} title={s.name} />
        ))}
      </span>
      <span className="font-bold">{percent(pct / 100)}</span>
    </span>
  )
}

// ── one bucket target inside a milestone ─────────────────────────────────────

function RowItem({ row }: { row: TargetRow }) {
  const theme = useChartTheme()
  const color = bucketColor(theme, row.bucket.color)
  const [open, setOpen] = useState(false)
  const detailId = useId()
  const cur = row.currency
  const need = row.need_with_return ?? row.need_flat
  const shown = row.value_on_date ?? row.current // on the date once it has passed
  const over = overBy(row)
  const short = shortBy(row)
  return (
    <li className="border-b border-line last:border-b-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={detailId}
        aria-label={`${row.bucket.name} · ${cur}: ${open ? 'hide' : 'show'} chart and details`}
        onClick={() => setOpen((o) => !o)}
        className="w-full text-left grid grid-cols-[minmax(0,1fr)_auto] sm:grid-cols-[11rem_minmax(0,1fr)_12rem_10rem_9rem_6.5rem] items-center gap-x-4 gap-y-1.5 px-4 py-3 hover:bg-paper-warm/60 focus:outline-none focus-visible:bg-paper-warm"
      >
        <span className="flex items-center gap-2 min-w-0 font-mono text-xs text-ink">
          <ChevronDown className={cn('w-3 h-3 text-ink-muted shrink-0 transition-transform', !open && '-rotate-90')} aria-hidden="true" />
          <Swatch color={color} />
          <span className="truncate">{row.bucket.name}</span>
          <span className="text-[10px] text-ink-muted">{cur}</span>
        </span>
        <span className="sm:hidden justify-self-end">
          <RowBadge row={row} />
        </span>
        <ProgressBar row={row} color={color} className="col-span-2 sm:col-span-1" />
        <span className="font-mono text-[11px] num text-ink">
          {money(shown, cur, { compact: true })} <span className="text-ink-muted">/ {money(row.amount, cur, { compact: true })}</span>{' '}
          <span className="font-bold" style={{ color: row.status === 'missed' ? 'rgb(var(--error))' : color }}>
            {percent((toNumber(row.progress_pct) ?? 0) / 100)}
          </span>
        </span>
        <span className="font-mono text-[11px] num text-ink-muted justify-self-end sm:justify-self-auto">
          {over !== null ? (
            <span className="text-ink">+{money(over, cur, { compact: true })} over</span>
          ) : short !== null ? (
            <span className="text-error">short {money(short, cur, { compact: true })}</span>
          ) : row.status === 'open' ? (
            <>
              <span className="sm:hidden">gap </span>
              {money(row.gap, cur, { compact: true })}
            </>
          ) : (
            STATUS_WORD[row.status].toLowerCase()
          )}
        </span>
        <span className="font-mono text-[11px] num text-ink col-span-2 sm:col-span-1">
          {row.status === 'open' && need !== null ? (
            <>
              {money(need, cur, { compact: true })}/mo
              {row.need_with_return !== null && row.expected_return !== null && (
                <span className="text-ink-muted"> @{trimDecimal(row.expected_return)}%</span>
              )}
            </>
          ) : (
            <span className="text-ink-muted">—</span>
          )}
        </span>
        <span className="hidden sm:block justify-self-end">
          <RowBadge row={row} />
        </span>
      </button>
      {open && (
        <div id={detailId} className="px-4 pb-5 pt-1 grid grid-cols-1 lg:grid-cols-2 gap-4">
          <TargetStats row={row} color={color} />
          <PaceCheck
            paces={row}
            need={row.status === 'open' ? need : null}
            withReturn={row.need_with_return !== null}
            currency={cur}
            trajectory={row.trajectory}
            color={color}
          />
          <TrajectoryChart
            trajectory={row.trajectory}
            color={color}
            currency={cur}
            marks={[{ key: row.id, date: row.target_date, amount: row.amount, label: row.milestone_name, status: row.status }]}
            footnote={`Solid lines: what happened and what's needed. Dashed: estimates. The circle is the ${row.milestone_name} target; the needed path starts from the bucket's value on ${formatDate(row.start_date)}.`}
          />
        </div>
      )}
    </li>
  )
}

// ── one milestone ────────────────────────────────────────────────────────────

export function MilestoneSection({
  view,
  defaultOpen,
  onEdit,
  onCopy = null,
}: {
  view: MilestoneView
  defaultOpen: boolean
  onEdit: (() => void) | null
  onCopy?: (() => void) | null
}) {
  const [open, setOpen] = useState(defaultOpen)
  const bodyId = useId()
  const timeText = view.past ? `passed ${formatDate(view.target_date)}` : `${yearsMonthsText(view.months_left)} left`
  return (
    <section className="border border-line" aria-label={`Milestone ${view.name}`}>
      <div className="flex items-start gap-2 pr-2 hover:bg-paper-warm/40">
        <button
          type="button"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((o) => !o)}
          className="flex-1 min-w-0 text-left flex flex-col gap-1.5 px-4 py-3 focus:outline-none focus-visible:bg-paper-warm"
        >
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <ChevronDown className={cn('w-3.5 h-3.5 text-ink-muted shrink-0 transition-transform', !open && '-rotate-90')} aria-hidden="true" />
            <span className="font-mono text-sm font-bold uppercase tracking-widest text-ink">{view.name}</span>
            <span className="font-mono text-[11px] text-ink-muted">{timeText}</span>
          </span>
          {/* Only: time left, and per currency the target and how much of it is done. */}
          <span className="pl-6 flex flex-col gap-0.5 font-mono text-[11px] num text-ink">
            {view.totals.map((t) => (
              <TotalLine key={t.currency} total={t} rows={view.rows} />
            ))}
          </span>
        </button>
        {onCopy && (
          <button type="button" className={cn(iconBtn, 'mt-2')} aria-label={`Copy milestone ${view.name} into a new one`} title="Copy into a new milestone" onClick={onCopy}>
            <Copy className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
        {onEdit && (
          <button type="button" className={cn(iconBtn, 'mt-2')} aria-label={`Edit milestone ${view.name}`} onClick={onEdit}>
            <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        )}
      </div>
      {open && (
        <div id={bodyId} className="border-t border-line">
          {view.rows.length === 0 ? (
            <p className="px-4 py-3 font-mono text-[11px] text-ink-muted">No active bucket targets (archived buckets are left out). Edit to add some.</p>
          ) : (
            <>
              <div className="hidden sm:grid grid-cols-[11rem_minmax(0,1fr)_12rem_10rem_9rem_6.5rem] gap-x-4 px-4 pt-3 pb-1 font-mono text-[9px] uppercase tracking-widest text-ink-muted">
                <span>Bucket</span>
                <span>Progress · tick = where you should be</span>
                <span>{view.past ? 'On the date / target' : 'Now / target'}</span>
                <span>Gap · over</span>
                <span>Need / month</span>
                <span className="justify-self-end">Status</span>
              </div>
              <ul>
                {view.rows.map((r) => (
                  <RowItem key={r.id} row={r} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  )
}

// ── page ─────────────────────────────────────────────────────────────────────

export default function MetricsPage() {
  const { workspace } = useWorkspace()
  const { data, isLoading, error } = useMetrics()
  const { data: milestones = [] } = useMilestones()
  const { data: buckets = [] } = useBuckets()
  // id: the milestone being edited, or (copy) the one a new milestone starts from.
  const [editor, setEditor] = useState<{ open: boolean; id: string | null; copy?: boolean }>({ open: false, id: null })
  const [showPast, setShowPast] = useState(false)
  const noBuckets = buckets.filter((b) => !b.archived).length === 0
  const picked = editor.id ? (milestones.find((m) => m.id === editor.id) ?? null) : null
  const editing = editor.copy ? null : picked

  const upcoming = (data?.milestones ?? []).filter((m) => !m.past)
  const past = (data?.milestones ?? []).filter((m) => m.past)
  const canEdit = (id: string) => (milestones.some((m) => m.id === id) ? () => setEditor({ open: true, id }) : null)
  const canCopy = (id: string) => (milestones.some((m) => m.id === id) && !noBuckets ? () => setEditor({ open: true, id, copy: true }) : null)

  const add = (
    <Button onClick={() => setEditor({ open: true, id: null })} disabled={noBuckets}>
      <Plus className="w-3.5 h-3.5" aria-hidden="true" /> Milestone
    </Button>
  )

  return (
    <Page>
      <PageHeader
        title="Metrics"
        subtitle={`${workspace?.name ?? ''} · milestones and bucket targets · per currency, no conversion`}
        actions={add}
      />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={apiErrorMessage(error, 'Could not load metrics')} />
      ) : !data || data.milestones.length === 0 ? (
        <Empty title="No milestones yet">
          <p>
            A milestone is a named checkpoint, like “2030”, with one date. Give each bucket the balance it should hold by then (Growth $1,000,000, Emergency fund
            $60,000…) and see, bucket by bucket, how far along it is and what it needs each month.
          </p>
          {noBuckets ? (
            <p>Create buckets in Profile first, then split your accounts across them.</p>
          ) : (
            <span className="flex gap-4 items-center">
              {add}
              <Link to="/accounts" className="underline hover:text-ink">
                Split accounts into buckets
              </Link>
            </span>
          )}
        </Empty>
      ) : (
        <div className="flex flex-col gap-4">
          {upcoming.length === 0 && <p className="font-mono text-[11px] text-ink-muted">Every milestone date has passed. Add the next one.</p>}
          {upcoming.map((m, i) => (
            <MilestoneSection key={m.id} view={m} defaultOpen={i === 0} onEdit={canEdit(m.id)} onCopy={canCopy(m.id)} />
          ))}
          {past.length > 0 && (
            <div className="flex flex-col gap-3 pt-2">
              <button
                type="button"
                aria-expanded={showPast}
                onClick={() => setShowPast((s) => !s)}
                className={cn(sectionTitle, 'flex items-center gap-2 self-start hover:text-ink focus:outline-none focus-visible:underline')}
              >
                <ChevronDown className={cn('w-3 h-3 transition-transform', !showPast && '-rotate-90')} aria-hidden="true" /> Past · {past.length}
              </button>
              {showPast && past.map((m) => <MilestoneSection key={m.id} view={m} defaultOpen={false} onEdit={canEdit(m.id)} onCopy={canCopy(m.id)} />)}
            </div>
          )}
        </div>
      )}
      <MilestoneModal open={editor.open} milestone={editing} copyFrom={editor.copy ? picked : null} onClose={() => setEditor({ open: false, id: null })} />
    </Page>
  )
}
