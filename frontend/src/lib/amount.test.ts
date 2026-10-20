import { formatAmountInput, groupDigits, parseAmount, reformat, trimDecimal } from './amount'

describe('amount grouping', () => {
  it('groups rupees in lakhs and crores, everything else in thousands', () => {
    expect(groupDigits('1234567', 'INR')).toBe('12,34,567')
    expect(groupDigits('123456789', 'INR')).toBe('12,34,56,789')
    expect(groupDigits('1234567', 'USD')).toBe('1,234,567')
    expect(groupDigits('1234567')).toBe('1,234,567')
    expect(groupDigits('999', 'INR')).toBe('999')
    expect(groupDigits('1000', 'INR')).toBe('1,000')
  })

  it('cleans typed and pasted input but keeps partial numbers', () => {
    expect(formatAmountInput('1234567.89', { currency: 'INR' })).toBe('12,34,567.89')
    expect(formatAmountInput('$1,234,567.891', { currency: 'USD' })).toBe('1,234,567.89') // 2 decimals by default
    expect(formatAmountInput('1234.', { currency: 'USD' })).toBe('1,234.')
    expect(formatAmountInput('0.0')).toBe('0.0')
    expect(formatAmountInput('.5')).toBe('0.5')
    expect(formatAmountInput('007')).toBe('7')
    expect(formatAmountInput('1.2.3', { maxDecimals: 4 })).toBe('1.23')
    expect(formatAmountInput('12abc3')).toBe('123')
    expect(formatAmountInput('5.', { maxDecimals: 0 })).toBe('5')
    expect(formatAmountInput('0.123456789', { maxDecimals: 8 })).toBe('0.12345678')
  })

  it('keeps a minus sign only where negatives are allowed', () => {
    expect(formatAmountInput('-1234', { allowNegative: true })).toBe('-1,234')
    expect(formatAmountInput('-', { allowNegative: true })).toBe('-')
    expect(formatAmountInput('-1234')).toBe('1,234')
  })

  it('parses display text back to a plain decimal', () => {
    expect(parseAmount('12,34,567.89')).toBe('1234567.89')
    expect(parseAmount('1,234.')).toBe('1234')
    expect(parseAmount('-')).toBe('')
    expect(parseAmount('')).toBe('')
  })

  it('trims API decimals without exponent notation', () => {
    expect(trimDecimal('10.50000000')).toBe('10.5')
    expect(trimDecimal('0.00000010')).toBe('0.0000001')
    expect(trimDecimal('25.000000')).toBe('25')
    expect(trimDecimal(null)).toBe('')
  })

  it('keeps the caret beside the digit being edited', () => {
    // Typing "4" at the end of "1,23" → "1,234"
    expect(reformat('1,234', 5, { currency: 'USD' })).toEqual({ value: '1,234', caret: 5 })
    // "1,234" + "5" → "12,345": caret stays at the end
    expect(reformat('1,2345', 6, { currency: 'USD' })).toEqual({ value: '12,345', caret: 6 })
    // Typing "9" after the first digit of "1,234" → "19,234", caret after the 9
    expect(reformat('19,234', 2, { currency: 'USD' })).toEqual({ value: '19,234', caret: 2 })
    // Deleting the first digit of "1,234" (raw ",234", caret 0) → "234"
    expect(reformat(',234', 0, { currency: 'USD' })).toEqual({ value: '234', caret: 0 })
    // INR: inserting a digit regroups to lakhs
    expect(reformat('12,3456', 7, { currency: 'INR' })).toEqual({ value: '1,23,456', caret: 8 })
  })
})
