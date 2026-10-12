import { forwardRef, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cn } from '../../lib/cn'

// Underlined inputs with tiny uppercase labels — the Nurav Docs form style.
const CONTROL =
  'w-full bg-transparent border-0 border-b border-line focus:border-ink focus:outline-none font-mono text-[13px] text-ink py-2 placeholder:text-ink-faint disabled:text-ink-faint'

export function Label({ htmlFor, children }: { htmlFor?: string; children: ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="block font-mono text-[10px] uppercase tracking-widest text-ink-muted mb-1.5">
      {children}
    </label>
  )
}

interface FieldProps {
  label?: ReactNode
  hint?: ReactNode
  error?: string | null
  className?: string
}

function Help({ hint, error }: { hint?: ReactNode; error?: string | null }) {
  if (error) return <p className="font-mono text-[10px] text-error mt-1">{error}</p>
  if (hint) return <p className="font-mono text-[10px] text-ink-faint mt-1">{hint}</p>
  return null
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & FieldProps>(function Input(
  { label, hint, error, className, id, ...props },
  ref,
) {
  return (
    <div className={className}>
      {label && <Label htmlFor={id}>{label}</Label>}
      <input ref={ref} id={id} className={CONTROL} aria-invalid={!!error || undefined} {...props} />
      <Help hint={hint} error={error} />
    </div>
  )
})

export function Select({ label, hint, error, className, id, children, ...props }: SelectHTMLAttributes<HTMLSelectElement> & FieldProps) {
  return (
    <div className={className}>
      {label && <Label htmlFor={id}>{label}</Label>}
      <select id={id} className={cn(CONTROL, 'cursor-pointer [&>option]:bg-paper')} {...props}>
        {children}
      </select>
      <Help hint={hint} error={error} />
    </div>
  )
}

export function TextArea({ label, hint, error, className, id, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement> & FieldProps) {
  return (
    <div className={className}>
      {label && <Label htmlFor={id}>{label}</Label>}
      <textarea id={id} rows={2} className={cn(CONTROL, 'resize-y')} {...props} />
      <Help hint={hint} error={error} />
    </div>
  )
}

export function FormError({ message }: { message: string | null | undefined }) {
  if (!message) return null
  return (
    <p role="alert" className="font-mono text-xs text-error border border-error/40 px-3 py-2">
      {message}
    </p>
  )
}

/** Numbered section heading used in long forms ("01 · Basics"). */
export function SectionTitle({ children }: { children: ReactNode }) {
  return <h3 className="font-mono text-[10px] font-medium uppercase tracking-widest text-ink border-b border-line pb-2">{children}</h3>
}
