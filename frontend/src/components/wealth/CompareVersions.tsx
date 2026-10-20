import type { PotResult, WealthVersion } from '../../types/api'
import { cn } from '../../lib/cn'
import { money } from '../../lib/format'
import { swapAliases } from '../../lib/figures'
import { Table, td, th } from '../ui/Primitives'
import { answerShort, contributionText, pct, SOLVE_LABEL, whenText } from './potView'

/** Versions of this chat side by side: per currency, the question and answer, then the assumptions that differ. */
export function CompareVersions({ versions, names }: { versions: WealthVersion[]; names: Record<string, string> }) {
  const currencies = [...new Set(versions.flatMap((v) => v.pots.map((p) => p.currency)))]
  const potOf = (v: WealthVersion, c: string) => {
    const i = v.pots.findIndex((p) => p.currency === c)
    return i < 0 ? null : { r: v.pots[i], p: v.draft.params.pots[i], t: { asOf: v.draft.as_of, birth: v.draft.birth_date } }
  }
  const rows: { k: string; v: (r: PotResult, x: NonNullable<ReturnType<typeof potOf>>) => string }[] = [
    { k: 'Question', v: (r) => SOLVE_LABEL[r.solve_for] },
    { k: 'Answer', v: (r, x) => answerShort(r, x.t) },
    { k: 'Starts from', v: (r) => money(r.start, r.currency, { compact: true }) },
    { k: 'Target', v: (r) => (r.target === null ? '—' : money(r.target, r.currency, { compact: true })) },
    { k: 'Time', v: (r) => (r.plan_years === null ? 'solved' : `${r.plan_years} years`) },
    { k: 'Return', v: (r, x) => (r.solve_for === 'rate' ? 'solved' : x.p.segments.length ? x.p.segments.map((s) => `${s.name} ${pct(s.rate ?? 0)}`).join(', ') : pct(x.p.rate ?? 0)) },
    { k: 'Contribution', v: (r, x) => (r.solve_for === 'contribution' ? 'solved' : contributionText(x.p.contribution, r.currency)) },
    {
      k: 'At the three returns',
      v: (r, x) =>
        r.lines
          .map((l) => `${l.label}: ${r.target !== null && (r.solve_for === 'time' || r.plan_years === null) ? whenText(x.t, l.fi_months) : money(l.end, r.currency, { compact: true })}`)
          .join(' · '),
    },
  ]
  return (
    <div className="flex flex-col gap-8">
      {currencies.map((c) => (
        <section key={c} className="flex flex-col gap-2">
          <h3 className="font-mono text-[10px] font-medium uppercase tracking-widest text-ink-muted m-0">{c} pot</h3>
          <Table>
            <thead>
              <tr>
                <th className={th} />
                {versions.map((x) => (
                  <th key={x.n} className={cn(th, 'text-right')}>
                    v{x.n} · {swapAliases(x.draft.params.title, names)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.k}>
                  <td className={cn(td, 'text-ink-muted')}>{row.k}</td>
                  {versions.map((v) => {
                    const x = potOf(v, c)
                    return (
                      <td key={v.n} className={cn(td, 'text-right num whitespace-normal', row.k === 'Answer' && 'font-bold')}>
                        {x ? row.v(x.r, x) : '—'}
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </Table>
        </section>
      ))}
    </div>
  )
}
