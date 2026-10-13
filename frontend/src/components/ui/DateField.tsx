import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '../../lib/cn'
import { todayISO } from '../../lib/format'
import { Help, Label } from './Field'

// Date input that replaces the browser's <input type="date">: type the date
// (YYYY-MM-DD) or pick it from a calendar with month and year dropdowns, so
// jumping to 1987 is two clicks instead of four hundred. Values stay ISO
// strings, and onChange gets the same `{ target: { value } }` shape as an
// <input>, so it drops into existing forms.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
const WEEKDAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su']
const FALLBACK_MIN_YEAR = 1900
const FUTURE_YEARS = 10

interface Ymd {
  y: number
  m: number // 0-11
  d: number
}

const pad = (n: number) => String(n).padStart(2, '0')
const toISO = ({ y, m, d }: Ymd) => `${y}-${pad(m + 1)}-${pad(d)}`
const fromDate = (dt: Date): Ymd => ({ y: dt.getFullYear(), m: dt.getMonth(), d: dt.getDate() })
const shift = (v: Ymd, days = 0, months = 0): Ymd => {
  // Month jumps clamp the day (Jan 31 -> Feb 28), day jumps roll over.
  if (months) {
    const last = new Date(v.y, v.m + months + 1, 0).getDate()
    return fromDate(new Date(v.y, v.m + months, Math.min(v.d, last)))
  }
  return fromDate(new Date(v.y, v.m, v.d + days))
}

/** Lenient parse: 1990-5-7, 1990/05/07 -> "1990-05-07". Null if not a real date. */
export function parseDate(text: string): string | null {
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(text.trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])]
  const dt = new Date(y, mo, d)
  if (dt.getFullYear() !== y || dt.getMonth() !== mo || dt.getDate() !== d) return null
  return toISO({ y, m: mo, d })
}

const parseYmd = (iso: string): Ymd => {
  const [y, m, d] = iso.split('-').map(Number)
  return { y, m: m - 1, d }
}

interface DateFieldProps {
  id: string
  value: string
  onChange: (e: { target: { value: string } }) => void
  label?: ReactNode
  hint?: ReactNode
  error?: string | null
  className?: string
  min?: string
  max?: string
  required?: boolean
  disabled?: boolean
  /** Date whose month the calendar opens on while the field is empty. */
  initialView?: string
}

export function DateField({ id, value, onChange, label, hint, error, className, min, max, required, disabled, initialView }: DateFieldProps) {
  const [text, setText] = useState(value)
  const [formatError, setFormatError] = useState(false)
  const [open, setOpen] = useState(false)
  const today = todayISO()

  // Follow outside changes (form reset, calendar pick) without clobbering typing.
  useEffect(() => {
    if (value !== (parseDate(text) ?? (text.trim() ? null : ''))) {
      setText(value)
      setFormatError(false)
    }
  }, [value])

  const emit = (next: string) => onChange({ target: { value: next } })

  const onType = (next: string) => {
    setText(next)
    setFormatError(false)
    if (!next.trim()) emit('')
    else {
      const parsed = parseDate(next)
      if (parsed) emit(parsed)
    }
  }

  const onBlur = () => {
    if (!text.trim()) return
    const parsed = parseDate(text)
    if (parsed) setText(parsed)
    else setFormatError(true)
  }

  const pick = (iso: string) => {
    setText(iso)
    setFormatError(false)
    emit(iso)
    setOpen(false)
  }

  const rangeError = value && min && value < min ? `Must be on or after ${min}` : value && max && value > max ? `Must be on or before ${max}` : null
  const shownError = error || (formatError ? 'Use YYYY-MM-DD, e.g. 1990-05-17' : null) || rangeError

  return (
    <div className={className}>
      {label && <Label htmlFor={id}>{label}</Label>}
      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Anchor asChild>
          <div className="relative">
            <input
              id={id}
              value={text}
              onChange={(e) => onType(e.target.value)}
              onBlur={onBlur}
              placeholder="YYYY-MM-DD"
              inputMode="numeric"
              autoComplete="off"
              required={required}
              disabled={disabled}
              aria-invalid={!!shownError || undefined}
              className="w-full bg-transparent border-0 border-b border-line focus:border-ink focus:outline-none font-mono text-[13px] text-ink py-2 pr-9 placeholder:text-ink-faint disabled:text-ink-faint"
            />
            <Popover.Trigger asChild>
              <button
                type="button"
                disabled={disabled}
                aria-label="Choose date from calendar"
                className="absolute right-0 top-1/2 -translate-y-1/2 w-8 h-8 inline-flex items-center justify-center text-ink-muted hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink disabled:opacity-30"
              >
                <CalendarDays size={15} aria-hidden="true" />
              </button>
            </Popover.Trigger>
          </div>
        </Popover.Anchor>
        <Popover.Portal>
          <Popover.Content
            align="start"
            sideOffset={6}
            collisionPadding={12}
            onOpenAutoFocus={(e) => e.preventDefault()}
            className="z-[60] bg-paper border border-ink shadow-[4px_4px_0_rgb(var(--ink)/0.12)] p-3"
          >
            <Calendar
              selected={value || null}
              start={value || initialView || clamp(today, min, max)}
              today={today}
              min={min}
              max={max}
              required={required}
              onPick={pick}
              onClose={() => setOpen(false)}
            />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      <Help hint={hint} error={shownError} />
    </div>
  )
}

function clamp(iso: string, min?: string, max?: string): string {
  if (min && iso < min) return min
  if (max && iso > max) return max
  return iso
}

interface CalendarProps {
  selected: string | null
  start: string
  today: string
  min?: string
  max?: string
  required?: boolean
  onPick: (iso: string) => void
  onClose: () => void
}

export function Calendar({ selected, start, today, min, max, required, onPick, onClose }: CalendarProps) {
  const [focus, setFocus] = useState<Ymd>(() => parseYmd(start))
  const grid = useRef<HTMLDivElement>(null)
  const keyboard = useRef(false)

  const minYear = min ? Number(min.slice(0, 4)) : Math.min(FALLBACK_MIN_YEAR, focus.y)
  const maxYear = max ? Number(max.slice(0, 4)) : Math.max(new Date().getFullYear() + FUTURE_YEARS, focus.y)
  const years: number[] = []
  for (let y = maxYear; y >= minYear; y--) years.push(y)

  const inRange = (iso: string) => (!min || iso >= min) && (!max || iso <= max)
  const monthKey = (v: Ymd) => `${v.y}-${pad(v.m + 1)}`
  const canPrev = !min || monthKey(shift(focus, 0, -1)) >= min.slice(0, 7)
  const canNext = !max || monthKey(shift(focus, 0, 1)) <= max.slice(0, 7)

  const move = (next: Ymd) => setFocus(parseYmd(clamp(toISO(next), min, max)))

  // Keep keyboard focus on the focused day as it moves (only after a keypress,
  // so opening the calendar doesn't steal focus from a mouse user).
  useEffect(() => {
    if (!keyboard.current) return
    grid.current?.querySelector<HTMLButtonElement>(`[data-iso="${toISO(focus)}"]`)?.focus()
  }, [focus])

  // Focus the selected (or starting) day on open so arrows work immediately.
  useEffect(() => {
    grid.current?.querySelector<HTMLButtonElement>('[tabindex="0"]')?.focus()
  }, [])

  const onKeyDown = (e: KeyboardEvent) => {
    const steps: Record<string, () => Ymd> = {
      ArrowLeft: () => shift(focus, -1),
      ArrowRight: () => shift(focus, 1),
      ArrowUp: () => shift(focus, -7),
      ArrowDown: () => shift(focus, 7),
      PageUp: () => shift(focus, 0, e.shiftKey ? -12 : -1),
      PageDown: () => shift(focus, 0, e.shiftKey ? 12 : 1),
      Home: () => shift(focus, -((new Date(focus.y, focus.m, focus.d).getDay() + 6) % 7)),
      End: () => shift(focus, 6 - ((new Date(focus.y, focus.m, focus.d).getDay() + 6) % 7)),
    }
    const step = steps[e.key]
    if (step) {
      e.preventDefault()
      keyboard.current = true
      move(step())
    } else if (e.key === 'Escape') {
      onClose()
    }
  }

  // 6 weeks, Monday first, padded with the neighbouring months' days.
  const lead = (new Date(focus.y, focus.m, 1).getDay() + 6) % 7
  const cells = Array.from({ length: 42 }, (_, i) => fromDate(new Date(focus.y, focus.m, 1 - lead + i)))
  const navBtn =
    'w-8 h-8 inline-flex items-center justify-center border border-line text-ink hover:border-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink disabled:opacity-30 disabled:cursor-not-allowed'
  const selectCls = 'bg-paper border border-line hover:border-ink focus:border-ink focus:outline-none font-mono text-[12px] text-ink h-8 px-1.5 cursor-pointer'

  return (
    <div className="w-[17.5rem] flex flex-col gap-3" role="group" aria-label="Calendar">
      <div className="flex items-center gap-1.5">
        <button type="button" className={navBtn} onClick={() => move(shift(focus, 0, -1))} disabled={!canPrev} aria-label="Previous month">
          <ChevronLeft size={14} aria-hidden="true" />
        </button>
        <select aria-label="Month" className={cn(selectCls, 'flex-1 min-w-0')} value={focus.m} onChange={(e) => move({ ...focus, m: Number(e.target.value), d: Math.min(focus.d, 28) })}>
          {MONTHS.map((name, i) => (
            <option key={name} value={i}>
              {name}
            </option>
          ))}
        </select>
        <select aria-label="Year" className={selectCls} value={focus.y} onChange={(e) => move({ ...focus, y: Number(e.target.value), d: Math.min(focus.d, 28) })}>
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
        <button type="button" className={navBtn} onClick={() => move(shift(focus, 0, 1))} disabled={!canNext} aria-label="Next month">
          <ChevronRight size={14} aria-hidden="true" />
        </button>
      </div>

      <div ref={grid} role="grid" aria-label={`${MONTHS[focus.m]} ${focus.y}`} onKeyDown={onKeyDown} className="grid grid-cols-7 gap-px">
        {WEEKDAYS.map((d) => (
          <span key={d} role="columnheader" className="text-center font-mono text-[10px] uppercase tracking-widest text-ink-faint pb-1">
            {d}
          </span>
        ))}
        {cells.map((c) => {
          const iso = toISO(c)
          const outside = c.m !== focus.m
          const isSelected = iso === selected
          const isFocus = iso === toISO(focus)
          const enabled = inRange(iso)
          return (
            <button
              key={iso}
              type="button"
              role="gridcell"
              data-iso={iso}
              tabIndex={isFocus ? 0 : -1}
              disabled={!enabled}
              aria-selected={isSelected}
              aria-current={iso === today ? 'date' : undefined}
              aria-label={new Date(c.y, c.m, c.d).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              onClick={() => onPick(iso)}
              className={cn(
                'h-9 font-mono text-[12px] focus:outline-none focus-visible:ring-1 focus-visible:ring-ink focus-visible:ring-inset',
                outside ? 'text-ink-faint' : 'text-ink',
                isSelected ? 'bg-ink text-paper' : 'hover:bg-ink/10',
                iso === today && !isSelected && 'underline underline-offset-4 decoration-2',
                !enabled && 'opacity-25 cursor-not-allowed hover:bg-transparent',
              )}
            >
              {c.d}
            </button>
          )
        })}
      </div>

      <div className="flex items-center justify-between border-t border-line pt-2">
        <button
          type="button"
          onClick={() => onPick(today)}
          disabled={!inRange(today)}
          className="font-mono text-[10px] uppercase tracking-widest text-ink hover:underline disabled:opacity-30 disabled:no-underline"
        >
          Today
        </button>
        {!required && (
          <button type="button" onClick={() => onPick('')} className="font-mono text-[10px] uppercase tracking-widest text-ink-muted hover:text-ink hover:underline">
            Clear
          </button>
        )}
      </div>
    </div>
  )
}
