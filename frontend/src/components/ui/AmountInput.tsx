import { forwardRef, useImperativeHandle, useLayoutEffect, useRef, type InputHTMLAttributes, type ReactNode } from 'react'
import { cn } from '../../lib/cn'
import { formatAmountInput, reformat, type AmountOptions } from '../../lib/amount'
import { CONTROL, Help, Label } from './Field'

type NativeProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type' | 'inputMode'>

export interface AmountInputProps extends NativeProps, AmountOptions {
  /** Ungrouped value as typed, e.g. "1234." — run it through parseAmount() before submitting. */
  value: string
  onValueChange: (value: string) => void
}

/**
 * Bare text input that groups digits as you type (INR lakh/crore, otherwise
 * thousands) and keeps the caret beside the digit you were editing.
 */
export const AmountInput = forwardRef<HTMLInputElement, AmountInputProps>(function AmountInput(
  { value, onValueChange, currency, maxDecimals, allowNegative, ...props },
  ref,
) {
  const inner = useRef<HTMLInputElement>(null)
  const caret = useRef<number | null>(null)
  useImperativeHandle(ref, () => inner.current as HTMLInputElement)
  const opts = { currency, maxDecimals, allowNegative }
  const display = formatAmountInput(value, opts)

  useLayoutEffect(() => {
    const el = inner.current
    if (caret.current !== null && el && document.activeElement === el) el.setSelectionRange(caret.current, caret.current)
    caret.current = null
  })

  return (
    <input
      ref={inner}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      {...props}
      value={display}
      onChange={(e) => {
        const next = reformat(e.target.value, e.target.selectionStart ?? e.target.value.length, opts)
        caret.current = next.caret
        onValueChange(next.value.replace(/,/g, ''))
      }}
    />
  )
})

interface AmountFieldProps extends AmountInputProps {
  label?: ReactNode
  hint?: ReactNode
  error?: string | null
}

/** Labelled AmountInput in the house underlined style (same as Input). */
export const AmountField = forwardRef<HTMLInputElement, AmountFieldProps>(function AmountField(
  { label, hint, error, className, id, ...props },
  ref,
) {
  return (
    <div className={className}>
      {label && <Label htmlFor={id}>{label}</Label>}
      <AmountInput ref={ref} id={id} className={cn(CONTROL, 'num')} aria-invalid={!!error || undefined} {...props} />
      <Help hint={hint} error={error} />
    </div>
  )
})
