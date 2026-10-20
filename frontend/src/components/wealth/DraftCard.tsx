import { AlertTriangle, Check } from 'lucide-react'
import type { DraftPot, PotParams, WealthDraft } from '../../types/api'
import { cn } from '../../lib/cn'
import { money } from '../../lib/format'
import { swapAliases } from '../../lib/figures'
import { ageOn } from '../../lib/wealthView'
import { contributionText, pct, SOLVE_LABEL } from './potView'

const RISK: Record<string, string> = { cautious: 'Cautious', balanced: 'Balanced', growth: 'Growth' }
const COMPOUNDING: Record<number, string> = { 12: 'monthly', 4: 'quarterly', 1: 'annual' }
const SOLVED = <span className="text-ink font-bold">? solving for this</span>

function Fact({ label, children, isDefault }: { label: string; children: React.ReactNode; isDefault?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[9.5px] uppercase tracking-widest text-ink-muted">
        {label}
        {isDefault && <span className="ml-1.5 border border-line px-1 normal-case tracking-normal">default</span>}
      </dt>
      <dd className="font-mono text-[11.5px] text-ink mt-0.5">{children}</dd>
    </div>
  )
}

function PotFacts({ p, d, draft, label }: { p: PotParams; d: DraftPot; draft: WealthDraft; label: (s: string) => string }) {
  const cur = p.currency
  const m = (v: number) => money(v, cur, { compact: true })
  const y0 = Number(draft.as_of.slice(0, 4))
  const H = d.horizon_years
  const age = H !== null && draft.birth_date ? ageOn(draft.birth_date, draft.as_of) + H : null
  const isDefault = (k: string) => draft.params.defaults.includes(k)
  const s = p.solve_for
  return (
    <div className="border-b border-line">
      <p className="px-3.5 pt-3 font-mono text-[10.5px] uppercase tracking-widest text-ink font-bold">
        {cur} pot <span className="font-normal text-ink-muted normal-case tracking-normal">· {SOLVE_LABEL[s]}</span>
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5 px-3.5 py-3">
        <Fact label="Starts from">
          {m(d.start)}
          <div className="text-[10px] text-ink-muted">
            {p.start_override !== null ? `set by you · balances ${m(d.actual_start)}` : d.items.map((x) => x.name).join(', ') || 'nothing tracked'}
          </div>
          {d.excluded.length > 0 && <div className="text-[10px] text-ink-muted">left out: {d.excluded.map((x) => x.name).join(', ')}</div>}
        </Fact>
        <Fact label="Target" isDefault={isDefault('target_basis')}>
          {d.target === null ? (s === 'amount' ? 'none' : '—') : `${m(d.target)} ${p.target_basis === 'today' ? 'in today’s money' : 'in future money'}`}
          {p.segments.length > 0 && p.target === null && d.target !== null && <div className="text-[10px] text-ink-muted">the segments’ targets added up</div>}
        </Fact>
        <Fact label="Time">
          {s === 'time' ? SOLVED : H === null ? '—' : `${H} yrs · ${y0}–${y0 + H}${age !== null ? ` · age ${age}` : ''}`}
        </Fact>
        <Fact label="Return" isDefault={isDefault('rate_options')}>
          {s === 'rate' ? SOLVED : p.segments.length ? 'per segment' : p.rate === null ? '—' : `${pct(p.rate)} a year`}
          {d.rate_options && <div className="text-[10px] text-ink-muted">compared at {d.rate_options.map(pct).join(' · ')}</div>}
          {p.segments.length > 0 && <div className="text-[10px] text-ink-muted">compared 2 points down and up</div>}
        </Fact>
        <Fact label="Contribution">{s === 'contribution' ? SOLVED : p.segments.length ? 'per segment' : contributionText(p.contribution, cur)}</Fact>
        {p.one_offs.length > 0 && (
          <Fact label="One-offs">
            {p.one_offs.map((o, k) => (
              <div key={k}>
                {y0 + o.year}: {o.amount > 0 ? '+' : '−'}
                {m(Math.abs(o.amount))} {o.note && <span className="text-ink-muted">{label(o.note)}</span>}
              </div>
            ))}
          </Fact>
        )}
        {p.monthly_spending && <Fact label="Spending">{money(p.monthly_spending, cur)}/mo</Fact>}
      </dl>
      {p.segments.length > 0 && (
        <div className="overflow-x-auto pb-1">
          <table className="w-full border-collapse min-w-[24rem]">
            <thead>
              <tr>
                {['Segment', 'Starts', 'Return', 'Target', 'Adds'].map((h, i) => (
                  <th key={h} className={cn('font-mono text-[9.5px] uppercase tracking-widest text-ink-muted font-normal text-left px-3.5 py-1.5 border-y border-line', i > 0 && i < 4 && 'text-right')}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {p.segments.map((seg, i) => (
                <tr key={seg.name}>
                  <td className="font-mono text-[11.5px] px-3.5 py-1.5">{seg.name}</td>
                  <td className="font-mono text-[11.5px] px-3.5 py-1.5 text-right num">
                    {m(d.segments[i].start)}
                    {seg.share !== null && <span className="text-[10px] text-ink-muted"> · {seg.share}%</span>}
                  </td>
                  <td className="font-mono text-[11.5px] px-3.5 py-1.5 text-right">{s === 'rate' ? 'solved' : seg.rate === null ? '—' : pct(seg.rate)}</td>
                  <td className="font-mono text-[11.5px] px-3.5 py-1.5 text-right num">{seg.target === null ? '—' : m(seg.target)}</td>
                  <td className="font-mono text-[11px] px-3.5 py-1.5">{s === 'contribution' ? 'solved' : contributionText(seg.contribution, cur)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

/**
 * The approval table: exactly what the engine will run, drawn from the
 * server-validated draft (never from the agent's prose). Only "Approve & run"
 * runs it.
 */
export function DraftCard({
  draft,
  names,
  state,
  onApprove,
  onChange,
  busy,
}: {
  draft: WealthDraft
  names: Record<string, string>
  state: 'open' | 'replaced' | { version: number }
  onApprove: () => void
  onChange: () => void
  busy: boolean
}) {
  const p = draft.params
  const label = (s: string) => swapAliases(s, names)
  const isDefault = (k: string) => p.defaults.includes(k)
  const closed = state !== 'open'

  return (
    <section aria-label={`Draft ${draft.id} parameters`} className={cn('border bg-paper', closed ? 'border-line' : 'border-ink')}>
      <header className="flex items-center justify-between gap-3 px-3.5 py-2.5 border-b border-line">
        <span className="font-mono text-[10px] uppercase tracking-widest text-ink">{label(p.title)}</span>
        {state === 'replaced' && <span className="font-mono text-[10px] text-ink-muted">Replaced by a newer draft</span>}
        {typeof state === 'object' && (
          <span className="font-mono text-[10px] text-ink inline-flex items-center gap-1">
            <Check className="w-3 h-3" aria-hidden="true" /> Approved · ran as v{state.version}
          </span>
        )}
      </header>
      <div className={cn(state === 'replaced' && 'opacity-60')}>
        {p.pots.map((pot, i) => (
          <PotFacts key={pot.currency} p={pot} d={draft.pots[i]} draft={draft} label={label} />
        ))}
        <dl className="grid grid-cols-3 gap-x-4 px-3.5 py-2.5 border-b border-line">
          <Fact label="Inflation" isDefault={isDefault('inflation')}>
            {p.inflation ? `${p.inflation}%/yr` : 'off'}
          </Fact>
          <Fact label="Compounding" isDefault={isDefault('compounding')}>
            {COMPOUNDING[p.compounding]}
          </Fact>
          {p.risk_appetite && (
            <Fact label="Risk appetite" isDefault={isDefault('risk_appetite')}>
              {RISK[p.risk_appetite]}
            </Fact>
          )}
        </dl>
        {draft.warnings.length > 0 && (
          <ul className="px-3.5 py-2.5 flex flex-col gap-1.5 bg-paper-warm/50 border-b border-line">
            {draft.warnings.map((w, i) => (
              <li key={i} className="flex gap-2 font-sans text-[12px] leading-snug text-ink">
                <AlertTriangle className="w-3.5 h-3.5 text-error shrink-0 mt-0.5" aria-hidden="true" />
                {label(w)}
              </li>
            ))}
          </ul>
        )}
      </div>
      {state === 'open' && (
        <div className="flex flex-wrap gap-3 items-center px-3.5 py-3">
          <button type="button" onClick={onApprove} disabled={busy} className="h-10 px-4 bg-ink text-paper font-mono text-[11px] uppercase tracking-widest disabled:opacity-40">
            Approve &amp; run
          </button>
          <button type="button" onClick={onChange} disabled={busy} className="h-10 px-4 border border-ink text-ink font-mono text-[11px] uppercase tracking-widest disabled:opacity-40">
            Change something
          </button>
          <span className="font-mono text-[10px] text-ink-muted">Nothing is calculated until you approve.</span>
        </div>
      )}
    </section>
  )
}
