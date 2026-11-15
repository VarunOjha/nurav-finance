import { useState, type ReactNode } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Check, Trash2 } from 'lucide-react'
import { axisTick, useChartTheme } from '../components/charts/chartTheme'
import { ChartCard, ChartTooltip, Legend } from '../components/charts/kit'
import { sectionTitle } from '../components/metrics/GoalParts'
import { Button } from '../components/ui/Button'
import { ConfirmDialog } from '../components/ui/Modal'
import { ErrorBox, Loading, Page, PageHeader, ShareBar, StatCard, Table, showFrom, td, th } from '../components/ui/Primitives'
import { apiErrorMessage } from '../api/client'
import { useInquiry, useInquiryMutations } from '../hooks/queries'
import { cn } from '../lib/cn'
import { SCENARIO_LABEL, afterRetiring, fiYear, incomeGrowthPct, fxLabel, inquiryDate, monthsToTarget, monthsUntil, savingFor, yearAfter, yearsDelta } from '../lib/estimator'
import { money, percent, toNumber } from '../lib/format'
import { parseAmount } from '../lib/amount'
import { AmountInput } from '../components/ui/AmountInput'
import { CONTROL } from '../components/ui/Field'
import { SCENARIO_KEYS, type InquiryDetail, type InquiryResult, type InquiryScenario, type ScenarioKey } from '../types/api'

const pct = (v: number, digits = 1) => `${Number(v.toFixed(digits))}%`

function Card({ title, aside, children, className }: { title: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn('border border-line p-4 sm:p-5 flex flex-col gap-3 min-w-0', className)}>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className={sectionTitle}>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

function Chip({ children, solid = false }: { children: ReactNode; solid?: boolean }) {
  return (
    <span
      className={cn(
        'shrink-0 font-mono text-[10px] uppercase tracking-widest border border-ink px-1.5 py-0.5 whitespace-nowrap num',
        solid ? 'bg-ink text-paper' : 'text-ink',
      )}
    >
      {children}
    </span>
  )
}

/** Once retired: income keeps growing (same figure as the After retiring table), or the money runs out. */
function afterRetiringText(s: InquiryScenario, r: InquiryResult): string {
  if (!s.preserved) return `Runs out after ${Math.round(s.lasts_years ?? 0)} yrs`
  return `Never runs out · income +${pct(incomeGrowthPct(s.return_pct, r.expense_inflation_pct, r.withdrawal_rate_pct))}/yr`
}

function ScenarioPicker({ r, value, onChange }: { r: InquiryResult; value: ScenarioKey; onChange: (k: ScenarioKey) => void }) {
  return (
    <section role="group" aria-label="Scenario" className="grid grid-cols-3 gap-3">
      {SCENARIO_KEYS.map((k) => {
        const s = r.scenarios[k]
        const on = k === value
        return (
          <button
            key={k}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(k)}
            className={cn(
              'text-left border px-3 sm:px-4 py-3 flex flex-col gap-1 min-w-0 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink',
              on ? 'border-ink bg-ink text-paper' : 'border-line text-ink hover:border-ink',
            )}
          >
            <span className="font-mono text-[10px] uppercase tracking-widest">{SCENARIO_LABEL[k]}</span>
            <span className="font-mono text-2xl font-bold num leading-none">{fiYear(s.fi_year)}</span>
            <span className="font-mono text-[11px] opacity-75 truncate">
              {[s.fi_age !== null ? `age ${s.fi_age}` : null, `${pct(s.return_pct)} growth`].filter(Boolean).join(' · ')}
            </span>
            <span className="font-mono text-[11px] truncate">{afterRetiringText(s, r)}</span>
          </button>
        )
      })}
    </section>
  )
}

function Tiles({ d, k }: { d: InquiryDetail; k: ScenarioKey }) {
  const r = d.result
  const s = r.scenarios[k]
  const cur = r.currency
  const short = (v: number | null) => money(v, cur, { compact: true, digits: 2 })
  const rebalDelta = s.rebalanced_years !== null && s.years !== null ? s.rebalanced_years - s.years : null
  return (
    <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
      <StatCard label="Target · today" value={short(s.fi_today)} sub={`${short(r.monthly_expenses * 12)} / yr ÷ ${pct(r.withdrawal_rate_pct, 2)}`} />
      <StatCard
        label={`Target · ${fiYear(s.fi_year)}`}
        value={short(s.fi_nominal)}
        sub={s.fi_nominal !== null ? `${pct(r.withdrawal_rate_pct, 2)} = ${money((s.fi_nominal * r.withdrawal_rate_pct) / 100, cur, { compact: true, digits: 1 })} / yr` : undefined}
      />
      <div className="border border-line p-4 min-w-0">
        <p className="font-mono text-[10px] uppercase tracking-widest text-ink-muted mb-2">Pool</p>
        <p className="font-mono text-xl font-bold num leading-none text-ink truncate">{money(r.pool, cur, { compact: true, digits: 1 })}</p>
        <ShareBar share={s.progress} className="mt-3" />
        <p className="font-mono text-[10px] text-ink-muted mt-2">{percent(s.progress, 0)} there</p>
      </div>
      <StatCard label="If rebalanced" value={fiYear(s.rebalanced_year)} sub={yearsDelta(rebalDelta)} />
      <StatCard
        label="Structure"
        value={`${r.structure.overall} / 10`}
        sub={d.previous ? `vs ${inquiryDate(d.previous.created_at)} · ${d.previous.structure}` : undefined}
      />
    </section>
  )
}

function Projection({ r, k }: { r: InquiryResult; k: ScenarioKey }) {
  const theme = useChartTheme()
  const s = r.scenarios[k]
  const cur = r.currency
  const short = (v: number) => money(v, cur, { compact: true, digits: 1 })
  const tick = { ...axisTick, fill: theme.inkMuted }
  const blue = theme.series[0]
  return (
    <ChartCard
      title="Pool vs target · today’s money"
      aside={
        <Legend
          items={[
            { label: 'As is', color: blue, line: true },
            { label: 'Rebalanced', color: blue, line: true, dashed: true },
            { label: 'Target', color: theme.ink, line: true },
          ]}
        />
      }
    >
      <div className="h-72" role="img" aria-label={`Pool reaches ${short(s.fi_today)} in ${fiYear(s.fi_year)}`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={s.curve} margin={{ top: 16, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke={theme.line} />
            <XAxis dataKey="year" type="number" domain={['dataMin', 'dataMax']} tick={tick} tickLine={false} axisLine={{ stroke: theme.ink }} tickCount={8} />
            <YAxis tickFormatter={short} tick={tick} tickLine={false} axisLine={false} width={64} domain={[0, (max: number) => Math.max(max, s.fi_today) * 1.05]} />
            <Tooltip cursor={{ stroke: theme.inkFaint }} content={<ChartTooltip valueFormat={(v) => money(v, cur, { compact: true, digits: 2 })} />} />
            <ReferenceLine y={s.fi_today} stroke={theme.ink} strokeWidth={2} />
            {s.fi_year !== null && (
              <ReferenceLine
                x={s.fi_year}
                stroke={theme.inkFaint}
                strokeDasharray="3 3"
                label={{ value: `${s.fi_year}`, position: 'top', fill: theme.ink, fontFamily: axisTick.fontFamily, fontSize: 11, fontWeight: 700 }}
              />
            )}
            <Line type="monotone" dataKey="rebalanced" name="Rebalanced" stroke={blue} strokeWidth={2} strokeDasharray="6 4" dot={false} isAnimationActive={false} />
            <Line type="monotone" dataKey="as_is" name="As is" stroke={blue} strokeWidth={2.5} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  )
}

function RetireEarlier({ r, k }: { r: InquiryResult; k: ScenarioKey }) {
  const s = r.scenarios[k]
  const cur = r.currency
  const thisYear = Number(r.today.slice(0, 4))
  const [saving, setSaving] = useState('')
  const [byYear, setByYear] = useState('')
  const gap = Math.max(0, s.fi_today - r.pool)
  // Anchor on the scenario's own retire age (worked out from the birthday), so the table and the card agree.
  const ageIn = (year: number) =>
    s.fi_age !== null && s.fi_year !== null ? s.fi_age - (s.fi_year - year) : r.age !== null ? r.age + (year - thisYear) : null
  const whole = (v: number) => money(Math.round(v), cur).replace(/\.00$/, '')
  const when = (perMonth: number) => {
    const n = monthsToTarget(r.pool, s.fi_today, s.real_growth_pct, perMonth)
    return n === null ? null : yearAfter(r.today, n)
  }
  const base = when(0)
  const savingNum = toNumber(parseAmount(saving)) ?? 0
  const target = Number(byYear)
  const targetOk = byYear !== '' && Number.isInteger(target) && target >= thisYear && target <= thisYear + 60
  const needed = targetOk ? savingFor(r.pool, s.fi_today, s.real_growth_pct, monthsUntil(r.today, target)) : null
  const presets = [0.25, 0.5, 1].map((x) => Math.round((r.monthly_expenses * x) / 100) * 100)
  const yearText = (y: number | null) => {
    if (y === null) return '60+ yrs'
    const age = ageIn(y)
    return age !== null ? `${y} · age ${age}` : String(y)
  }
  if (gap <= 0) return null
  return (
    <Card title={`Retire earlier · ${SCENARIO_LABEL[k]}`}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="flex flex-col gap-1.5">
          <span className={sectionTitle}>Gap · today</span>
          <span className="font-mono text-xl font-bold num">{money(gap, cur, { compact: true, digits: 2 })}</span>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="re-save" className={sectionTitle}>
            Save / month
          </label>
          <AmountInput id="re-save" value={saving} onValueChange={setSaving} currency={cur} maxDecimals={0} className={cn(CONTROL, 'num')} placeholder="0" />
          <span className="font-mono text-xs num min-h-4" aria-live="polite">
            {savingNum > 0 ? `Retire ${yearText(when(savingNum))}` : ''}
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="re-year" className={sectionTitle}>
            Retire by
          </label>
          <input
            id="re-year"
            type="number"
            inputMode="numeric"
            min={thisYear}
            max={thisYear + 60}
            value={byYear}
            onChange={(e) => setByYear(e.target.value)}
            placeholder={base ? String(base) : ''}
            className={cn(CONTROL, 'num')}
          />
          <span className="font-mono text-xs num min-h-4" aria-live="polite">
            {needed === null ? '' : needed <= 0 ? 'On track already' : `Save ${whole(Math.ceil(needed / 10) * 10)} / mo`}
          </span>
        </div>
      </div>
      <Table>
        <thead>
          <tr>
            <th className={th}>Save / month</th>
            <th className={cn(th, 'text-right')}>Retire</th>
            <th className={cn(th, 'text-right')}>Sooner</th>
          </tr>
        </thead>
        <tbody>
          {[0, ...presets].map((p) => {
            const y = when(p)
            return (
              <tr key={p}>
                <td className={cn(td, 'num')}>{p === 0 ? '—' : whole(p)}</td>
                <td className={cn(td, 'text-right num')}>{yearText(y)}</td>
                <td className={cn(td, 'text-right num')}>{p === 0 || y === null || base === null ? '—' : yearsDelta(y - base)}</td>
              </tr>
            )
          })}
        </tbody>
      </Table>
    </Card>
  )
}

function AfterRetiring({ r, k }: { r: InquiryResult; k: ScenarioKey }) {
  const s = r.scenarios[k]
  if (s.fi_year === null || s.fi_nominal === null) return null
  const cur = r.currency
  const whole = (v: number) => money(Math.round(v), cur).replace(/\.00$/, '')
  const rows = afterRetiring(s.fi_today, s.fi_nominal, s.return_pct, r.expense_inflation_pct, r.withdrawal_rate_pct)
  const growth = incomeGrowthPct(s.return_pct, r.expense_inflation_pct, r.withdrawal_rate_pct)
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className={sectionTitle}>
          After retiring · {SCENARIO_LABEL[k]} · {pct(r.withdrawal_rate_pct, 2)} a year
        </h2>
        <span className="font-mono text-[11px] text-ink-muted num">
          {growth >= 0 ? '+' : '−'}
          {pct(Math.abs(growth), 2)} / yr in today’s money
        </span>
      </div>
      <Table>
        <thead>
          <tr>
            <th className={th}>Year</th>
            <th className={cn(th, 'text-right', showFrom.sm)}>Age</th>
            <th className={cn(th, 'text-right')}>Monthly · today’s money</th>
            <th className={cn(th, 'text-right')}>Monthly · that year</th>
            <th className={cn(th, 'text-right', showFrom.md)}>Pool · today’s money</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.after} className={row.after === 0 ? 'font-bold' : undefined}>
              <td className={cn(td, 'num')}>{s.fi_year! + row.after}</td>
              <td className={cn(td, 'text-right num', showFrom.sm)}>{s.fi_age !== null ? s.fi_age + row.after : '—'}</td>
              <td className={cn(td, 'text-right num')}>{whole(row.monthlyToday)}</td>
              <td className={cn(td, 'text-right num')}>{whole(row.monthlyThen)}</td>
              <td className={cn(td, 'text-right num', showFrom.md)}>{money(row.poolToday, cur, { compact: true, digits: 2 })}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  )
}

const SCORE_LABEL = { diversification: 'Diversification', liquidity: 'Liquidity', growth_mix: 'Growth mix', currency_spread: 'Currency spread' } as const

function Structure({ r }: { r: InquiryResult }) {
  return (
    <Card title="Structure">
      <div className="grid grid-cols-[8.5rem_minmax(0,1fr)_1.5rem] gap-x-3 gap-y-2.5 items-center font-mono text-xs">
        {(Object.keys(SCORE_LABEL) as (keyof typeof SCORE_LABEL)[]).map((k) => (
          <ScoreRow key={k} label={SCORE_LABEL[k]} value={r.structure[k]} />
        ))}
      </div>
      {r.keep.length > 0 && (
        <div className="flex flex-col">
          <span className={cn(sectionTitle, 'pt-2')}>Keep</span>
          {r.keep.map((k) => (
            <div key={k} className="flex gap-3 items-start py-2.5 border-b border-line last:border-b-0 font-mono text-xs leading-relaxed">
              <Chip solid>
                <Check className="w-3 h-3" aria-label="Keep" />
              </Chip>
              <span>{k}</span>
            </div>
          ))}
        </div>
      )}
    </Card>
  )
}

function ScoreRow({ label, value }: { label: string; value: number }) {
  return (
    <>
      <span>{label}</span>
      <ShareBar share={value / 10} className="h-2" />
      <span className="num text-right">{value}</span>
    </>
  )
}

function Changes({ r, k }: { r: InquiryResult; k: ScenarioKey }) {
  const years = r.scenarios[k].change_years
  return (
    <Card title="Change">
      <ul className="flex flex-col">
        {r.changes.map((c, i) => (
          <li key={c.title} className="flex gap-3 items-start py-2.5 border-b border-line last:border-b-0 font-mono text-xs leading-relaxed">
            <span className="flex-1 min-w-0">
              <b>{c.title}</b>
              {c.detail && <span className="block text-ink-muted">{c.detail}</span>}
            </span>
            <Chip>{c.effect.kind === 'none' ? (c.label ?? '—') : yearsDelta(years[i])}</Chip>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Rebalance({ r, k }: { r: InquiryResult; k: ScenarioKey }) {
  const theme = useChartTheme()
  const rows = r.scenarios[k].rebalance
  const top = Math.max(...rows.map((x) => Math.max(x.now_pct, x.target_pct)), 1)
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className={sectionTitle}>Rebalance · {SCENARIO_LABEL[k]}</h2>
        <Legend
          items={[
            { label: 'Now', color: theme.inkFaint },
            { label: 'Target', color: theme.ink },
          ]}
        />
      </div>
      <Table>
        <thead>
          <tr>
            <th className={th}>Class</th>
            <th className={cn(th, 'w-1/3', showFrom.sm)}>Now → target</th>
            <th className={cn(th, 'text-right')}>Now</th>
            <th className={cn(th, 'text-right')}>Target</th>
            <th className={cn(th, 'text-right')}>Move</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.key}>
              <td className={td}>{x.label}</td>
              <td className={cn(td, showFrom.sm)}>
                <div className="flex flex-col gap-1" aria-hidden="true">
                  <div className="h-1.5" style={{ width: `${(x.now_pct / top) * 100}%`, background: theme.inkFaint }} />
                  <div className="h-1.5 bg-ink" style={{ width: `${(x.target_pct / top) * 100}%` }} />
                </div>
              </td>
              <td className={cn(td, 'text-right num')}>{pct(x.now_pct)}</td>
              <td className={cn(td, 'text-right num font-bold')}>{pct(x.target_pct)}</td>
              <td className={cn(td, 'text-right num')}>
                {Math.abs(x.move) < 1 ? '—' : `${x.move > 0 ? '+' : '−'}${money(Math.abs(x.move), r.currency, { compact: true, digits: 1 })}`}
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  )
}

const SEVERITY = { high: { label: 'High', cls: 'text-error' }, medium: { label: 'Med', cls: 'text-ink' }, low: { label: 'Low', cls: 'text-ink-muted' } }

function Risks({ r, k }: { r: InquiryResult; k: ScenarioKey }) {
  const years = r.scenarios[k].risk_years
  return (
    <Card title="Risks">
      <ul className="flex flex-col">
        {r.risks.map((x, i) => (
          <li key={x.title} className="flex gap-3 items-start py-2.5 border-b border-line last:border-b-0 font-mono text-xs leading-relaxed">
            <span className={cn('w-10 shrink-0 text-[10px] uppercase tracking-widest font-bold pt-0.5', SEVERITY[x.severity].cls)}>{SEVERITY[x.severity].label}</span>
            <span className="flex-1 min-w-0">
              <b>{x.title}</b>
              {x.detail && <span className="block text-ink-muted">{x.detail}</span>}
            </span>
            <Chip>{x.stress.kind === 'none' ? x.label : `${x.label} · ${yearsDelta(years[i])}`}</Chip>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function Milestones({ r, k }: { r: InquiryResult; k: ScenarioKey }) {
  const miles = r.scenarios[k].milestones
  return (
    <Card title={`Milestones · ${SCENARIO_LABEL[k]}`}>
      <ol className="flex flex-col gap-3.5">
        {miles.map((m) => (
          <li key={m.year} className={cn('border-l-2 pl-3 py-1 flex flex-col gap-1 font-mono', m.fi ? 'border-ink' : 'border-line')}>
            <span className="flex justify-between gap-3 text-sm">
              <b className="num">{m.year}</b>
              <b className="num">{money(m.amount, r.currency, { compact: true, digits: 2 })}</b>
            </span>
            <span className="text-[11px] text-ink-muted">{m.focus}</span>
          </li>
        ))}
      </ol>
    </Card>
  )
}

function Assumptions({ r, k }: { r: InquiryResult; k: ScenarioKey }) {
  const on = (key: ScenarioKey) => (key === k ? 'bg-paper-warm font-bold' : '')
  const rows: { label: string; get: (key: ScenarioKey) => string }[] = [
    { label: 'Return · as is', get: (key) => pct(r.scenarios[key].return_pct) },
    { label: 'Return · rebalanced', get: (key) => pct(r.scenarios[key].return_rebalanced_pct) },
    { label: 'After inflation', get: (key) => pct(r.scenarios[key].real_growth_pct) },
  ]
  return (
    <Card title="Assumptions">
      <Table>
        <thead>
          <tr>
            <th className={th} />
            {SCENARIO_KEYS.map((key) => (
              <th key={key} className={cn(th, 'text-right', on(key))}>
                {SCENARIO_LABEL[key]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td className={td}>{row.label}</td>
              {SCENARIO_KEYS.map((key) => (
                <td key={key} className={cn(td, 'text-right num', on(key))}>
                  {row.get(key)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </Table>
      <dl className="grid grid-cols-2 lg:grid-cols-4 gap-3 font-mono text-xs">
        <div className="flex flex-col gap-1">
          <dt className="text-[10px] uppercase tracking-widest text-ink-muted">Withdrawal rate</dt>
          <dd className="font-bold num">{pct(r.withdrawal_rate_pct, 2)}</dd>
        </div>
        {r.inflation.map((x) => (
          <div key={x.currency} className="flex flex-col gap-1">
            <dt className="text-[10px] uppercase tracking-widest text-ink-muted" title={x.index}>
              {x.currency} inflation · {x.period}
            </dt>
            <dd className="font-bold num">{pct(x.rate_pct)}</dd>
          </div>
        ))}
        {r.fx.map((x) => (
          <div key={x.currency} className="flex flex-col gap-1">
            <dt className="text-[10px] uppercase tracking-widest text-ink-muted">
              {x.currency} vs {r.currency}
            </dt>
            <dd className="font-bold num">
              {fxLabel(x.currency, x.value_in_expense_currency, r.currency)} · {x.drift_pct > 0 ? '+' : '−'}
              {Math.abs(x.drift_pct)}% / yr
            </dd>
          </div>
        ))}
      </dl>
      {r.excluded.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-ink-muted">
          <span>Excluded</span>
          {r.excluded.map((x) => (
            <span key={x.name} className="border border-line px-1.5 py-0.5">
              {x.name} · {money(x.value, x.currency, { compact: true })}
            </span>
          ))}
        </div>
      )}
    </Card>
  )
}

export default function EstimatorInquiryPage() {
  const { inquiryId = '' } = useParams()
  const { data, isLoading, error } = useInquiry(inquiryId)
  const { remove } = useInquiryMutations()
  const navigate = useNavigate()
  const [scenario, setScenario] = useState<ScenarioKey>('balanced')
  const [deleting, setDeleting] = useState(false)

  if (isLoading) return <Page><Loading /></Page>
  if (error || !data) return <Page><ErrorBox message={apiErrorMessage(error, 'Inquiry not found')} /></Page>
  const r = data.result
  return (
    <Page>
      <PageHeader
        title={inquiryDate(data.created_at)}
        subtitle={`${money(data.monthly_expenses, data.currency)} / mo · ${pct(r.withdrawal_rate_pct, 2)} · pool ${money(r.pool, r.currency, { compact: true, digits: 1 })} · ${data.model}`}
        actions={
          <Button variant="danger" onClick={() => setDeleting(true)}>
            <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Delete
          </Button>
        }
      />
      <ScenarioPicker r={r} value={scenario} onChange={setScenario} />
      <Tiles d={data} k={scenario} />
      <Projection r={r} k={scenario} />
      <RetireEarlier r={r} k={scenario} />
      <AfterRetiring r={r} k={scenario} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Structure r={r} />
        <Changes r={r} k={scenario} />
      </div>
      <Rebalance r={r} k={scenario} />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Risks r={r} k={scenario} />
        <Milestones r={r} k={scenario} />
      </div>
      <Assumptions r={r} k={scenario} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete inquiry"
        body={inquiryDate(data.created_at)}
        isLoading={remove.isPending}
        error={remove.error ? apiErrorMessage(remove.error) : null}
        onConfirm={() => remove.mutate(data.id, { onSuccess: () => navigate('/estimator', { replace: true }) })}
      />
    </Page>
  )
}
