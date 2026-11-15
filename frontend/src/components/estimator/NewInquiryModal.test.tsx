import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { NewInquiryModal } from './NewInquiryModal'
import type { EstimatorPool } from '../../types/api'

const pool: EstimatorPool = {
  currencies: ['USD', 'INR'],
  accounts: [
    { id: 'a', name: 'Chase Savings', institution: null, account_type: 'savings', currency: 'USD', value: '27400', fixed: false },
    { id: 'b', name: 'Fidelity Brokerage', institution: null, account_type: 'brokerage', currency: 'USD', value: '170500', fixed: false },
    { id: 'h', name: '2821 Turpin House', institution: null, account_type: 'asset', currency: 'USD', value: '115000', fixed: true },
    { id: 'c', name: 'SBI FD', institution: null, account_type: 'fixed_deposit', currency: 'INR', value: '2810000', fixed: false },
  ],
}

vi.mock('../../hooks/queries', () => ({
  useEstimatorPool: () => ({ data: pool, isLoading: false, error: null }),
  useInquiryMutations: () => ({ refresh: vi.fn() }),
}))

describe('NewInquiryModal', () => {
  it('keeps fixed assets out, totals what is ticked, and needs expenses to run', async () => {
    render(
      <MemoryRouter>
        <NewInquiryModal open onOpenChange={() => {}} />
      </MemoryRouter>,
    )
    const house = screen.getByRole('checkbox', { name: /2821 Turpin House/ })
    expect(house).toBeDisabled()
    expect(house).not.toBeChecked()
    expect(screen.getByText('$197.9K')).toBeInTheDocument() // Chase + Fidelity, not the house

    await userEvent.click(screen.getByRole('checkbox', { name: /Chase Savings/ }))
    expect(screen.getAllByText('$170.5K')).toHaveLength(2) // the total, and Fidelity's own row

    const run = screen.getByRole('button', { name: 'Run' })
    expect(run).toBeDisabled()
    await userEvent.type(screen.getByLabelText('Monthly expenses'), '8000')
    expect(run).toBeEnabled()
    expect(screen.getByLabelText('Currency')).toHaveValue('USD')
    expect(screen.getByLabelText('Withdrawal rate')).toHaveValue(3.5)
    await userEvent.click(screen.getByRole('button', { name: '4%' }))
    expect(screen.getByLabelText('Withdrawal rate')).toHaveValue(4)
    await userEvent.clear(screen.getByLabelText('Withdrawal rate'))
    await userEvent.type(screen.getByLabelText('Withdrawal rate'), '12')
    expect(run).toBeDisabled()
  })
})
