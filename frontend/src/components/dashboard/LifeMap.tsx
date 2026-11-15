// Every bucket as a lane on a long time line; each milestone is a station (a
// vertical line at its date and a dot on every bucket it targets).
import { Swatch } from '../charts/kit'
import { useChartTheme } from '../charts/chartTheme'
import { bucketColor } from '../../lib/buckets'
import { formatDate, money, parseDate, percent, toNumber } from '../../lib/format'
import type { BucketView, MilestoneView } from '../../types/api'

/** Today's year to at least 34 years out (a working lifetime), and past the last milestone. */
export function lifeSpan(today: string, milestones: { target_date: string }[]): { start: number; end: number; years: number[] } {
  const startYear = parseDate(today).getFullYear()
  const last = Math.max(startYear, ...milestones.map((m) => parseDate(m.target_date).getFullYear()))
  const endYear = Math.ceil(Math.max(startYear + 34, last + 10) / 5) * 5
  const years: number[] = [startYear]
  for (let y = Math.ceil((startYear + 1) / 5) * 5; y <= endYear; y += 5) years.push(y)
  return { start: new Date(startYear, 0, 1).getTime(), end: new Date(endYear, 11, 31).getTime(), years }
}

export function LifeMap({ today, buckets, milestones }: { today: string; buckets: BucketView[]; milestones: MilestoneView[] }) {
  const theme = useChartTheme()
  const { start, end, years } = lifeSpan(today, milestones)
  const at = (iso: string | number) => {
    const t = typeof iso === 'number' ? iso : parseDate(iso).getTime()
    return Math.max(0, Math.min(100, ((t - start) / (end - start)) * 100))
  }
  const now = at(today)
  const stations = milestones.filter((m) => !m.past)
  const multiCurrency = new Set(buckets.map((b) => b.currency)).size > 1

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-[7rem_minmax(0,1fr)] sm:grid-cols-[11rem_minmax(0,1fr)] items-end h-7">
        <span />
        <div className="relative h-full">
          {years.map((y) => (
            <span key={y} className="absolute bottom-1 font-mono text-[10px] text-ink-muted -translate-x-1/2 first:translate-x-0" style={{ left: `${at(new Date(y, 0, 1).getTime())}%` }}>
              {y}
            </span>
          ))}
          {stations.map((m) => (
            <span key={m.id} className="absolute top-0 font-mono text-[10px] font-bold text-ink -translate-x-1/2 whitespace-nowrap" style={{ left: `${at(m.target_date)}%` }}>
              {m.name}
            </span>
          ))}
        </div>
      </div>
      <ul className="flex flex-col">
        {buckets.map((b) => {
          const color = bucketColor(theme, b.bucket.color)
          const current = toNumber(b.current) ?? 0
          const next = b.marks.find((m) => m.status === 'open' && parseDate(m.target_date).getTime() >= parseDate(today).getTime())
          const nextAmount = next ? toNumber(next.amount) ?? 0 : 0
          const progress = next && nextAmount > 0 ? Math.min(current / nextAmount, 1) : 1
          const nextPos = next ? at(next.target_date) : now
          const last = b.marks.length ? at(b.marks[b.marks.length - 1].target_date) : now
          return (
            <li key={`${b.bucket.id}-${b.currency}`} className="grid grid-cols-[7rem_minmax(0,1fr)] sm:grid-cols-[11rem_minmax(0,1fr)] items-center border-b border-line h-12">
              <span className="flex items-center gap-2 min-w-0 font-mono text-xs text-ink pr-2">
                <Swatch color={color} />
                <span className="truncate">{b.bucket.name}</span>
                {multiCurrency && <span className="text-[10px] text-ink-muted">{b.currency}</span>}
              </span>
              <div className="relative h-full" role="img" aria-label={`${b.bucket.name} ${b.currency}: ${money(b.current, b.currency, { compact: true })} now${next ? `, ${money(next.amount, b.currency, { compact: true })} by ${formatDate(next.target_date)}` : ''}`}>
                {stations.map((m) => (
                  <span key={m.id} className="absolute inset-y-0 w-px bg-line" style={{ left: `${at(m.target_date)}%` }} aria-hidden="true" />
                ))}
                {next && <span className="absolute top-[22px] h-1.5 bg-paper-warm" style={{ left: `${now}%`, width: `${nextPos - now}%` }} aria-hidden="true" />}
                <span className="absolute top-[22px] h-1.5" style={{ left: `${now}%`, width: `${(nextPos - now) * progress}%`, background: color }} aria-hidden="true" />
                <span className="absolute top-[24px] border-t-2 border-dashed border-line" style={{ left: `${Math.max(last, nextPos)}%`, right: 0 }} aria-hidden="true" />
                {b.marks.map((m) => {
                  const pos = at(m.target_date)
                  const isNext = next?.row_id === m.row_id
                  const done = m.status === 'achieved'
                  return (
                    <span key={m.row_id} title={`${m.name} · ${money(m.amount, b.currency)}`}>
                      <span
                        className="absolute top-[17px] w-4 h-4 -ml-2 rounded-full border-[3px] border-paper"
                        style={{ left: `${pos}%`, background: done || isNext ? color : theme.inkFaint }}
                        aria-hidden="true"
                      />
                      <span className="absolute top-0.5 ml-3 font-mono text-[10px] num text-ink whitespace-nowrap" style={{ left: `${pos}%` }}>
                        {money(m.amount, b.currency, { compact: true })}
                        {isNext && ` · ${percent(current / nextAmount, 0)}`}
                        {done && ' ✓'}
                      </span>
                    </span>
                  )
                })}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
