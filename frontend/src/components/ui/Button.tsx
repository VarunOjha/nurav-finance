import { Loader2 } from 'lucide-react'
import { cn } from '../../lib/cn'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  size?: 'sm' | 'md'
  isLoading?: boolean
}

// min-h-10 gives a 40px touch target below md without changing desktop density
const BASE =
  'font-mono uppercase tracking-widest text-xs focus:outline-none focus-visible:ring-1 focus-visible:ring-ink inline-flex items-center gap-1.5 min-h-10 md:min-h-0'

const VARIANT: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary: 'text-ink border border-ink hover:underline disabled:border-line disabled:text-ink-faint disabled:no-underline',
  secondary: 'text-ink-muted hover:underline hover:text-ink px-1 -mx-1 md:px-0 md:mx-0',
  danger: 'text-error border border-error hover:underline disabled:border-line disabled:text-ink-faint',
  ghost: 'text-ink-muted hover:text-ink px-1 -mx-1 md:px-0 md:mx-0',
}

const SIZE: Record<NonNullable<ButtonProps['size']>, string> = {
  sm: 'px-3 py-1',
  md: 'px-4 py-2',
}

// House button — same variants as Nurav Docs; loading disables clicks.
export function Button({
  variant = 'primary',
  size = 'md',
  isLoading = false,
  children,
  className,
  disabled,
  type = 'button',
  ...props
}: ButtonProps) {
  const hasPadding = variant === 'primary' || variant === 'danger'
  return (
    <button
      {...props}
      type={type}
      disabled={disabled || isLoading}
      className={cn(BASE, VARIANT[variant], hasPadding && SIZE[size], className)}
    >
      {isLoading && <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" aria-hidden="true" />}
      {children}
    </button>
  )
}
