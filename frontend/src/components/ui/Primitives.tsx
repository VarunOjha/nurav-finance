import type { MouseEvent, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/cn'

/** Page heading row: tiny uppercase title, muted subtitle, actions on the right. */
export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: ReactNode }) {
  return (
    <div className="border-b border-line pb-4 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        {back}
        <h1 className="font-mono uppercase tracking-widest text-xs text-ink mt-1">{title}</h1>
        {subtitle && <p className="font-mono text-[11px] text-ink-muted mt-1">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-4">{actions}</div>}
    </div>
  )
}

export function Page({ children, narrow = false }: { children: ReactNode; narrow?: boolean }) {
  return <div className={cn('mx-auto px-4 sm:px-8 py-8 flex flex-col gap-6', narrow ? 'max-w-4xl' : 'max-w-7xl')}>{children}</div>
}

export function StatCard({ label, value, sub, className }: { label: ReactNode; value: ReactNode; sub?: ReactNode; className?: string }) {
  return (
    <div className={cn('border border-line p-4 min-w-0', className)}>
      <p className="font-mono text-[10px] uppercase tracking-widest text-ink-muted mb-2">{label}</p>
      <p className="font-mono text-xl font-bold num leading-none text-ink truncate">{value}</p>
      {sub && <p className="font-mono text-[10px] text-ink-muted mt-2">{sub}</p>}
    </div>
  )
}

export function Chip({ children, active = false, className }: { children: ReactNode; active?: boolean; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 font-mono text-[10px] lowercase tracking-wide border px-1.5 py-0.5 whitespace-nowrap',
        active ? 'border-ink text-ink' : 'border-line text-ink-muted',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** Bordered segmented control (status filters, ranges). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div role="group" aria-label={label} className="inline-flex border border-line">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'font-mono text-[10px] uppercase tracking-widest px-3 min-h-9 border-r border-line last:border-r-0 focus:outline-none',
            o.value === value ? 'bg-ink text-paper' : 'text-ink-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

/** Underlined tabs (border-b-2), as in Nurav Docs. */
export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: ReactNode }[]; onChange: (v: T) => void }) {
  return (
    // Baseline is an inset shadow, not a border: a -mb-px overlap would overflow by 1px and make
    // Windows draw scrollbar arrows on the strip.
    <div role="tablist" className="flex gap-6 shadow-[inset_0_-1px_0_rgb(var(--line))] overflow-x-auto">
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          type="button"
          aria-selected={o.value === value}
          onClick={() => onChange(o.value)}
          className={cn(
            'font-mono text-xs uppercase tracking-widest pb-2 border-b-2 whitespace-nowrap focus:outline-none',
            o.value === value ? 'border-ink text-ink' : 'border-transparent text-ink-muted hover:text-ink',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <p className="font-mono text-xs uppercase tracking-widest text-ink-muted flex items-center gap-2 py-8">
      <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" /> {label}…
    </p>
  )
}

export function Empty({ title, children }: { title: ReactNode; children?: ReactNode }) {
  return (
    <div className="border border-dashed border-line px-6 py-10 text-center">
      <p className="font-mono text-xs uppercase tracking-widest text-ink">{title}</p>
      {children && <div className="font-mono text-[11px] text-ink-muted mt-2 flex flex-col items-center gap-3">{children}</div>}
    </div>
  )
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <p role="alert" className="font-mono text-xs text-error border border-error/40 px-4 py-3">
      {message}
    </p>
  )
}

/** Table shell: bordered, and a size container so columns can drop out when it's narrow (see `showFrom`). */
export function Table({ children, className, stack }: { children: ReactNode; className?: string; stack?: StackAt }) {
  return (
    <div className={cn('border border-line overflow-x-auto [container:table/inline-size]', className)}>
      <table className={cn('w-full border-collapse', stack && STACK[stack].table)}>{children}</table>
    </div>
  )
}

/**
 * Editable grids can't drop columns — every field is needed — so below the
 * given table width each row becomes a small card of labelled fields instead.
 * Pass `stack` to Table, then `stacked(at).thead / tr / td` on the parts, and a
 * `data-label` on every td (it becomes the field's label in card form).
 */
export type StackAt = 'lg' | 'xl'
const STACK = {
  lg: {
    table: 'block t-lg:table',
    thead: 'hidden t-lg:table-header-group',
    tbody: 'block t-lg:table-row-group',
    tr: 'grid grid-cols-2 t-sm:grid-cols-4 gap-x-3 gap-y-2 p-3 border-b border-line last:border-b-0 t-lg:table-row t-lg:p-0',
    td: 'block border-b-0 p-0 t-lg:table-cell t-lg:border-b t-lg:px-2 t-lg:py-1.5 before:content-[attr(data-label)] before:block before:font-mono before:text-[10px] before:uppercase before:tracking-widest before:text-ink-muted before:mb-1 empty:before:hidden t-lg:before:content-none',
    wide: 'col-span-2',
  },
  xl: {
    table: 'block t-xl:table',
    thead: 'hidden t-xl:table-header-group',
    tbody: 'block t-xl:table-row-group',
    tr: 'grid grid-cols-2 t-sm:grid-cols-4 gap-x-3 gap-y-2 p-3 border-b border-line last:border-b-0 t-xl:table-row t-xl:p-0',
    td: 'block border-b-0 p-0 t-lg:p-0 t-xl:table-cell t-xl:border-b t-xl:px-2.5 t-xl:py-2.5 before:content-[attr(data-label)] before:block before:font-mono before:text-[10px] before:uppercase before:tracking-widest before:text-ink-muted before:mb-1 empty:before:hidden t-xl:before:content-none',
    wide: 'col-span-2',
  },
} as const
export const stacked = (at: StackAt) => STACK[at]

export const th =
  'text-left font-mono text-[10px] uppercase tracking-widest text-ink-muted font-medium px-2.5 t-lg:px-4 py-2.5 border-b border-line bg-paper-warm whitespace-nowrap'
export const td = 'font-mono text-xs text-ink px-2.5 t-lg:px-4 py-2.5 border-b border-line whitespace-nowrap align-middle'

/**
 * Columns that only appear once the table is wide enough, so no table needs
 * sideways scrolling. Put the same class on the column's th and every td.
 * Whatever a hidden column carried should show elsewhere in the row (see `onlyBelow`).
 */
export const showFrom = {
  sm: 'hidden t-sm:table-cell',
  md: 'hidden t-md:table-cell',
  lg: 'hidden t-lg:table-cell',
  xl: 'hidden t-xl:table-cell',
  '2xl': 'hidden t-2xl:table-cell',
} as const

/** The stand-in for a hidden column, inside another cell: shown only while that column is hidden. */
export const onlyBelow = {
  sm: 't-sm:hidden',
  md: 't-md:hidden',
  lg: 't-lg:hidden',
  xl: 't-xl:hidden',
  '2xl': 't-2xl:hidden',
} as const

/** Horizontal share bar (allocation, weights). */
export function ShareBar({ share, className }: { share: number; className?: string }) {
  return (
    <div className={cn('h-1.5 bg-paper-warm w-full', className)} aria-hidden="true">
      <div className="h-full bg-ink" style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%` }} />
    </div>
  )
}

/**
 * Makes a whole table row open `go` on click. Clicks on links, buttons and inputs
 * inside the row keep their own behaviour, and selecting text doesn't navigate.
 * The row's name stays a real link, so keyboard and ctrl/middle-click still work.
 */
export function rowLink(go: () => void) {
  return {
    onClick: (e: MouseEvent<HTMLTableRowElement>) => {
      if ((e.target as HTMLElement).closest('a, button, input, select, textarea, label')) return
      if (window.getSelection()?.toString()) return
      go()
    },
    className: 'cursor-pointer hover:bg-paper-warm/60',
  }
}
