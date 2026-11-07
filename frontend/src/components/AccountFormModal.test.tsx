import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AccountFormModal } from './AccountFormModal'
import { findBank, initials } from '../lib/banks'

const createAccount = vi.fn(async (body: unknown) => ({ id: 'a1', ...(body as object) }))

vi.mock('../context/WorkspaceContext', () => ({ useWorkspace: () => ({ workspace: { id: 'w1', name: 'Personal' } }) }))
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { first_name: 'Asha', last_name: 'Rao' } }) }))
vi.mock('../hooks/queries', () => ({
  useAccountMutations: () => ({ create: { mutateAsync: createAccount, isPending: false }, update: { mutateAsync: vi.fn(), isPending: false } }),
  useTags: () => ({ data: [] }),
  useTagMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false } }),
}))

describe('banks', () => {
  it('matches names and aliases, and makes initials for the rest', () => {
    expect(findBank('hdfc bank')?.id).toBe('hdfc')
    expect(findBank('JPMorgan Chase')?.id).toBe('chase')
    expect(findBank('Pune Co-operative Bank')).toBeNull()
    expect(initials('Pune Co-operative Bank')).toBe('PC')
  })
})

describe('AccountFormModal', () => {
  it('adds an account from the basics; picking a bank fills country, currency and name', async () => {
    const user = userEvent.setup()
    const onSaved = vi.fn()
    render(<AccountFormModal open onOpenChange={() => {}} onSaved={onSaved} />)

    // Details are folded away when adding; the holder comes from the profile.
    expect(screen.queryByLabelText(/Account number/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Account holder')).toHaveValue('Asha Rao')

    await user.click(screen.getByRole('button', { name: /Bank or broker/ }))
    await user.type(screen.getByLabelText('Search banks'), 'hdfc')
    await user.click(screen.getByRole('option', { name: /HDFC Bank/ }))

    expect(screen.getByLabelText('Account name')).toHaveValue('HDFC Bank Savings')
    expect(screen.getByLabelText('Country')).toHaveValue('IN')
    expect(screen.getByLabelText('Currency')).toHaveValue('INR')

    await user.click(screen.getByRole('radio', { name: 'Checking' }))
    expect(screen.getByLabelText('Account name')).toHaveValue('HDFC Bank Checking')

    await user.type(screen.getByLabelText(/Balance today/), '125000')
    await user.click(screen.getByRole('button', { name: /More details/ }))
    expect(screen.getByLabelText(/Account number/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save account' }))
    expect(createAccount).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'HDFC Bank Checking',
        institution: 'HDFC Bank',
        holder_name: 'Asha Rao',
        account_type: 'checking',
        country: 'IN',
        currency: 'INR',
        opening_balance: expect.objectContaining({ amount: '125000' }),
      }),
    )
  })
})
