import { forwardRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { cn } from '../../lib/cn'

// Underlined inputs with tiny uppercase labels — the Nurav Docs form style.
export const CONTROL =
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

export function Help({ hint, error }: { hint?: ReactNode; error?: string | null }) {
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

/** Password input with a show/hide toggle. Defaults to hidden. */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & FieldProps>(function PasswordInput(
  { label, hint, error, className, id, disabled, ...props },
  ref,
) {
  const [visible, setVisible] = useState(false)
  return (
    <div className={className}>
      {label && <Label htmlFor={id}>{label}</Label>}
      <div className="relative">
        <input
          ref={ref}
          id={id}
          type={visible ? 'text' : 'password'}
          className={cn(CONTROL, 'pr-9')}
          aria-invalid={!!error || undefined}
          disabled={disabled}
          {...props}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          disabled={disabled}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          aria-controls={id}
          className="absolute right-0 top-1/2 -translate-y-1/2 w-8 h-8 inline-flex items-center justify-center text-ink-muted hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink disabled:opacity-30"
        >
          {visible ? <EyeOff size={15} aria-hidden="true" /> : <Eye size={15} aria-hidden="true" />}
        </button>
      </div>
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
