import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Plus, Trash2 } from 'lucide-react'
import { useChartTheme } from '../components/charts/chartTheme'
import { ChartCard, Legend } from '../components/charts/kit'
import { NewInquiryModal } from '../components/estimator/NewInquiryModal'
import { sectionTitle } from '../components/metrics/GoalParts'
import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/Modal'
import { Empty, ErrorBox, Loading, Page, PageHeader, StatCard, Table, rowLink, showFrom, td, th } from '../components/ui/Primitives'
import { apiErrorMessage } from '../api/client'
import { useInquiries, useInquiryMutations } from '../hooks/queries'
import { cn } from '../lib/cn'
import { adviceRows, balancedDeltas, fiYear, inquiryDate, movingTargets, yearsDelta } from '../lib/estimator'
import { money, percent } from '../lib/format'
import type { InquirySummary } from '../types/api'

const HORIZON = 60
const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function Tiles({ q }: { q: InquirySummary }) {
  const { conservative: c, balanced: b, aggressive: a } = q.fi_years
  return (
    <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <StatCard label="Retire · balanced" value={fiYear(b)} sub={[q.fi_age !== null ? `age ${q.fi_age}` : null, `${fiYear(a)}–${fiYear(c)}`].filter(Boolean).join(' · ')} />
      <StatCard
        label="Target · today"
        value={money(q.fi_today, q.currency, { compact: true, digits: 2 })}
        sub={`${money(q.monthly_expenses, q.currency, { compact: true })} / mo · ${Number(q.withdrawal_rate_pct.toFixed(2))}%`}
      />
      <StatCard label="Pool" value={money(q.pool, q.currency, { compact: true, digits: 1 })} sub={`${percent(q.progress, 0)} there`} />
      <StatCard label="Structure" value={`${q.structure} / 10`} sub={inquiryDate(q.created_at)} />
    </section>
  )
}

/** One column per inquiry: a band from the aggressive to the conservative FI year, a dot at balanced. */
function FiYearChart({ list }: { list: InquirySummary[] }) {
  const theme = useChartTheme()
  const recent = list.slice(-8)
  const cap = new Date().getFullYear() + HORIZON
  const years = recent.flatMap((q) => [q.fi_years.aggressive, q.fi_years.balanced, q.fi_years.conservative].map((y) => y ?? cap))
  const lo = Math.floor((Math.min(...years) - 1) / 5) * 5
  const hi = Math.ceil((Math.max(...years) + 1) / 5) * 5
  const step = hi - lo > 30 ? 10 : 5
  const ticks: number[] = []
  for (let y = hi; y >= lo; y -= step) ticks.push(y)
  const pos = (y: number | null) => `${((hi - (y ?? cap)) / (hi - lo)) * 100}%`
  const label = recent.map((q) => `${shortDate(q.created_at)} ${fiYear(q.fi_years.balanced)}`).join(', ')
  return (
    <ChartCard
      title="FI year by inquiry"
      aside={
        <Legend
          items={[
            { label: 'Aggressive → conservative', color: theme.series[0] },
            { label: 'Balanced', color: theme.ink },
          ]}
        />
      }
    >
      <div className="relative h-60 ml-12 mr-2 mb-8 border-l border-line border-b border-b-ink" role="img" aria-label={`Balanced FI year by inquiry: ${label}`}>
        {ticks.map((y) => (
          <div key={y} className="absolute left-0 right-0 border-t border-line/60" style={{ top: pos(y) }}>
            <span className="absolute -left-12 w-10 text-right -translate-y-1/2 font-mono text-[10px] text-ink-muted">{y}</span>
          </div>
        ))}
        <div className="absolute inset-0 grid" style={{ gridTemplateColumns: `repeat(${recent.length}, minmax(0, 1fr))` }}>
          {recent.map((q) => {
            const { conservative: c, balanced: b, aggressive: a } = q.fi_years
            return (
              <div key={q.id} className="relative">
                <div
                  className="absolute left-1/2 -translate-x-1/2 w-4 rounded-sm opacity-40"
                  style={{ top: pos(c), height: `calc(${pos(a)} - ${pos(c)})`, background: theme.series[0] }}
                  title={`${fiYear(a)}–${fiYear(c)}`}
                />
                <div
                  className="absolute left-1/2 w-3 h-3 -ml-1.5 -mt-1.5 rounded-full border-2 border-paper"
                  style={{ top: pos(b), background: theme.ink }}
                  title={`Balanced ${fiYear(b)}`}
                />
                <span className="absolute right-1/2 mr-3 -translate-y-1/2 font-mono text-[11px] font-bold num text-ink" style={{ top: pos(b) }}>
                  {b ?? '60+'}
                </span>
                <span className="absolute top-full left-0 right-0 text-center pt-2 font-mono text-[10px] text-ink-muted">{shortDate(q.created_at)}</span>
              </div>
            )
          })}
        </div>
      </div>
    </ChartCard>
  )
}

function AdviceOverTime({ list }: { list: InquirySummary[] }) {
  const recent = list.slice(-6)
  const rows = adviceRows(list)
  const targets = movingTargets(list)
  if (rows.length === 0) return null
  return (
    <ChartCard title="Advice over time">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 items-center font-mono text-xs">
        <span />
        <span className="flex gap-1.5">
          {recent.map((q) => (
            <span key={q.id} className="w-3 text-center text-[9px] uppercase text-ink-muted" title={inquiryDate(q.created_at)}>
              {new Date(q.created_at).toLocaleDateString('en-US', { month: 'narrow' })}
            </span>
          ))}
        </span>
        {rows.map((r) => (
          <AdviceRow key={r.title} title={r.title} marks={r.marks} resolved={r.resolved} />
        ))}
      </div>
      {targets.length > 0 && (
        <div className="border-t border-line pt-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-2 font-mono text-xs">
          {targets.map((t) => (
            <TargetTrail key={t.label} label={t.label} values={t.values} />
          ))}
        </div>
      )}
    </ChartCard>
  )
}

function AdviceRow({ title, marks, resolved }: { title: string; marks: boolean[]; resolved: boolean }) {
  return (
    <>
      <span className={cn('truncate', resolved ? 'text-ink-muted line-through' : 'text-ink')}>{title}</span>
      <span className="flex gap-1.5" aria-label={`${marks.filter(Boolean).length} of ${marks.length} inquiries`}>
        {marks.map((m, i) => (
          <span key={i} className={cn('w-3 h-3 border border-ink', m && 'bg-ink')} />
        ))}
      </span>
    </>
  )
}

function TargetTrail({ label, values }: { label: string; values: (number | null)[] }) {
  return (
    <>
      <span className="text-[10px] uppercase tracking-widest text-ink-muted self-center truncate">{label} target</span>
      <span className="num">{values.map((v) => (v === null ? '—' : `${Math.round(v)}%`)).join(' → ')}</span>
    </>
  )
}

export default function EstimatorPage() {
  const { data, isLoading, error } = useInquiries()
  const { remove } = useInquiryMutations()
  const navigate = useNavigate()
  const [creating, setCreating] = useState(false)
  const [deleting, setDeleting] = useState<InquirySummary | null>(null)
  const list = data ?? []
  const latest = list[list.length - 1]
  const deltas = balancedDeltas(list)
  const rows = list.map((q, i) => ({ q, delta: deltas[i] })).reverse()

  return (
    <Page>
      <PageHeader
        title="Wealth estimator"
        actions={
          <Button onClick={() => setCreating(true)}>
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> New inquiry
          </Button>
        }
      />
      {isLoading ? (
        <Loading />
      ) : error ? (
        <ErrorBox message={apiErrorMessage(error)} />
      ) : !latest ? (
        <Empty title="No inquiries yet">
          <Button onClick={() => setCreating(true)}>
            <Plus className="w-3.5 h-3.5" aria-hidden="true" /> New inquiry
          </Button>
        </Empty>
      ) : (
        <>
          <Tiles q={latest} />
          <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
            <div className="lg:col-span-3 min-w-0">
              <FiYearChart list={list} />
            </div>
            <div className="lg:col-span-2 min-w-0">
              <AdviceOverTime list={list} />
            </div>
          </div>
          <section className="flex flex-col gap-3">
            <h2 className={sectionTitle}>Inquiries</h2>
            <Table>
              <thead>
                <tr>
                  <th className={th}>Date</th>
                  <th className={cn(th, 'text-right', showFrom.md)}>Expenses</th>
                  <th className={cn(th, 'text-right', showFrom.md)}>Pool</th>
                  <th className={cn(th, 'text-right')}>FI · C / B / A</th>
                  <th className={cn(th, 'text-right', showFrom.sm)}>vs prev</th>
                  <th className={cn(th, 'text-right', showFrom.lg)}>Structure</th>
                  <th className={cn(th, 'w-12')} />
                </tr>
              </thead>
              <tbody>
                {rows.map(({ q, delta }) => (
                  <tr key={q.id} {...rowLink(() => navigate(`/estimator/${q.id}`))}>
                    <td className={td}>
                      <Link to={`/estimator/${q.id}`} className="hover:underline focus:outline-none focus-visible:underline">
                        {inquiryDate(q.created_at)}
                      </Link>
                    </td>
                    <td className={cn(td, 'text-right num', showFrom.md)}>{money(q.monthly_expenses, q.currency, { compact: true })}</td>
                    <td className={cn(td, 'text-right num', showFrom.md)}>{money(q.pool, q.currency, { compact: true, digits: 1 })}</td>
                    <td className={cn(td, 'text-right num')}>
                      <span className="text-ink-muted">{fiYear(q.fi_years.conservative)} /</span> <b>{fiYear(q.fi_years.balanced)}</b>{' '}
                      <span className="text-ink-muted">/ {fiYear(q.fi_years.aggressive)}</span>
                    </td>
                    <td className={cn(td, 'text-right num', showFrom.sm)}>{yearsDelta(delta)}</td>
                    <td className={cn(td, 'text-right num', showFrom.lg)}>{q.structure}</td>
                    <td className={cn(td, 'text-right')}>
                      <button
                        type="button"
                        onClick={() => setDeleting(q)}
                        aria-label={`Delete inquiry ${inquiryDate(q.created_at)}`}
                        className="text-ink-muted hover:text-error p-1 focus:outline-none focus-visible:text-error"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </section>
        </>
      )}
      <NewInquiryModal open={creating} onOpenChange={setCreating} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete inquiry"
        body={deleting ? inquiryDate(deleting.created_at) : ''}
        isLoading={remove.isPending}
        error={remove.error ? apiErrorMessage(remove.error) : null}
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
      />
    </Page>
  )
}
