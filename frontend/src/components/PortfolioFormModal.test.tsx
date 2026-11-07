import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PortfolioFormModal } from './PortfolioFormModal'
import { findBank, LOGO_FILES } from '../lib/banks'
import { peekScreenshots } from '../lib/pendingScreenshots'

const createPortfolio = vi.fn(async (body: unknown) => ({ id: 'p1', ...(body as object) }))
const createSnapshot = vi.fn(async (_v: unknown) => ({ id: 'snap1' }))

vi.mock('../context/WorkspaceContext', () => ({ useWorkspace: () => ({ workspace: { id: 'w1', name: 'Personal' } }) }))
vi.mock('../hooks/queries', () => ({
  useAccounts: () => ({
    data: [
      { id: 'a1', name: 'Wealthfront Cash', institution: 'Wealthfront', currency: 'USD', status: 'active', account_type: 'brokerage' },
      { id: 'a2', name: 'Robinhood Brokerage', institution: 'Robinhood', currency: 'USD', status: 'active', account_type: 'brokerage' },
      { id: 's1', name: 'Chase Savings', institution: 'Chase', currency: 'USD', status: 'active', account_type: 'savings' },
    ],
  }),
  usePortfolioMutations: () => ({
    create: { mutateAsync: createPortfolio, isPending: false }, update: { mutateAsync: vi.fn(), isPending: false },
    createSnapshot: { mutateAsync: createSnapshot, isPending: false },
  }),
  useTags: () => ({ data: [] }),
  useTagMutations: () => ({ create: { mutateAsync: vi.fn(), isPending: false } }),
}))

describe('PortfolioFormModal', () => {
  it('Wealthfront is known and has a bundled logo', () => {
    expect(findBank('wealthfront')?.country).toBe('US')
    expect(LOGO_FILES.has('wealthfront')).toBe(true)
  })

  it('needs a brokerage account; picking one fills provider, name and currency', async () => {
    const user = userEvent.setup()
    createPortfolio.mockClear()
    render(<PortfolioFormModal open onOpenChange={() => {}} />)

    expect(screen.queryByLabelText('Notes')).not.toBeInTheDocument()
    // Only brokerage accounts are offered.
    const account = screen.getByLabelText('Brokerage account')
    expect(within(account).queryByRole('option', { name: /Chase Savings/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save portfolio' }))
    expect(screen.getByText('Choose the brokerage account it belongs to')).toBeInTheDocument()
    expect(createPortfolio).not.toHaveBeenCalled()

    await user.selectOptions(account, 'a2')
    expect(screen.getByLabelText('Name')).toHaveValue('Robinhood')
    expect(screen.getByLabelText('Currency')).toHaveValue('USD')
    expect(screen.getByRole('button', { name: /Provider/ })).toHaveTextContent('Robinhood')

    await user.click(screen.getByRole('button', { name: /More details/ }))
    expect(screen.getByLabelText('Notes')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save portfolio' }))
    expect(createPortfolio).toHaveBeenCalledWith(expect.objectContaining({ name: 'Robinhood', provider: 'Robinhood', currency: 'USD', account_id: 'a2' }))
  })

  it("adding from an account's page prefills provider, name, currency and the link", async () => {
    const user = userEvent.setup()
    createPortfolio.mockClear()
    render(<PortfolioFormModal open onOpenChange={() => {}} forAccount={{ id: 'a1', name: 'Wealthfront Cash', institution: 'Wealthfront', currency: 'USD' }} />)

    expect(screen.getByLabelText('Name')).toHaveValue('Wealthfront')
    expect(screen.getByLabelText('Currency')).toHaveValue('USD')
    expect(screen.getByLabelText('Brokerage account')).toHaveValue('a1')

    await user.click(screen.getByRole('button', { name: 'Save portfolio' }))
    expect(createPortfolio).toHaveBeenCalledWith(expect.objectContaining({ name: 'Wealthfront', provider: 'Wealthfront', currency: 'USD', account_id: 'a1' }))
  })

  it('From screenshots tab: needs an image, then hands the images to the new portfolio', async () => {
    const user = userEvent.setup({ applyAccept: false })
    URL.createObjectURL = vi.fn(() => 'blob:preview')
    URL.revokeObjectURL = vi.fn()
    createPortfolio.mockClear()
    render(<PortfolioFormModal open onOpenChange={() => {}} forAccount={{ id: 'a1', name: 'Wealthfront Cash', institution: 'Wealthfront', currency: 'USD' }} />)

    expect(screen.getByRole('tab', { name: /Manual entry/ })).toHaveAttribute('aria-selected', 'true')
    await user.click(screen.getByRole('tab', { name: /From screenshots/ }))
    await user.click(screen.getByRole('button', { name: 'Save portfolio' }))
    expect(screen.getByText(/Add at least one screenshot/)).toBeInTheDocument()
    expect(createPortfolio).not.toHaveBeenCalled()

    const shot = new File(['png'], 'holdings.png', { type: 'image/png' })
    await user.upload(screen.getByTestId('portfolio-screenshot-input'), shot)
    expect(screen.getByAltText('Screenshot 1')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save & read 1 screenshot' }))
    expect(createPortfolio).toHaveBeenCalledTimes(1)
    expect(peekScreenshots('p1')).toEqual([shot])
  })
  it('Manual entry: holdings typed in the modal are saved as the first snapshot', async () => {
    const user = userEvent.setup()
    createPortfolio.mockClear()
    createSnapshot.mockClear()
    const onSaved = vi.fn()
    render(<PortfolioFormModal open onOpenChange={() => {}} onSaved={onSaved} forAccount={{ id: 'a2', name: 'Robinhood Brokerage', institution: 'Robinhood', currency: 'USD' }} />)

    await user.type(screen.getByLabelText('Symbol, row 1'), 'aapl')
    await user.click(screen.getByRole('button', { name: 'Save portfolio & 1 holding' }))
    expect(screen.getByText('AAPL: quantity must be a number greater than 0')).toBeInTheDocument()
    expect(createPortfolio).not.toHaveBeenCalled()

    await user.type(screen.getByLabelText('Quantity, row 1'), '10')
    await user.type(screen.getByLabelText('Current price, row 1'), '200')
    await user.click(screen.getByRole('button', { name: /Add holding/ }))
    await user.type(screen.getByLabelText('Symbol, row 2'), 'vti')
    await user.type(screen.getByLabelText('Quantity, row 2'), '2')
    await user.type(screen.getByLabelText('Buy price, row 2'), '250')
    await user.type(screen.getByLabelText('Current price, row 2'), '300')
    expect(screen.getByText('$2,600.00')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Save portfolio & 2 holdings' }))
    expect(createPortfolio).toHaveBeenCalledTimes(1)
    expect(createSnapshot).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'p1',
        holdings: [
          expect.objectContaining({ symbol: 'AAPL', quantity: '10', buy_price: null, current_price: '200' }),
          expect.objectContaining({ symbol: 'VTI', quantity: '2', buy_price: '250', current_price: '300' }),
        ],
      }),
    )
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), { recorded: true })
  })
})
