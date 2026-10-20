import { useCallback, useEffect, useRef, type ReactNode } from 'react'
import { ArrowRight, Loader2, Mic, Square, X } from 'lucide-react'
import { cn } from '../../lib/cn'
import { MAX_SECONDS, recordingSupported, useRecorder } from '../../lib/useRecorder'

const clock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

/**
 * The message box: type, or tap the mic, talk, tap again. What was heard lands
 * in the box to check before sending. Enter sends, Shift+Enter is a new line.
 */
export function Composer({
  value,
  onChange,
  onSend,
  busy,
  placeholder,
  size = 'md',
  autoFocus,
  hint,
  sendLabel,
}: {
  value: string
  onChange: (v: string) => void
  onSend: () => void
  busy: boolean
  placeholder: string
  size?: 'md' | 'lg'
  autoFocus?: boolean
  hint?: ReactNode
  sendLabel?: string
}) {
  const box = useRef<HTMLTextAreaElement | null>(null)
  const latest = useRef(value)
  latest.current = value
  const onHeard = useCallback(
    (text: string) => {
      const cur = latest.current
      onChange(cur ? `${cur.replace(/\s+$/, '')} ${text}` : text)
      requestAnimationFrame(() => box.current?.focus())
    },
    [onChange],
  )
  const mic = useRecorder(onHeard)
  const canSend = value.trim().length > 0 && !busy && mic.state === 'idle'

  useEffect(() => {
    const el = box.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, size === 'lg' ? 260 : 180)}px`
  }, [value, size])

  const lg = size === 'lg'
  return (
    <div className={cn('border bg-paper flex flex-col', lg ? 'border-ink' : 'border-line focus-within:border-ink')}>
      {mic.state === 'recording' ? (
        <div className={cn('flex items-center gap-3 px-4', lg ? 'min-h-[7.5rem]' : 'min-h-[3.25rem]')} role="status" aria-live="polite">
          <span aria-hidden="true" className="w-2 h-2 rounded-full bg-error animate-pulse shrink-0" />
          <span aria-hidden="true" data-level={mic.level.toFixed(2)} className="flex items-center gap-[3px] h-6">
            {Array.from({ length: 18 }, (_, i) => (
              <span key={i} className="w-[3px] bg-ink rounded-sm" style={{ height: `${Math.max(12, Math.min(100, mic.level * 100 * (0.5 + Math.abs(Math.sin(i * 1.7 + mic.seconds)))))}%` }} />
            ))}
          </span>
          <span className="font-mono text-[11px] text-ink-muted ml-auto num">
            Listening · {clock(mic.seconds)} / {clock(MAX_SECONDS)}
          </span>
        </div>
      ) : (
        <>
          <label htmlFor={lg ? 'goal' : 'say'} className="sr-only">
            {lg ? 'Your goal' : 'Message the agent'}
          </label>
          <textarea
            id={lg ? 'goal' : 'say'}
            ref={box}
            rows={lg ? 4 : 2}
            autoFocus={autoFocus}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault()
                if (canSend) onSend()
              }
            }}
            className={cn('w-full resize-none bg-transparent outline-none text-ink placeholder:text-ink-faint font-sans leading-relaxed', lg ? 'px-5 py-4 text-[15px]' : 'px-3 py-2.5 text-[13.5px]')}
          />
        </>
      )}
      <div className={cn('flex items-center gap-2 border-t border-line', lg ? 'px-3 py-2.5' : 'px-2 py-1.5')}>
        <div className="min-w-0 flex-1 font-mono text-[10.5px] text-ink-muted truncate">
          {mic.state === 'transcribing' ? (
            <span className="inline-flex items-center gap-1.5" role="status">
              <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
              Transcribing…
            </span>
          ) : mic.error ? (
            <span className="text-error inline-flex items-center gap-1" role="alert">
              {mic.error}
              <button type="button" aria-label="Dismiss" onClick={mic.clearError} className="p-1 -m-1 hover:text-ink">
                <X className="w-3 h-3" aria-hidden="true" />
              </button>
            </span>
          ) : (
            hint
          )}
        </div>
        {recordingSupported() &&
          (mic.state === 'recording' ? (
            <>
              <button type="button" onClick={mic.cancel} className="font-mono text-[10px] uppercase tracking-widest text-ink-muted hover:text-ink px-2 h-10">
                Cancel
              </button>
              <button type="button" aria-label="Stop recording" onClick={mic.stop} className="w-10 h-10 bg-error flex items-center justify-center shrink-0">
                <Square className="w-3.5 h-3.5 text-white fill-white" aria-hidden="true" />
              </button>
            </>
          ) : (
            <button
              type="button"
              aria-label="Speak"
              title="Speak (up to 2 minutes)"
              disabled={busy || mic.state !== 'idle'}
              onClick={mic.start}
              className="w-10 h-10 border border-line flex items-center justify-center shrink-0 hover:border-ink disabled:opacity-40"
            >
              <Mic className="w-4 h-4 text-ink" aria-hidden="true" />
            </button>
          ))}
        <button
          type="button"
          aria-label={sendLabel ?? 'Send'}
          disabled={!canSend}
          onClick={onSend}
          className={cn(
            'h-10 bg-ink text-paper flex items-center justify-center gap-2 shrink-0 disabled:opacity-40',
            lg ? 'px-4 font-mono text-[11px] uppercase tracking-widest' : 'w-10',
          )}
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" /> : lg ? <>{sendLabel}</> : null}
          {!busy && <ArrowRight className="w-4 h-4" aria-hidden="true" />}
        </button>
      </div>
    </div>
  )
}
