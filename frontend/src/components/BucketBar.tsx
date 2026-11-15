import { useChartTheme } from './charts/chartTheme'
import { cn } from '../lib/cn'
import { bucketColor, splitLabel, UNASSIGNED } from '../lib/buckets'

interface Part {
  name: string
  color: number | null // null = unassigned / remainder
  percent: number | string
}

/** Horizontal 100% bar of a bucket split, segments in bucket colours. */
export function BucketBar({ parts, className, height = 'h-2' }: { parts: Part[]; className?: string; height?: string }) {
  const theme = useChartTheme()
  const total = parts.reduce((s, p) => s + Number(p.percent), 0)
  return (
    <span
      role="img"
      aria-label={parts.length ? splitLabel(parts) : UNASSIGNED}
      className={cn('flex w-full overflow-hidden rounded-[2px] bg-paper-warm gap-px', height, className)}
    >
      {parts.map((p, i) => (
        <span
          key={`${p.name}-${i}`}
          className="block h-full"
          style={{ width: `${(Number(p.percent) / Math.max(total, 100)) * 100}%`, background: bucketColor(theme, p.color) }}
        />
      ))}
    </span>
  )
}

/** Compact split for tables: the bar plus "Growth 85 · Emergency fund 15", or an Unassigned badge. */
export function BucketSplitSummary({ parts, onClick, accountName }: { parts: Part[]; onClick?: () => void; accountName: string }) {
  const body =
    parts.length === 0 ? (
      <span className="font-mono text-[9px] uppercase tracking-widest border border-dashed border-ink-faint text-ink-muted px-1.5 py-0.5">{UNASSIGNED}</span>
    ) : (
      <span className="flex flex-col gap-1 w-full min-w-[7rem]">
        <BucketBar parts={parts} />
        <span className="text-[10px] text-ink-muted truncate">{splitLabel(parts)}</span>
      </span>
    )
  if (!onClick) return body
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation() // the row itself opens the account
        onClick()
      }}
      className="flex w-full text-left items-center focus:outline-none focus-visible:ring-1 focus-visible:ring-ink hover:opacity-80"
      aria-label={`Buckets of ${accountName}: ${parts.length ? splitLabel(parts) : UNASSIGNED}. Adjust`}
      title="Adjust buckets"
    >
      {body}
    </button>
  )
}
