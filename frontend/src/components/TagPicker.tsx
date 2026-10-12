import { useTags } from '../hooks/queries'
import { cn } from '../lib/cn'

// Toggleable chips for the user's tags (shared by all tenants). Tags are
// created and edited in Profile.
export function TagPicker({ value, onChange }: { value: string[]; onChange: (ids: string[]) => void }) {
  const { data: tags = [], isLoading } = useTags()
  if (isLoading) return <p className="font-mono text-[11px] text-ink-faint">Loading tags…</p>
  if (tags.length === 0) return <p className="font-mono text-[11px] text-ink-faint">No tags yet — add some in Profile.</p>
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label="Tags">
      {tags.map((tag) => {
        const on = value.includes(tag.id)
        return (
          <button
            key={tag.id}
            type="button"
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((id) => id !== tag.id) : [...value, tag.id])}
            className={cn(
              'font-mono text-[10px] lowercase tracking-wide border px-2 py-1 min-h-8 focus:outline-none focus-visible:ring-1 focus-visible:ring-ink',
              on ? 'border-ink text-ink' : 'border-line text-ink-muted hover:text-ink',
            )}
          >
            {tag.name}
            {on && ' ×'}
          </button>
        )
      })}
    </div>
  )
}
