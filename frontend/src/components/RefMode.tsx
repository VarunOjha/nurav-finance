import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation } from 'react-router-dom'
import { Copy, Crosshair, Trash2, X } from 'lucide-react'
import { cn } from '../lib/cn'

// Ref tool: point at any part of the app and attach a note to it. Each element
// carries data-ref="Component · src/file.tsx:line" (stamped at build time by
// ../../ref-attributes.ts), so "Copy all" yields feedback that names the exact
// code. Notes are kept in this browser until cleared.

export interface RefNote {
  id: number
  ref: string
  element: string // tag plus a short text snippet, to recognise it later
  page: string
  note: string
}

const STORAGE_KEY = 'nurav-ref-notes'
const UI = '[data-ref-ui]'

function loadNotes(): RefNote[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as RefNote[]) : []
  } catch {
    return []
  }
}

/** Nearest stamped element, then each distinct ancestor ref (innermost first). */
export function refChain(start: Element | null, max = 6): Element[] {
  const chain: Element[] = []
  let el = start?.closest('[data-ref]') ?? null
  while (el && chain.length < max) {
    if (!chain.length || chain[chain.length - 1].getAttribute('data-ref') !== el.getAttribute('data-ref')) chain.push(el)
    el = el.parentElement?.closest('[data-ref]') ?? null
  }
  return chain
}

export function describe(el: Element): string {
  const label = el.getAttribute('aria-label')
  const text = (label ?? (el as HTMLElement).innerText ?? el.textContent ?? '').replace(/\s+/g, ' ').trim()
  const snippet = text.length > 70 ? `${text.slice(0, 70)}…` : text
  return `<${el.tagName.toLowerCase()}>${snippet ? ` "${snippet}"` : ''}`
}

export function formatNotes(notes: RefNote[]): string {
  const lines = [`Feedback on Nurav Finance — ${notes.length} note${notes.length === 1 ? '' : 's'}`, '']
  notes.forEach((n, i) => {
    lines.push(`${i + 1}. ${n.ref}`, `   element: ${n.element}`, `   page: ${n.page}`, `   → ${n.note}`, '')
  })
  return lines.join('\n').trimEnd()
}

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement('textarea')
    area.value = text
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    area.remove()
    return ok
  }
}

interface Draft {
  chain: Element[]
  level: number
  x: number
  y: number
}

const BLOCKED = ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick'] as const

export function RefMode() {
  const location = useLocation()
  const [on, setOn] = useState(false)
  const [notes, setNotes] = useState<RefNote[]>(loadNotes)
  const [hover, setHover] = useState<Element | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)
  const [, setTick] = useState(0) // re-measure the outline on scroll/resize
  const draftRef = useRef<Draft | null>(null)
  draftRef.current = draft

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(notes))
    } catch {
      /* private mode: notes last until reload */
    }
  }, [notes])

  const stop = useCallback(() => {
    setOn(false)
    setHover(null)
    setDraft(null)
  }, [])

  useEffect(() => {
    if (!on) return
    const inUi = (t: EventTarget | null) => t instanceof Element && !!t.closest(UI)
    const onMove = (e: MouseEvent) => {
      if (draftRef.current || inUi(e.target)) return
      setHover(refChain(e.target as Element)[0] ?? null)
    }
    // An open Radix dialog traps focus and closes on outside presses; keep our
    // own UI's presses and focus moves away from it.
    const shield = (e: Event) => {
      const related = (e as FocusEvent).relatedTarget ?? null
      if (inUi(e.target) || inUi(related)) e.stopPropagation()
    }
    const block = (e: Event) => {
      if (inUi(e.target)) {
        if (e.type === 'pointerdown' || e.type === 'mousedown') e.stopPropagation()
        return
      }
      e.preventDefault()
      e.stopPropagation()
      if (e.type !== 'click' || draftRef.current) return
      const chain = refChain(e.target as Element)
      if (!chain.length) return
      const me = e as MouseEvent
      setText('')
      setDraft({ chain, level: 0, x: me.clientX, y: me.clientY })
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      if (draftRef.current) setDraft(null)
      else stop()
    }
    const remeasure = () => setTick((n) => n + 1)
    document.addEventListener('mousemove', onMove, true)
    BLOCKED.forEach((type) => document.addEventListener(type, block, true))
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('focusin', shield, true)
    document.addEventListener('focusout', shield, true)
    window.addEventListener('scroll', remeasure, true)
    window.addEventListener('resize', remeasure)
    document.body.style.cursor = 'crosshair'
    return () => {
      document.removeEventListener('mousemove', onMove, true)
      BLOCKED.forEach((type) => document.removeEventListener(type, block, true))
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('focusin', shield, true)
      document.removeEventListener('focusout', shield, true)
      window.removeEventListener('scroll', remeasure, true)
      window.removeEventListener('resize', remeasure)
      document.body.style.cursor = ''
    }
  }, [on, stop])

  const target = draft ? draft.chain[draft.level] : hover
  const rect = target?.getBoundingClientRect()

  const save = () => {
    if (!draft || !text.trim()) return
    const el = draft.chain[draft.level]
    setNotes((ns) => [
      ...ns,
      { id: Date.now(), ref: el.getAttribute('data-ref') ?? '?', element: describe(el), page: location.pathname + location.search, note: text.trim() },
    ])
    setDraft(null)
    setHover(null)
  }

  const copyAll = async () => {
    if (await copyText(formatNotes(notes))) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  // Keep the note box on screen.
  const boxW = 360
  const boxX = draft ? Math.max(8, Math.min(draft.x + 12, window.innerWidth - boxW - 8)) : 0
  const boxY = draft ? Math.max(8, Math.min(draft.y + 12, window.innerHeight - 320)) : 0

  return (
    <>
      <button
        type="button"
        data-ref-ui
        onClick={() => (on ? stop() : setOn(true))}
        aria-pressed={on}
        title="Ref: click any part of the app to leave a note about it"
        className={cn(
          'relative flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest px-2 py-1.5 border focus:outline-none',
          on ? 'border-ink text-ink bg-paper-warm' : 'border-line text-ink-muted hover:text-ink hover:border-ink',
        )}
      >
        <Crosshair className="w-4 h-4" aria-hidden="true" />
        <span className="hidden sm:inline">Ref</span>
        {notes.length > 0 && <span className="num text-ink">{notes.length}</span>}
      </button>

      {on &&
        createPortal(
          <div data-ref-ui style={{ pointerEvents: 'auto' }}>
            {rect && target && (
              <div
                aria-hidden="true"
                className="fixed z-[60] pointer-events-none border-2 border-series-1 bg-series-1/10"
                style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
              >
                <span className="absolute left-0 -top-6 max-w-[80vw] truncate bg-series-1 text-white font-mono text-[10px] px-1.5 py-0.5 whitespace-nowrap">
                  {target.getAttribute('data-ref')}
                </span>
              </div>
            )}

            {draft && (
              <div
                role="dialog"
                aria-label="Note on this element"
                className="fixed z-[70] bg-paper border border-ink p-3 flex flex-col gap-2 shadow-[6px_6px_0_rgb(var(--ink)/0.12)]"
                style={{ left: boxX, top: boxY, width: boxW }}
              >
                <p className="font-mono text-[10px] uppercase tracking-widest text-ink-muted">Note on · pick the level</p>
                <div className="flex flex-col gap-1 max-h-28 overflow-y-auto">
                  {draft.chain.map((el, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setDraft({ ...draft, level: i })}
                      className={cn(
                        'text-left font-mono text-[10px] px-1.5 py-0.5 border truncate',
                        i === draft.level ? 'border-ink text-ink' : 'border-transparent text-ink-muted hover:text-ink',
                      )}
                      title={el.getAttribute('data-ref') ?? ''}
                    >
                      {i > 0 && '↑ '}
                      {el.getAttribute('data-ref')}
                    </button>
                  ))}
                </div>
                <p className="font-mono text-[10px] text-ink-faint truncate">{describe(draft.chain[draft.level])}</p>
                <textarea
                  autoFocus
                  rows={3}
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) save()
                  }}
                  placeholder="What should change here?"
                  className="w-full bg-transparent border border-line focus:border-ink focus:outline-none font-mono text-xs text-ink p-2 resize-y placeholder:text-ink-faint"
                />
                <div className="flex justify-end gap-4">
                  <button
                    type="button"
                    onClick={() => setDraft(null)}
                    className="font-mono text-[10px] uppercase tracking-widest text-ink-muted hover:text-ink"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={save}
                    disabled={!text.trim()}
                    className="font-mono text-[10px] uppercase tracking-widest text-ink border border-ink px-3 py-1.5 disabled:border-line disabled:text-ink-faint"
                  >
                    Add note · Ctrl+Enter
                  </button>
                </div>
              </div>
            )}

            <aside
              aria-label="Ref notes"
              className="fixed z-[65] right-4 bottom-4 w-[min(380px,calc(100vw-2rem))] max-h-[45vh] bg-paper border border-ink flex flex-col shadow-[6px_6px_0_rgb(var(--ink)/0.12)]"
            >
              <div className="flex items-center justify-between gap-3 px-3 py-2 border-b border-line">
                <p className="font-mono text-[10px] uppercase tracking-widest text-ink">
                  Ref notes · <span className="num">{notes.length}</span>
                </p>
                <button type="button" onClick={stop} aria-label="Exit Ref mode" className="text-ink-muted hover:text-ink p-1 -m-1">
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
              <div className="flex-1 overflow-y-auto px-3 py-2 flex flex-col gap-2">
                {notes.length === 0 ? (
                  <p className="font-mono text-[11px] text-ink-muted leading-relaxed">
                    Hover to see what each part is, click it to add a note. Esc exits. Clicks don't operate the app while Ref is on.
                  </p>
                ) : (
                  notes.map((n, i) => (
                    <div key={n.id} className="border-b border-line pb-2 last:border-b-0 flex gap-2">
                      <span className="font-mono text-[10px] text-ink-muted num pt-0.5">{i + 1}.</span>
                      <div className="min-w-0 flex-1">
                        <p className="font-mono text-[10px] text-ink-muted truncate" title={n.ref}>
                          {n.ref}
                        </p>
                        <p className="font-mono text-xs text-ink whitespace-pre-wrap break-words">{n.note}</p>
                      </div>
                      <button
                        type="button"
                        aria-label={`Delete note ${i + 1}`}
                        onClick={() => setNotes((ns) => ns.filter((x) => x.id !== n.id))}
                        className="text-ink-muted hover:text-error self-start p-1 -m-1"
                      >
                        <X className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                    </div>
                  ))
                )}
              </div>
              <div className="flex items-center justify-between gap-3 px-3 py-2 border-t border-line">
                <button
                  type="button"
                  onClick={() => setNotes([])}
                  disabled={!notes.length}
                  className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-ink-muted hover:text-error disabled:opacity-40"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden="true" /> Clear
                </button>
                <button
                  type="button"
                  onClick={copyAll}
                  disabled={!notes.length}
                  className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-widest text-ink border border-ink px-3 py-1.5 disabled:border-line disabled:text-ink-faint"
                >
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" /> {copied ? 'Copied' : 'Copy all'}
                </button>
              </div>
            </aside>
          </div>,
          document.body,
        )}
    </>
  )
}
