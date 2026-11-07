import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { ChevronDown } from 'lucide-react'
import { BANKS, findBank, searchBanks, type Bank } from '../lib/banks'
import { countryName } from '../lib/format'
import { cn } from '../lib/cn'
import { BankLogo } from './BankLogo'
import { Label } from './ui/Field'

interface Props {
  id: string
  value: string
  /** The person's likely country, listed first (the account's country or the profile's). */
  country?: string
  onChange: (institution: string, bank: Bank | null) => void
  label?: string
  /** What choosing nothing means here. */
  noneLabel?: string
}

const LIMIT_IDLE = 8

/** Bank / broker combobox: logos, search, your country first, or any typed name. */
export function BankPicker({ id, value, country, onChange, label = 'Bank or broker', noneLabel = 'No bank · cash, wallet or other' }: Props) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const root = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    search.current?.focus()
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const groups = useMemo(() => {
    const hits = query.trim() ? searchBanks(query) : BANKS
    const home = country ? hits.filter((b) => b.country === country) : []
    const rest = hits.filter((b) => !home.includes(b))
    const out: { label: string; banks: Bank[] }[] = []
    if (home.length) out.push({ label: `${countryName(country!)}`, banks: query ? home : home.slice(0, LIMIT_IDLE) })
    if (rest.length) out.push({ label: home.length ? 'Elsewhere' : 'Banks & brokers', banks: query ? rest : rest.slice(0, LIMIT_IDLE) })
    return out
  }, [query, country])

  const typed = query.trim()
  const flat = groups.flatMap((g) => g.banks)
  const showCustom = typed !== '' && !findBank(typed)
  const options: { key: string; pick: () => void }[] = [
    ...flat.map((bank) => ({ key: bank.id, pick: () => choose(bank.name, bank) })),
    ...(showCustom ? [{ key: '__custom', pick: () => choose(typed, null) }] : []),
    { key: '__none', pick: () => choose('', null) },
  ]

  function choose(name: string, bank: Bank | null) {
    onChange(name, bank)
    setOpen(false)
    setQuery('')
    setActive(0)
  }

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      setOpen(false)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, options.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      options[active]?.pick()
    }
  }

  const known = findBank(value)
  const optionCls = (key: string) =>
    cn('w-full flex items-center gap-3 px-3.5 py-2 min-h-10 text-left font-mono text-xs text-ink hover:bg-paper-warm', options[active]?.key === key && 'bg-paper-warm')

  return (
    <div ref={root} className="relative">
      <Label htmlFor={id}>{label}</Label>
      <button
        id={id}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-3 border-0 border-b border-line focus:border-ink focus:outline-none py-2 min-h-11 text-left"
      >
        <BankLogo institution={value} size="md" />
        <span className={cn('flex-1 font-mono text-[14px]', value ? 'text-ink' : 'text-ink-faint')}>{value || noneLabel}</span>
        {value && !known && <span className="font-mono text-[10px] text-ink-faint">not in the list</span>}
        <ChevronDown className="w-3.5 h-3.5 text-ink-muted" aria-hidden="true" />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 bg-paper border border-ink shadow-[4px_4px_0_rgba(26,25,24,.12)]" onKeyDown={onKey}>
          <div className="px-3.5 py-2 border-b border-line">
            <input
              ref={search}
              aria-label="Search banks"
              placeholder="Search, or type any bank's name…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
              className="w-full bg-transparent border-0 focus:outline-none font-mono text-[13px] text-ink py-1.5 placeholder:text-ink-faint"
            />
          </div>
          <div role="listbox" aria-label="Banks" className="max-h-80 overflow-y-auto pb-1">
            {groups.map((g) => (
              <div key={g.label} role="group" aria-label={g.label}>
                <p className="px-3.5 pt-2.5 pb-1 font-mono text-[10px] uppercase tracking-widest text-ink-muted">
                  {g.label}
                  {!query && g.banks.length === LIMIT_IDLE && ' · type to see all'}
                </p>
                {g.banks.map((bank) => (
                  <button key={bank.id} type="button" role="option" aria-selected={bank.name === value} className={optionCls(bank.id)} onClick={() => choose(bank.name, bank)}>
                    <BankLogo institution={bank.name} size="sm" />
                    <span className="flex-1">{bank.name}</span>
                    <span className="text-[10px] text-ink-muted">{bank.country || 'Global'}</span>
                  </button>
                ))}
              </div>
            ))}
            {showCustom && (
              <button type="button" role="option" aria-selected={false} className={cn(optionCls('__custom'), 'border-t border-line')} onClick={() => choose(typed, null)}>
                <BankLogo institution={typed} size="sm" />
                <span className="flex-1">Use “{typed}”</span>
              </button>
            )}
            <button type="button" role="option" aria-selected={!value} className={cn(optionCls('__none'), 'border-t border-line text-ink-muted')} onClick={() => choose('', null)}>
              <BankLogo institution="" size="sm" />
              <span className="flex-1">{noneLabel}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
