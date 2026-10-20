import { type ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import type { Narrative, RiskRead, WealthVersion } from '../../types/api'
import { ASSET_CLASS_LABELS, percent } from '../../lib/format'
import { show, swapAliases } from '../../lib/figures'
import { cn } from '../../lib/cn'
import { PotDetails, PotMain, potCtx } from './PotReport'

const sectionTitle = 'font-mono text-[10px] font-medium uppercase tracking-widest text-ink-muted'

function Card({ title, tone, children }: { title: string; tone?: 'warn'; children: ReactNode }) {
  return (
    <section className="border border-line p-4 flex flex-col gap-2.5 min-w-0 break-inside-avoid">
      <h3 className={cn(sectionTitle, tone === 'warn' && 'text-error')}>{title}</h3>
      {children}
    </section>
  )
}

function Points({ items, mark }: { items: string[]; mark: string }) {
  if (!items.length) return <p className="font-sans text-[13px] text-ink-muted m-0">Nothing to add.</p>
  return (
    <ul className="flex flex-col gap-2">
      {items.map((t, i) => (
        <li key={i} className="flex gap-2.5 font-sans text-[13px] leading-relaxed text-ink">
          <span aria-hidden="true" className={cn('w-1.5 h-1.5 mt-[0.55rem] shrink-0', mark)} />
          <span>{t}</span>
        </li>
      ))}
    </ul>
  )
}

/** Facts about the money in one currency today, straight from the server's risk read. */
function RiskFacts({ risk }: { risk: RiskRead }) {
  const rows: [string, string][] = []
  const h = risk.holdings
  if (h) {
    rows.push(['Largest holding', `${h.top.symbol} · ${percent(h.top.share, 0)} of what your portfolios hold`])
    if (h.count > 3) rows.push(['Top 3 holdings', `${percent(h.top3_share, 0)} of portfolio value`])
    rows.push(['Asset mix', h.asset_classes.map((c) => `${ASSET_CLASS_LABELS[c.asset_class] ?? c.asset_class} ${percent(c.share, 0)}`).join(' · ')])
  }
  if (risk.retirement_share !== null && risk.retirement_share > 0) rows.push(['In retirement accounts', `${percent(risk.retirement_share, 0)}, harder to reach early`])
  if (risk.cash_share !== null) rows.push(['In cash accounts', percent(risk.cash_share, 0)])
  if (risk.cash_months !== undefined) rows.push(['Cash covers', `${risk.cash_months.toFixed(1)} months of spending`])
  if (!rows.length) return null
  return (
    <div className="flex flex-col gap-1">
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink">{risk.currency}</p>
      <dl className="flex flex-col">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-1.5 border-b border-line last:border-b-0">
            <dt className="font-mono text-[10.5px] text-ink-muted">{k}</dt>
            <dd className="font-mono text-[11px] text-ink text-right">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/**
 * A version's report. Words are the agent's (figure tokens filled in, aliases
 * swapped for names); every number is the engine's. One section per pot.
 */
export function WealthReport({ version, names }: { version: WealthVersion; names: Record<string, string> }) {
  const n = version.narrative
  const f = version.figures
  const text = (s: string) => show(s, f, names)
  const nar: Narrative | null = n && {
    ...n,
    headline: text(n.headline),
    insights: n.insights.map(text),
    watch_outs: n.watch_outs.map(text),
    recommendations: n.recommendations.map(text),
    glossary: n.glossary.map((g) => ({ ...g, meaning: text(g.meaning) })),
  }
  const d = version.draft
  const ctxs = version.pots.map((_, i) => potCtx(version, i))

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-col gap-2 break-inside-avoid">
        <p className={sectionTitle}>
          {version.pots.map((p) => p.currency).join(' · ')} · balances as of {d.as_of}
        </p>
        <h2 className="font-sans text-2xl font-semibold text-ink m-0">{swapAliases(d.params.title, names)}</h2>
        {nar ? (
          <p className="font-sans text-[15px] leading-relaxed text-ink max-w-3xl m-0">{nar.headline}</p>
        ) : (
          <p className="font-mono text-[11px] text-ink-muted inline-flex items-center gap-2 m-0" role="status">
            <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> The agent is writing the commentary. The numbers below are final.
          </p>
        )}
      </header>

      {ctxs.map((c) => (
        <PotMain key={c.r.currency} ctx={c} />
      ))}

      <section className="flex flex-col gap-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card title="Insights">{nar ? <Points items={nar.insights} mark="bg-ink" /> : <Pending />}</Card>
          <Card title="Watch out for" tone="warn">
            {nar ? <Points items={nar.watch_outs} mark="bg-error" /> : <Pending />}
          </Card>
          <Card title="Risk read · your money today">
            <div className="flex flex-col gap-4">
              {version.pots.map((p) => (
                <RiskFacts key={p.currency} risk={version.risk[p.currency]} />
              ))}
            </div>
          </Card>
          <Card title="Recommendations">{nar ? <Points items={nar.recommendations} mark="bg-series-1" /> : <Pending />}</Card>
        </div>
        {nar && nar.glossary.length > 0 && (
          <dl className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-6 gap-y-2 border-t border-line pt-3 break-inside-avoid">
            {nar.glossary.map((g) => (
              <div key={g.term} className="font-sans text-[12px] leading-snug">
                <dt className="font-mono text-[10px] uppercase tracking-widest text-ink inline">{g.term}</dt>
                <dd className="inline text-ink-muted"> · {g.meaning}</dd>
              </div>
            ))}
          </dl>
        )}
        {d.warnings.length > 0 && (
          <ul className="flex flex-col gap-1 font-mono text-[10.5px] text-ink-muted">
            {d.warnings.map((w, i) => (
              <li key={i}>· {swapAliases(w, names)}</li>
            ))}
          </ul>
        )}
      </section>

      {ctxs.map((c) => (
        <PotDetails key={c.r.currency} ctx={c} />
      ))}

      <p className="font-mono text-[10px] text-ink-faint">Words by the Wealth Agent · every figure computed by Nurav’s engine · projections from your assumptions, not advice</p>
    </div>
  )
}

function Pending() {
  return <p className="font-mono text-[11px] text-ink-faint m-0">Writing…</p>
}
