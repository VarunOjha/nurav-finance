import { useState } from 'react'
import { Link } from 'react-router-dom'
import type { AgentStatus, RiskAppetite, SolveFor, WealthPrefs } from '../../types/api'
import { cn } from '../../lib/cn'
import { formatDate } from '../../lib/format'
import { useAgentSnapshot, useWealthPlans } from '../../hooks/queries'
import { Modal } from '../ui/Modal'
import { Loading } from '../ui/Primitives'
import { Composer } from './Composer'

const SOLVES: { value: SolveFor | null; label: string }[] = [
  { value: null, label: 'Agent asks' },
  { value: 'time', label: 'When do I get there' },
  { value: 'amount', label: 'How much will I have' },
  { value: 'rate', label: 'What return I need' },
  { value: 'contribution', label: 'How much to add' },
]
const RISKS: { value: RiskAppetite; label: string }[] = [
  { value: 'cautious', label: 'Cautious' },
  { value: 'balanced', label: 'Balanced' },
  { value: 'growth', label: 'Growth' },
]
const STARTERS = [
  'I want $5M. At 8% a year, when do I get there?',
  'If I add $10K a year for 10 years, how much sooner do I reach $5M?',
  'What return do I need to reach ₹10Cr in 15 years?',
  'Of my $5M I want $4M in equities, $500K in savings and $500K in cash. Can I get there by 55?',
]

const cap = 'font-mono text-[10px] uppercase tracking-widest text-ink-muted'

function ChipButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={cn('font-mono text-xs border px-3 min-h-9 transition-colors', on ? 'bg-ink text-paper border-ink' : 'border-line text-ink hover:border-ink')}
    >
      {children}
    </button>
  )
}

export function StartScreen({
  status,
  prefs,
  onPrefs,
  text,
  onText,
  onStart,
}: {
  status: AgentStatus | undefined
  prefs: WealthPrefs
  onPrefs: (p: WealthPrefs) => void
  text: string
  onText: (t: string) => void
  onStart: (t: string) => void
}) {
  const plans = useWealthPlans()
  const [seeing, setSeeing] = useState(false)
  const [ageMode, setAgeMode] = useState(prefs.horizon_age !== null)
  const set = (patch: Partial<WealthPrefs>) => onPrefs({ ...prefs, ...patch })
  const spent = status?.spent_today_usd ?? 0
  const capUsd = status?.cap_usd ?? 0

  return (
    <div className="mx-auto max-w-7xl px-4 sm:px-8 py-8 sm:py-10 flex flex-wrap gap-10">
      <section className="flex-[999_1_36rem] min-w-0 flex flex-col gap-6">
        <div className="flex flex-col gap-2">
          <p className={cap}>Wealth Agent</p>
          <h1 className="font-sans text-3xl sm:text-[34px] font-semibold tracking-tight text-ink m-0">What should your money do for you?</h1>
          <p className="font-sans text-sm text-ink-muted max-w-2xl leading-relaxed m-0">
            Say what you have in mind: a target, a time, a return, money you’ll add. The agent pins down the one number to work out, Nurav’s engine does the maths for each currency you hold, and the agent shows you the possibilities.
          </p>
        </div>

        {status && !status.enabled && (
          <p role="alert" className="border border-error text-error font-mono text-xs px-4 py-3">
            The Wealth Agent needs an OpenRouter key. Add OPENROUTER_API_KEY to the nurav-finance vault app and restart.
          </p>
        )}

        <Composer
          size="lg"
          autoFocus
          value={text}
          onChange={onText}
          onSend={() => onStart(text.trim())}
          busy={false}
          sendLabel="Start planning"
          placeholder="For example: I want $5M. I can add $10K a year for the next 10 years and expect about 8%. When do I get there?"
          hint="Type or speak · you can fix what was heard before sending"
        />

        <div className="flex flex-col gap-3.5">
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Solve for">
            <span className={cn(cap, 'w-28 shrink-0')}>Solve for</span>
            {SOLVES.map((m) => (
              <ChipButton key={m.label} on={prefs.solve_for === m.value} onClick={() => set({ solve_for: m.value })}>
                {m.label}
              </ChipButton>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Horizon">
            <span className={cn(cap, 'w-28 shrink-0')}>Horizon</span>
            {[10, 20, 30].map((y) => (
              <ChipButton
                key={y}
                on={!ageMode && prefs.horizon_years === y}
                onClick={() => {
                  setAgeMode(false)
                  set({ horizon_years: prefs.horizon_years === y ? null : y, horizon_age: null })
                }}
              >
                {y} yrs
              </ChipButton>
            ))}
            <ChipButton
              on={ageMode}
              onClick={() => {
                setAgeMode(!ageMode)
                set({ horizon_years: null, horizon_age: ageMode ? null : (prefs.horizon_age ?? 60) })
              }}
            >
              To age…
            </ChipButton>
            {ageMode && (
              <>
                <label htmlFor="age" className="sr-only">
                  Target age
                </label>
                <input
                  id="age"
                  inputMode="numeric"
                  className="w-16 h-9 border border-ink bg-paper font-mono text-xs px-2"
                  value={prefs.horizon_age ?? ''}
                  onChange={(e) => {
                    const v = e.target.value.replace(/\D/g, '').slice(0, 3)
                    set({ horizon_age: v ? Number(v) : null })
                  }}
                />
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Risk appetite">
            <span className={cn(cap, 'w-28 shrink-0')}>Risk appetite</span>
            {RISKS.map((r) => (
              <ChipButton key={r.value} on={prefs.risk_appetite === r.value} onClick={() => set({ risk_appetite: prefs.risk_appetite === r.value ? null : r.value })}>
                {r.label}
              </ChipButton>
            ))}
            <span className="font-mono text-[10.5px] text-ink-muted">used to sanity-check your return assumptions, never to invent them</span>
          </div>
        </div>

        <div className="flex flex-col gap-2.5">
          <p className={cap}>Or start from</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3">
            {STARTERS.map((s) => (
              <button key={s} type="button" onClick={() => onStart(s)} disabled={status && !status.enabled} className="border border-line hover:border-ink text-left px-4 py-3.5 font-sans text-[13px] leading-snug text-ink disabled:opacity-50">
                “{s}”
              </button>
            ))}
          </div>
        </div>
      </section>

      <aside className="flex-[1_1_18rem] max-w-md flex flex-col gap-5">
        <div className="border border-line p-4 flex flex-col gap-2.5">
          <p className={cap}>What the agent sees</p>
          <p className="font-sans text-[13px] leading-relaxed text-ink m-0">
            Balances, types and currencies of your accounts and portfolios, and each portfolio’s asset mix. Names become aliases (<b>Account A</b>, <b>Portfolio B</b>) and are swapped back on your screen.
          </p>
          <p className="font-mono text-[10.5px] text-ink-muted m-0">Account numbers, institutions, tags, holdings symbols, email and phone never leave Nurav.</p>
          <button type="button" onClick={() => setSeeing(true)} className="self-start font-mono text-[11px] underline hover:text-ink-muted">
            Preview exactly what’s sent →
          </button>
        </div>

        <div className="border border-line p-4 flex flex-col gap-2.5">
          <p className={cap}>Saved plans</p>
          {plans.isLoading ? (
            <Loading />
          ) : plans.data?.length ? (
            <>
              {plans.data.slice(0, 5).map((p) => (
                <Link key={p.id} to={`/wealth/plans/${p.id}`} className="flex justify-between gap-3 font-sans text-[13px] text-ink hover:underline">
                  <span className="truncate">{p.name}</span>
                  <span className="text-ink-muted font-mono text-[11px] shrink-0">{p.pots.map((x) => x.currency).join(' · ')}</span>
                </Link>
              ))}
              <Link to="/wealth/plans" className="font-mono text-[11px] underline">
                All plans →
              </Link>
            </>
          ) : (
            <p className="font-sans text-[13px] text-ink-muted m-0">None yet. Approve and save a version to keep it.</p>
          )}
        </div>

        {status && (
          <div className="flex flex-col gap-1.5">
            <p className={cap}>Today’s usage</p>
            <div className="h-1 bg-paper-warm" aria-hidden="true">
              <div className="h-1 bg-ink" style={{ width: `${capUsd ? Math.min(100, (spent / capUsd) * 100) : 0}%` }} />
            </div>
            <p className="font-mono text-[10.5px] text-ink-muted m-0">
              ${spent.toFixed(2)} of ${capUsd.toFixed(2)} daily cap{status.fake && ' · scripted agent (AGENT_FAKE)'}
            </p>
          </div>
        )}
        <p className="font-mono text-[10px] text-ink-faint leading-relaxed m-0">Projections, not advice. No live market data: returns are the assumptions you give.</p>
      </aside>

      <SeeingModal open={seeing} onOpenChange={setSeeing} />
    </div>
  )
}

function SeeingModal({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const snap = useAgentSnapshot(open)
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="What the agent sees" subtitle="Sent with every message, exactly as shown" size="lg">
      <div className="px-5 sm:px-7 py-4 flex flex-col gap-3">
        {snap.isLoading || !snap.data ? (
          <Loading />
        ) : (
          <>
            <p className="font-mono text-[11px] text-ink-muted m-0">
              As of {formatDate(snap.data.as_of)}
              {snap.data.age !== null && ` · age ${snap.data.age}`} · {snap.data.items.length} items
            </p>
            <pre className="font-mono text-[11px] leading-relaxed bg-paper-warm/50 border border-line p-3 overflow-auto max-h-[60vh] whitespace-pre-wrap">{JSON.stringify(snap.data, null, 2)}</pre>
          </>
        )}
      </div>
    </Modal>
  )
}
