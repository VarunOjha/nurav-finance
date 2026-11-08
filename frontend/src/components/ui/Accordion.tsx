import { useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { cn } from '../../lib/cn'

const STORE = 'nurav-finance:accordion:'

function remembered(id: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(STORE + id)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

/**
 * One collapsible section (a native <details>, so it's keyboard and screen-reader
 * friendly for free). Open/closed is remembered per `id` in this browser.
 */
export function AccordionSection({
  id,
  title,
  summary,
  defaultOpen = false,
  children,
}: {
  id: string
  title: ReactNode
  summary?: ReactNode
  defaultOpen?: boolean
  children: ReactNode
}) {
  const [open, setOpen] = useState(() => remembered(id, defaultOpen))
  return (
    <details
      open={open}
      onToggle={(e) => {
        const next = (e.currentTarget as HTMLDetailsElement).open
        setOpen(next)
        try {
          localStorage.setItem(STORE + id, next ? '1' : '0')
        } catch {
          /* private mode — just don't remember */
        }
      }}
      className="group border border-line"
    >
      <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer select-none flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 px-4 py-3 hover:bg-paper-warm/60 focus:outline-none focus-visible:bg-paper-warm">
        <span className="flex items-center gap-2.5">
          <ChevronDown className={cn('w-3.5 h-3.5 text-ink-muted shrink-0 transition-transform', !open && '-rotate-90')} aria-hidden="true" />
          <span className="font-mono text-xs uppercase tracking-widest text-ink">{title}</span>
        </span>
        {summary && <span className="font-mono text-[11px] text-ink-muted num pl-6">{summary}</span>}
      </summary>
      {open && <div className="border-t border-line p-4 flex flex-col gap-6">{children}</div>}
    </details>
  )
}
