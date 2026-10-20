import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { HoldingsCsvModal } from './HoldingsCsvModal'

describe('HoldingsCsvModal', () => {
  it('only accepts text that validated cleanly', async () => {
    const user = userEvent.setup()
    const onAccept = vi.fn()
    render(<HoldingsCsvModal open onOpenChange={() => {}} currency="USD" onAccept={onAccept} />)
    const box = screen.getByLabelText('CSV')
    const accept = () => screen.getByRole('button', { name: /^Accept/ })

    fireEvent.change(box, { target: { value: 'symbol,quantity,price\nAAPL,0,10' } })
    await user.click(screen.getByRole('button', { name: 'Validate' }))
    expect(screen.getByRole('alert')).toHaveTextContent('Line 2: Quantity must be greater than 0')
    expect(accept()).toBeDisabled()

    fireEvent.change(box, { target: { value: 'symbol,quantity,buy_price,current_price\nAAPL,2,8,10' } })
    expect(accept()).toBeDisabled() // edited since the last check
    await user.click(screen.getByRole('button', { name: 'Validate' }))
    expect(screen.getByText(/1 holding valid/)).toBeInTheDocument()

    await user.click(accept())
    expect(onAccept).toHaveBeenCalledWith([{ line: 2, symbol: 'AAPL', name: null, asset_class: 'stock', quantity: '2', buy_price: '8', current_price: '10' }])
  })
})
