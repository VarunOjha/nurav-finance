// Words for a pot's answer and assumptions, shared by the approval card, the
// report, side by side and the saved-plans list. Every number comes from the
// server's draft or results; nothing is computed here but formatting.

import type { Contribution, PotParams, PotResult, SolveFor } from '../../types/api'
import { money } from '../../lib/format'
import { fiLabel, yearAt, type Timeline } from '../../lib/wealthView'

export const SOLVE_LABEL: Record<SolveFor, string> = {
  time: 'When do I get there',
  amount: 'How much will I have',
  rate: 'What return do I need',
  contribution: 'How much should I add',
}

export const pct = (v: number) => `${Number(v.toFixed(2))}%`
export const yrs = (months: number) => {
  const y = Math.round((months / 12) * 10) / 10
  return y === 1 ? '1 year' : `${y} years`
}

/** "+$10K/yr for 10 yrs, rising 3%/yr". */
export function contributionText(c: Contribution | null, currency: string, amount?: number): string {
  if (!c) return 'none'
  const a = amount ?? c.amount
  if (!a) return 'none'
  const sign = a > 0 ? '+' : '−'
  return `${sign}${money(Math.abs(a), currency, { compact: true })}/${c.per === 'month' ? 'mo' : 'yr'}${c.years ? ` for ${c.years} yrs` : ''}${c.step_up ? `, rising ${c.step_up}%/yr` : ''}`
}

export const whenText = (t: Timeline, months: number | null) => (months === null ? 'not within 60 years' : months === 0 ? 'already there' : fiLabel(t, months))

/** The pot's main answer as a question, a value and a line of context. */
export function answerOf(r: PotResult, p: PotParams, t: Timeline, inflation: number): { q: string; v: string; sub: string } {
  const cur = r.currency
  const m = (v: number) => money(v, cur, { compact: true })
  const a = r.answer
  const target = r.target === null ? null : `${m(r.target)}${r.target_basis === 'today' && inflation > 0 ? ' in today’s money' : ''}`
  switch (r.solve_for) {
    case 'time':
      return {
        q: `When you reach ${target}`,
        v: a.status === 'unreachable' ? 'Not within 60 years' : a.status === 'already' ? 'Already there' : fiLabel(t, a.months as number),
        sub: a.status === 'ok' ? `In ${yrs(a.months as number)} from ${m(r.start)}` : a.status === 'unreachable' ? 'Try a higher return or a contribution' : `You hold ${m(r.start)}`,
      }
    case 'amount': {
      const H = r.horizon_years
      const end = r.main.total[H]
      let sub = inflation > 0 ? `${m(r.main.total_real[H])} in today’s money` : `From ${m(r.start)}`
      if (r.main.target) {
        const gap = r.main.target[H] - end
        sub += gap > 0 ? ` · ${m(gap)} short of the target${r.fi_months !== null ? `, reached ${fiLabel(t, r.fi_months)} if you keep going` : ''}` : ` · ${m(-gap)} above the target`
      }
      return { q: `In ${yearAt(t, H)} you’d have`, v: m(end), sub }
    }
    case 'rate':
      return {
        q: `Return needed for ${target} by ${yearAt(t, r.plan_years as number)}`,
        v: a.status === 'ok' ? `${pct(a.value as number)} a year` : a.status === 'already' ? 'Already on track' : 'Over 50% a year',
        sub: a.status === 'ok' ? 'One return on everything, same contributions' : a.status === 'already' ? 'Even a loss every year gets there' : 'No return up to 50% a year gets there',
      }
    case 'contribution': {
      const shape = p.contribution
      const per = a.per === 'year' ? 'year' : 'month'
      return {
        q: `To reach ${target} by ${yearAt(t, r.plan_years as number)}, add`,
        v: a.status === 'ok' ? `${m(a.value as number)} / ${per}` : a.status === 'already' ? 'Nothing extra' : 'Out of reach',
        sub:
          a.status === 'ok'
            ? `${shape?.years ? `For ${shape.years} years` : 'Every ' + per + ' to the end'}${shape?.step_up ? `, rising ${shape.step_up}% a year` : ''}${r.segments ? ', across the segments' : ''}`
            : a.status === 'already' ? 'What you have gets there on its own' : 'More than any amount we searched',
      }
    }
  }
}

/** One line for the side-by-side and the saved-plans list. */
export function answerShort(r: PotResult, t: Timeline): string {
  const m = (v: number) => money(v, r.currency, { compact: true })
  const a = r.answer
  if (r.solve_for === 'time') return whenText(t, a.status === 'unreachable' ? null : (a.months ?? 0))
  if (r.solve_for === 'amount') return m(r.main.total[r.horizon_years])
  if (a.status !== 'ok') return a.status === 'already' ? 'already there' : 'out of reach'
  if (r.solve_for === 'rate') return `${pct(a.value as number)} a year`
  return `${m(a.value as number)}/${a.per === 'year' ? 'yr' : 'mo'}`
}

/** Which of the three lines is the plan as approved (it gets the emphasis). */
export function mainLine(r: PotResult, p: PotParams): number {
  return r.lines.findIndex((l) => l.shift === 0 || (l.rate !== null && p.rate !== null && Math.abs(l.rate - p.rate) < 1e-9))
}
