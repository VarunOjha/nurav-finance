import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { DateField, parseDate } from './DateField'
import { PasswordInput } from './Field'

function Harness({ initial = '', onValue }: { initial?: string; onValue?: (v: string) => void }) {
  const [value, setValue] = useState(initial)
  return (
    <DateField
      id="dob"
      label="Date of birth"
      value={value}
      min="1900-01-01"
      max="2026-10-13"
      onChange={(e) => {
        setValue(e.target.value)
        onValue?.(e.target.value)
      }}
    />
  )
}

describe('parseDate', () => {
  it('normalises lenient input and rejects impossible dates', () => {
    expect(parseDate('1990-5-7')).toBe('1990-05-07')
    expect(parseDate('1990/05/07')).toBe('1990-05-07')
    expect(parseDate('1990-02-30')).toBeNull()
    expect(parseDate('05/07/1990')).toBeNull()
  })
})

describe('DateField', () => {
  it('jumps to a year and month with the dropdowns, then picks a day', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)

    await user.click(screen.getByRole('button', { name: 'Choose date from calendar' }))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Year' }), '1987')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Month' }), '2') // March
    await user.click(screen.getByRole('gridcell', { name: /March 14, 1987/ }))

    expect(onValue).toHaveBeenLastCalledWith('1987-03-14')
    expect(screen.getByLabelText('Date of birth')).toHaveValue('1987-03-14')
    expect(screen.queryByRole('grid')).not.toBeInTheDocument()
  })

  it('moves by day and month with the keyboard', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<Harness initial="2000-01-31" onValue={onValue} />)

    await user.click(screen.getByRole('button', { name: 'Choose date from calendar' }))
    expect(screen.getByRole('gridcell', { name: /January 31, 2000/ })).toHaveFocus()
    await user.keyboard('{PageDown}') // Jan 31 -> Feb 29 (clamped, leap year)
    await user.keyboard('{ArrowLeft}{Enter}')
    expect(onValue).toHaveBeenLastCalledWith('2000-02-28')
  })

  it('accepts typed dates and flags bad or out-of-range ones', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<Harness onValue={onValue} />)
    const input = screen.getByLabelText('Date of birth')

    await user.type(input, '1990-5-7')
    expect(onValue).toHaveBeenLastCalledWith('1990-05-07')
    await user.tab()
    expect(input).toHaveValue('1990-05-07')

    await user.clear(input)
    await user.type(input, 'yesterday')
    await user.tab()
    expect(screen.getByText(/Use YYYY-MM-DD/)).toBeInTheDocument()

    await user.clear(input)
    await user.type(input, '2030-01-01')
    expect(screen.getByText('Must be on or before 2026-10-13')).toBeInTheDocument()
  })

  it('disables days and months outside min/max', async () => {
    const user = userEvent.setup()
    render(<Harness initial="2026-10-01" />)
    await user.click(screen.getByRole('button', { name: 'Choose date from calendar' }))
    expect(screen.getByRole('gridcell', { name: /October 14, 2026/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled()
  })
})

describe('PasswordInput', () => {
  it('toggles between hidden and visible', async () => {
    const user = userEvent.setup()
    render(<PasswordInput id="pw" label="Password" defaultValue="secret1" />)
    const input = screen.getByLabelText('Password')
    expect(input).toHaveAttribute('type', 'password')
    await user.click(screen.getByRole('button', { name: 'Show password' }))
    expect(input).toHaveAttribute('type', 'text')
    await user.click(screen.getByRole('button', { name: 'Hide password' }))
    expect(input).toHaveAttribute('type', 'password')
  })
})
