import { useMemo, useState } from 'react'
import { Check } from 'lucide-react'
import type { PotParams, PotResult, WealthVersion } from '../../types/api'
import { cn } from '../../lib/cn'
import { money, percent } from '../../lib/format'
import { ageAt, chartRows, toReal, yearAge, yearAt, type Timeline } from '../../lib/wealthView'
import { useChartTheme } from '../charts/chartTheme'
import { nameColors } from '../charts/palette'
import { Segmented, Table, td, th } from '../ui/Primitives'
import { ProjectionChart } from './ProjectionChart'
import { answerOf, contributionText, mainLine, pct, SOLVE_LABEL, whenText, yrs } from './potView'

const sectionTitle = 'font-mono text-[10px] font-medium uppercase tracking-widest text-ink-muted'
const COMPOUNDING: Record<number, string> = { 12: 'monthly', 4: 'quarterly', 1: 'annual' }

export interface PotCtx {
  r: PotResult
  p: PotParams
  t: Timeline
  inflation: number
  compounding: 12 | 4 | 1
  items: string[]
}

export function potCtx(v: WealthVersion, i: number): PotCtx {
  const d = v.draft
  return {
    r: v.pots[i],
    p: d.params.pots[i],
    t: { asOf: d.as_of, birth: d.birth_date },
    inflation: d.params.inflation,
    compounding: d.params.compounding,
    items: d.pots[i].items.map((x) => x.name),
  }
}

function useSegmentColors(keys: string[]) {
  const theme = useChartTheme()
  return useMemo(() => {
    const of = nameColors(theme, keys)
    return (key: string) => of(key) ?? theme.inkMuted
  }, [theme, keys.join('|')]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** The answer, the possibilities, the chart and the segments of one pot. */
export function PotMain({ ctx }: { ctx: PotCtx }) {
  const { r, p, t, inflation } = ctx
  const cur = r.currency
  const m = (v: number) => money(v, cur, { compact: true })
  const answer = answerOf(r, p, t, inflation)
  const effect = effectTile(ctx)
  return (
    <section aria-label={`${cur} pot`} className="flex flex-col gap-6">
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-b border-ink pb-2">
        <h3 className="font-mono text-sm font-bold uppercase tracking-widest text-ink m-0">
          {cur} pot <span className="font-normal text-ink-muted normal-case tracking-normal">· {SOLVE_LABEL[r.solve_for]}</span>
        </h3>
        <p className="font-mono text-[10.5px] text-ink-muted m-0">
          Starts at {m(r.start)}
          {ctx.items.length > 0 && ` · ${ctx.items.join(', ')}`}
        </p>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-4 break-inside-avoid">
        <div className="border border-ink shadow-[inset_0_0_0_1px_rgb(var(--ink))] p-4 flex flex-col gap-2 min-w-0">
          <p className="font-mono text-[10px] uppercase tracking-widest text-ink-muted">{answer.q}</p>
          <p className="font-mono text-2xl font-bold num leading-tight text-ink break-words">{answer.v}</p>
          <p className="font-mono text-[10.5px] text-ink-muted leading-relaxed">{answer.sub}</p>
        </div>
        {effect && (
          <div className="border border-line p-4 flex flex-col gap-2 min-w-0">
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink-muted">{effect.q}</p>
            <p className="font-mono text-lg font-bold num leading-tight text-ink">{effect.v}</p>
            <p className="font-mono text-[10.5px] text-ink-muted leading-relaxed">{effect.sub}</p>
          </div>
        )}
      </div>

      <Possibilities ctx={ctx} />
      <PotChart ctx={ctx} />
      {r.segments && <Segments ctx={ctx} />}
    </section>
  )
}

function effectTile({ r, p, t }: PotCtx): { q: string; v: string; sub: string } | null {
  const e = r.contribution_effect
  if (!e) return null
  const cur = r.currency
  const m = (v: number) => money(v, cur, { compact: true })
  const what = p.contribution?.amount ? contributionText(p.contribution, cur) : 'the one-offs'
  if (e.kind === 'time') {
    const sooner = e.with !== null && e.without !== null ? e.without - e.with : null
    return {
      q: `Without ${what}`,
      v: e.without === null ? 'Not within 60 years' : whenText(t, e.without),
      sub: sooner !== null ? `The contribution gets you there ${yrs(sooner)} sooner` : e.with !== null ? 'Only the contribution gets you there' : 'Neither way within 60 years',
    }
  }
  if (e.kind === 'amount') return { q: `Without ${what}`, v: m(e.without), sub: `The contribution adds ${m(e.with - e.without)} by ${yearAt(t, r.horizon_years)}` }
  const w = e.without
  return {
    q: `Without ${what}`,
    v: w.status === 'ok' ? `${pct(w.value as number)} a year` : w.status === 'already' ? 'Already on track' : 'Over 50% a year',
    sub: w.status === 'ok' && e.with.status === 'ok' ? `The contribution lowers the return you need by ${((w.value as number) - (e.with.value as number)).toFixed(1)} points` : 'Return needed with no regular contribution',
  }
}

/** The same plan at three returns: when each reaches the target, and what each has at points in time. */
function Possibilities({ ctx }: { ctx: PotCtx }) {
  const { r, p, t } = ctx
  if (!r.lines.length) return null
  const cur = r.currency
  const m = (v: number) => money(v, cur, { compact: true })
  const main = mainLine(r, p)
  const target = r.main.target
  const head = (i: number) => cn(th, 'text-right', i === main && 'text-ink')
  const cell = (i: number, extra?: string) => cn(td, 'text-right num', i === main && 'bg-paper-warm/60 font-bold', extra)
  const byLabel = r.segments ? 'Every segment’s return' : 'Return'
  // Target per plan year: from the main run (every line shares it).
  const targetAt = (y: number) => (target ? target[y] : null)
  const growing = !!target && target[0] !== target[target.length - 1]
  return (
    <section className="flex flex-col gap-3 break-inside-avoid">
      <h4 className={sectionTitle}>Possibilities · {byLabel.toLowerCase()} at three levels</h4>
      <Table>
        <thead>
          <tr>
            <th className={th}>{byLabel}</th>
            {r.lines.map((l, i) => (
              <th key={l.label} className={head(i)}>
                {l.label}
                {i === main && <span className="block normal-case tracking-normal text-[9px] text-ink-muted">your plan</span>}
              </th>
            ))}
            {growing && <th className={cn(th, 'text-right')}>Target then</th>}
          </tr>
        </thead>
        <tbody>
          {r.target !== null && (
            <tr>
              <td className={cn(td, 'text-ink-muted')}>Reach {m(r.target)}</td>
              {r.lines.map((l, i) => (
                <td key={l.label} className={cell(i)}>
                  {l.fi_months === null ? 'not within 60 yrs' : whenText(t, l.fi_months)}
                  {l.fi_months !== null && l.fi_months > 0 && <span className="block text-[10px] text-ink-muted font-normal">{yrs(l.fi_months)}</span>}
                </td>
              ))}
              {growing && <td className={td} />}
            </tr>
          )}
          {r.contribution_by_rate && (
            <tr>
              <td className={cn(td, 'text-ink-muted')}>Needed to add</td>
              {r.contribution_by_rate.map((x, i) => (
                <td key={x.label} className={cell(i)}>
                  {x.value === null ? 'out of reach' : x.status === 'already' ? 'nothing' : `${m(x.value)}/${r.answer.per === 'year' ? 'yr' : 'mo'}`}
                </td>
              ))}
              {growing && <td className={td} />}
            </tr>
          )}
          {r.grid_years.map((y) => (
            <tr key={y}>
              <td className={cn(td, 'text-ink-muted')}>
                In {yearAge(t, y)} <span className="text-ink-faint">· {y} yrs</span>
              </td>
              {r.lines.map((l, i) => {
                const hit = targetAt(y) !== null && l.total[y] >= (targetAt(y) as number)
                return (
                  <td key={l.label} className={cell(i, hit ? 'text-ink' : undefined)}>
                    <span className="inline-flex items-center gap-1 justify-end">
                      {hit && <Check className="w-3 h-3" aria-label="target reached" />}
                      {m(l.total[y])}
                    </span>
                  </td>
                )
              })}
              {growing && <td className={cn(td, 'text-right num text-ink-muted')}>{m(targetAt(y) as number)}</td>}
            </tr>
          ))}
        </tbody>
      </Table>
      {r.rate_by_horizon && (
        <dl className="grid grid-cols-1 sm:grid-cols-3 border-t border-l border-line">
          {r.rate_by_horizon.map((h) => (
            <div key={h.years} className={cn('border-r border-b border-line px-4 py-3', h.years === r.plan_years && 'bg-paper-warm/60')}>
              <dt className="font-mono text-[10px] uppercase tracking-widest text-ink-muted">Return needed in {h.years} years</dt>
              <dd className="font-mono text-base font-bold num text-ink">{h.status === 'ok' ? `${pct(h.value as number)} a year` : h.status === 'already' ? 'already on track' : 'over 50%'}</dd>
            </div>
          ))}
        </dl>
      )}
      <p className="font-mono text-[10px] text-ink-muted m-0">
        {target ? `✓ marks the amounts at or above the target in that year${growing ? ', which grows with inflation because it is in today’s money' : ''}. ` : ''}
        {r.solve_for === 'rate' ? 'The returns sit around the one you need. ' : ''}
        {r.solve_for === 'contribution' ? 'Amounts include the contribution found for your plan. ' : ''}
        Nominal amounts, end of each plan year.
      </p>
    </section>
  )
}

function PotChart({ ctx }: { ctx: PotCtx }) {
  const { r, t, inflation, p } = ctx
  const [basis, setBasis] = useState<'nominal' | 'real'>('nominal')
  const [split, setSplit] = useState<'segments' | 'total'>('segments')
  const keys = r.main.buckets.map((b) => b.key)
  const colorOf = useSegmentColors(keys)
  const real = basis === 'real' && inflation > 0
  const nominal = { buckets: r.main.buckets, total: r.main.total, target: r.main.target }
  const shown = real ? toReal(nominal, inflation) : nominal
  const bySegment = !!r.segments && split === 'segments'
  const deflate = (v: number, y: number) => (real ? v / (1 + inflation / 100) ** y : v)
  const others = r.lines.filter((_, i) => i !== mainLine(r, p))
  const [low, high] = others.length === 2 ? others : [r.lines[0], r.lines[r.lines.length - 1]]
  const rows = chartRows(bySegment ? shown : { ...shown, buckets: [{ key: 'total_area', values: shown.total }] }, t).map((row, y) =>
    low && high ? { ...row, scen_low: deflate(low.total[y], y), scen_high: deflate(high.total[y], y) } : row,
  )
  const series = bySegment
    ? [...r.main.buckets].sort((a, b) => b.values[r.horizon_years] - a.values[r.horizon_years]).map((b) => ({ key: b.key, label: b.key, color: colorOf(b.key) }))
    : [{ key: 'total_area', label: r.segments ? 'Total' : 'Your plan', color: colorOf(keys[0]) }]
  const fi = r.main.fi_months
  return (
    <section className="flex flex-col gap-3 break-inside-avoid">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className={sectionTitle}>
          {r.currency} over time · {real ? 'today’s money' : 'nominal'}
        </h4>
        <div className="flex flex-wrap gap-3 print:hidden">
          {r.segments && (
            <Segmented
              label="Breakdown"
              value={split}
              onChange={setSplit}
              options={[
                { value: 'segments', label: 'By segment' },
                { value: 'total', label: 'Total' },
              ]}
            />
          )}
          {inflation > 0 && (
            <Segmented
              label="Value basis"
              value={basis}
              onChange={setBasis}
              options={[
                { value: 'nominal', label: 'Nominal' },
                { value: 'real', label: 'Today’s money' },
              ]}
            />
          )}
        </div>
      </div>
      <ProjectionChart
        rows={rows}
        series={series}
        currency={r.currency}
        fiYear={fi === null ? null : fi / 12}
        band={low && high ? { low: `At ${low.label}`, high: `At ${high.label}` } : undefined}
      />
    </section>
  )
}

function Segments({ ctx }: { ctx: PotCtx }) {
  const { r, t, p } = ctx
  const cur = r.currency
  const m = (v: number) => money(v, cur, { compact: true })
  const ref = r.ref_years
  const spending = p.monthly_spending
  // The buffer is the low-return money: the growth segment isn't meant to be lived off.
  const growthSegment = r.segments!.length > 1 ? [...r.segments!].sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0))[0].name : null
  return (
    <section className="flex flex-col gap-3 break-inside-avoid">
      <h4 className={sectionTitle}>Segments · each against its own target{ref !== null ? ` in ${yearAt(t, ref)}` : ''}</h4>
      <Table>
        <thead>
          <tr>
            {['Segment', 'Starts', 'Return', ref !== null ? `By ${yearAt(t, ref)}` : 'By then', 'Target', 'On its own', 'To get there'].map((h, i) => (
              <th key={h} className={cn(th, i > 0 && i < 5 && 'text-right')}>
                {h}
              </th>
            ))}
            {spending && <th className={cn(th, 'text-right')}>Target covers</th>}
          </tr>
        </thead>
        <tbody>
          {r.segments!.map((s) => {
            const req = s.required
            return (
              <tr key={s.name}>
                <td className={cn(td, 'font-bold')}>{s.name}</td>
                <td className={cn(td, 'text-right num')}>{m(s.start)}</td>
                <td className={cn(td, 'text-right num')}>{s.rate === null ? '—' : pct(s.rate)}</td>
                <td className={cn(td, 'text-right num')}>{s.end === null ? '—' : m(s.end)}</td>
                <td className={cn(td, 'text-right num')}>
                  {s.target === null ? '—' : m(s.target)}
                  {s.target_end !== null && s.target !== null && Math.abs(s.target_end - s.target) > 1 && <span className="block text-[10px] text-ink-muted">{m(s.target_end)} then</span>}
                </td>
                <td className={td}>{s.target === null ? '—' : s.months === null ? 'not within 60 yrs' : whenText(t, s.months)}</td>
                <td className={td}>
                  {s.reaches ? (
                    <span className="inline-flex items-center gap-1">
                      <Check className="w-3 h-3" aria-hidden="true" /> reaches it
                    </span>
                  ) : req && req.value ? (
                    `${req.extra ? 'add ' : ''}${m(req.value)}/mo${req.extra ? ' more' : ''}`
                  ) : req && req.status === 'unreachable' ? (
                    'out of reach'
                  ) : (
                    '—'
                  )}
                </td>
                {spending && <td className={cn(td, 'text-right num')}>{s.runway_months === undefined || s.name === growthSegment ? '—' : yrs(s.runway_months)}</td>}
              </tr>
            )
          })}
        </tbody>
      </Table>
      <p className="font-mono text-[10px] text-ink-muted m-0">
        “On its own” is when a segment reaches its target at its return with nothing extra. “To get there” is the extra a month that gets it to its target by {ref !== null ? yearAt(t, ref) : 'then'}
        {spending ? `; “Target covers” is the target over ${money(spending, cur)} a month of spending` : ''}.
      </p>
    </section>
  )
}

/** Year by year and the assumptions, for the end of the report. */
export function PotDetails({ ctx }: { ctx: PotCtx }) {
  const { r, p, t, inflation, compounding } = ctx
  const cur = r.currency
  const [all, setAll] = useState(false)
  const [real, setReal] = useState(false)
  const H = r.horizon_years
  const fiY = r.main.fi_months === null ? null : Math.ceil(r.main.fi_months / 12)
  const k = (y: number) => (real ? (1 + inflation / 100) ** y : 1)
  const f = (v: number, y: number) => money(v / k(y), cur, { compact: false }).replace(/\.\d\d$/, '')
  const years = Array.from({ length: H + 1 }, (_, y) => y).filter((y) => all || y % 5 === 0 || y === H || y === fiY)
  const segs = r.segments ? r.main.buckets : []
  const target = r.main.target
  const solved = r.solve_for === 'rate' && r.flat_rate !== null ? r.flat_rate : null
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h4 className={sectionTitle}>
          {cur} year by year · {real ? 'today’s money' : 'nominal'}
        </h4>
        <div className="flex gap-4 print:hidden">
          {inflation > 0 && (
            <button type="button" onClick={() => setReal((v) => !v)} className="font-mono text-[10px] uppercase tracking-widest text-ink-muted hover:text-ink hover:underline">
              {real ? 'Nominal' : 'Today’s money'}
            </button>
          )}
          <button type="button" onClick={() => setAll((v) => !v)} className="font-mono text-[10px] uppercase tracking-widest text-ink-muted hover:text-ink hover:underline">
            {all ? 'Every 5 years' : `All ${H} years`}
          </button>
        </div>
      </div>
      <Table>
        <thead>
          <tr>
            <th className={th}>Year</th>
            {t.birth && <th className={th}>Age</th>}
            {segs.map((b) => (
              <th key={b.key} className={cn(th, 'text-right')}>
                {b.key}
              </th>
            ))}
            <th className={cn(th, 'text-right')}>Total</th>
            <th className={cn(th, 'text-right')}>Added</th>
            <th className={cn(th, 'text-right')}>Growth</th>
            {target && <th className={cn(th, 'text-right')}>Target</th>}
            {target && <th className={cn(th, 'text-right')}>% of it</th>}
          </tr>
        </thead>
        <tbody>
          {years.map((y) => {
            const add = r.main.buckets.reduce((s, b) => s + b.added[y], 0)
            const growth = y === 0 ? 0 : r.main.total[y] - r.main.total[y - 1] - add
            return (
              <tr key={y} className={cn(y === fiY && 'bg-paper-warm')}>
                <td className={td}>{yearAt(t, y)}</td>
                {t.birth && <td className={td}>{ageAt(t, y)}</td>}
                {segs.map((b) => (
                  <td key={b.key} className={cn(td, 'text-right num')}>
                    {f(b.values[y], y)}
                  </td>
                ))}
                <td className={cn(td, 'text-right num font-bold')}>{f(r.main.total[y], y)}</td>
                <td className={cn(td, 'text-right num')}>{y === 0 ? '—' : f(add, y)}</td>
                <td className={cn(td, 'text-right num')}>{y === 0 ? '—' : f(growth, y)}</td>
                {target && <td className={cn(td, 'text-right num')}>{f(target[y], y)}</td>}
                {target && <td className={cn(td, 'text-right num')}>{percent(r.main.total[y] / target[y], 0)}</td>}
              </tr>
            )
          })}
        </tbody>
      </Table>
      <p className="font-mono text-[10px] text-ink-muted m-0">
        Values at the end of each plan year{fiY !== null ? '; the highlighted row is the first at or above the target' : ''}.{' '}
        {r.solve_for === 'contribution' ? 'Includes the contribution found for your plan.' : ''}
      </p>
      <p className="font-mono text-[11px] text-ink-muted m-0">
        Assumptions: {solved !== null ? `${pct(solved)} a year (solved)` : p.rate !== null ? `${pct(p.rate)} a year` : 'each segment’s own return'} · contribution{' '}
        {r.solve_for === 'contribution' && !r.segments ? contributionText(p.contribution ?? { amount: 0, per: 'month', years: null, step_up: 0 }, cur, r.answer.value ?? 0) + ' (solved)' : contributionText(p.contribution, cur)}
        {p.one_offs.map((o) => ` · ${yearAt(t, o.year)}: ${o.amount > 0 ? '+' : '−'}${money(Math.abs(o.amount), cur, { compact: true })}${o.note ? ` ${o.note}` : ''}`).join('')}
        {r.segments && ` · segments: ${p.segments.map((s) => `${s.name} ${s.rate === null ? '' : pct(s.rate)}${s.contribution?.amount ? ` ${contributionText(s.contribution, cur)}` : ''}`).join(', ')}`} ·{' '}
        {inflation > 0 ? `${inflation}% inflation` : 'no inflation'} · target in {r.target_basis === 'today' ? 'today’s money' : 'future money'} · {COMPOUNDING[compounding]} compounding · rates are effective yearly returns
      </p>
    </section>
  )
}
