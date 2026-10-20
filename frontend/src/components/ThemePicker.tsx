import { Check } from 'lucide-react'
import { cn } from '../lib/cn'
import { THEMES, useTheme, type ThemeChoice, type ThemeInfo } from '../lib/theme'

function Swatch({ theme }: { theme: ThemeInfo }) {
  const [paper, warm, ink, line] = theme.swatch
  return (
    <span aria-hidden="true" className="w-7 h-5 shrink-0 border flex overflow-hidden" style={{ background: paper, borderColor: line }}>
      <span className="w-1/2 h-full" style={{ background: warm }} />
      <span className="w-1.5 h-full ml-auto" style={{ background: ink }} />
    </span>
  )
}

// Radio list of themes; choosing one applies it immediately and is remembered in this browser.
export function ThemePicker({ className }: { className?: string }) {
  const { choice, theme, setTheme } = useTheme()
  const options: { id: ThemeChoice; label: string; blurb: string; swatch: ThemeInfo }[] = [
    { id: 'system', label: 'System', blurb: `Follows the OS — ${theme.mode === 'dark' ? 'Ink' : 'Paper'} now`, swatch: theme },
    ...THEMES.map((t) => ({ id: t.id, label: t.label, blurb: t.blurb, swatch: t })),
  ]
  return (
    <div role="radiogroup" aria-label="Theme" className={cn('flex flex-col', className)}>
      {options.map((o) => {
        const selected = o.id === choice
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => setTheme(o.id)}
            className={cn(
              'flex items-center gap-3 px-2 py-1.5 text-left focus:outline-none focus-visible:bg-paper-warm hover:bg-paper-warm',
              selected && 'bg-paper-warm',
            )}
          >
            <Swatch theme={o.swatch} />
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-xs uppercase tracking-widest text-ink">{o.label}</span>
              <span className="block font-mono text-[10px] text-ink-muted truncate">{o.blurb}</span>
            </span>
            {selected && <Check className="w-3.5 h-3.5 text-ink shrink-0" aria-hidden="true" />}
          </button>
        )
      })}
    </div>
  )
}
