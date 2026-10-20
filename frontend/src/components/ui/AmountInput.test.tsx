import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AmountField } from './AmountInput'

function Harness({ currency, onValue }: { currency: string; onValue: (v: string) => void }) {
  const [value, setValue] = useState('')
  return (
    <AmountField
      id="amt"
      label="Balance"
      currency={currency}
      value={value}
      onValueChange={(v) => {
        setValue(v)
        onValue(v)
      }}
    />
  )
}

describe('AmountField', () => {
  it('groups rupees as you type and reports the plain value', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<Harness currency="INR" onValue={onValue} />)
    const input = screen.getByLabelText('Balance')
    await user.type(input, '1234567.891')
    expect(input).toHaveValue('12,34,567.89')
    expect(onValue).toHaveBeenLastCalledWith('1234567.89')
  })

  it('uses thousands for other currencies and ignores letters', async () => {
    const user = userEvent.setup()
    const onValue = vi.fn()
    render(<Harness currency="USD" onValue={onValue} />)
    const input = screen.getByLabelText('Balance')
    await user.type(input, '12a34567')
    expect(input).toHaveValue('1,234,567')
    expect(onValue).toHaveBeenLastCalledWith('1234567')
  })
})
