interface Props {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

/** The "Rising" mark: Nurav brackets around three ascending bars. */
export function LogoMark({ width, height }: { width: number; height: number }) {
  return (
    <svg width={width} height={height} viewBox="0 0 24 16" fill="none" aria-hidden="true">
      <polyline points="5,1.5 1.5,1.5 1.5,14.5 5,14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <line x1="8.5" y1="12.5" x2="8.5" y2="10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="12" y1="12.5" x2="12" y2="7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <line x1="15.5" y1="12.5" x2="15.5" y2="3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      <polyline points="19,1.5 22.5,1.5 22.5,14.5 19,14.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Brand mark plus wordmark, scaled like Nurav Docs' logo.
export function Logo({ size = 'sm', className }: Props) {
  const scale = size === 'lg' ? 1.9 : size === 'md' ? 1.35 : 1
  const text =
    size === 'lg' ? 'text-lg sm:text-xl' : size === 'md' ? 'text-base' : 'text-sm'
  return (
    <span className={`inline-flex items-center text-ink ${size === 'lg' ? 'gap-3.5' : 'gap-2.5'} ${className ?? ''}`}>
      <LogoMark width={Math.round(24 * scale)} height={Math.round(16 * scale)} />
      <span className={`font-mono uppercase tracking-brand font-bold whitespace-nowrap ${text}`}>Nurav Finance</span>
    </span>
  )
}
