import { useState } from 'react'
import { Home, Wallet } from 'lucide-react'
import { findBank, initials, LOGO_FILES } from '../lib/banks'
import { cn } from '../lib/cn'

const SIZES = { xs: 20, sm: 24, md: 28, lg: 36, xl: 48 } as const

interface Props {
  institution: string | null | undefined
  /** The account's type: an "asset" (a house, a car…) always shows a house. */
  accountType?: string
  size?: keyof typeof SIZES
  className?: string
}

/**
 * The bank's logo: the bundled image for known banks (on a white tile, so it
 * reads on every theme), initials for others, a wallet when there's no bank,
 * and a house for an asset account.
 */
export function BankLogo({ institution, accountType, size = 'md', className }: Props) {
  const px = SIZES[size]
  const box = { width: px, height: px }
  const name = institution?.trim()
  const bank = findBank(name)
  const [broken, setBroken] = useState(false)

  if (accountType === 'asset' || !name) {
    const Icon = accountType === 'asset' ? Home : Wallet
    return (
      <span
        aria-hidden="true"
        data-testid={accountType === 'asset' ? 'asset-icon' : undefined}
        style={box}
        className={cn('inline-flex flex-none items-center justify-center rounded-[4px] border border-line text-ink-muted', className)}
      >
        <Icon style={{ width: px * 0.5, height: px * 0.5 }} />
      </span>
    )
  }
  if (bank && LOGO_FILES.has(bank.id) && !broken) {
    return (
      <span aria-hidden="true" style={box} className={cn('inline-flex flex-none items-center justify-center overflow-hidden rounded-[4px] border border-line bg-white', className)}>
        <img
          src={`/banks/${bank.id}.png`}
          alt=""
          data-testid="bank-logo"
          loading="lazy"
          onError={() => setBroken(true)}
          style={{ width: px - 4, height: px - 4 }}
          className="object-contain"
        />
      </span>
    )
  }
  const text = bank ? bank.mark : initials(name)
  const fontSize = Math.max(6, Math.round(px * (text.length > 3 ? 0.24 : text.length > 2 ? 0.28 : 0.36)))
  return (
    <span
      aria-hidden="true"
      data-testid="bank-mark"
      style={{ ...box, fontSize, background: bank ? bank.color : '#57534E' }}
      className={cn('inline-flex flex-none items-center justify-center rounded-[4px] font-mono font-bold leading-none tracking-tight text-white', className)}
    >
      {text}
    </span>
  )
}
