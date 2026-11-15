import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import SnapshotPage from './SnapshotPage'

const createPortfolio = vi.fn(async (_body: unknown) => ({ id: 'new1' }))
let accountPortfolios: { id: string; name: string }[] = []

vi.mock('../hooks/queries', () => ({
  useAccount: (id: string) => ({
    isLoading: false,
    error: null,
    data: id ? { id, name: 'Zerodha Brokerage', institution: 'Zerodha', currency: 'INR', portfolios: accountPortfolios } : undefined,
  }),
  usePortfolio: () => ({ isLoading: false, error: null, data: undefined }),
  useSnapshotPrefill: () => ({ isLoading: false, data: undefined }),
  usePortfolioMutations: () => ({
    create: { mutateAsync: createPortfolio, isPending: false },
    createSnapshot: { mutateAsync: vi.fn(), isPending: false },
  }),
}))

function at(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/accounts/:accountId/portfolio/new" element={<SnapshotPage />} />
        <Route path="/portfolios/:portfolioId/snapshots/new" element={<p>record on existing</p>} />
        <Route path="/portfolios/:portfolioId" element={<p>portfolio page</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('Add portfolio page (portfolio created with its first holdings)', () => {
  beforeEach(() => {
    createPortfolio.mockClear()
    accountPortfolios = []
  })

  it('saves the portfolio and its first holdings in one go', async () => {
    const user = userEvent.setup()
    at('/accounts/a3/portfolio/new?name=Zerodha&provider=Zerodha&currency=INR')
    expect(screen.getByRole('heading', { name: /Add portfolio · Zerodha/ })).toBeInTheDocument()
    expect(screen.getByText(/created when you save its first holdings/)).toBeInTheDocument()

    await user.type(screen.getAllByLabelText('Symbol')[0], 'infy')
    await user.type(screen.getAllByLabelText('Quantity')[0], '10')
    await user.type(screen.getAllByLabelText('Current price')[0], '1500')
    await user.click(screen.getByRole('button', { name: 'Save portfolio & holdings' }))
    expect(createPortfolio).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Zerodha',
        provider: 'Zerodha',
        currency: 'INR',
        account_id: 'a3',
        snapshot: expect.objectContaining({ holdings: [expect.objectContaining({ symbol: 'INFY', quantity: '10', current_price: '1500' })] }),
      }),
    )
    expect(await screen.findByText('portfolio page')).toBeInTheDocument()
  })

  it('an account that already has its portfolio goes to record on it instead', () => {
    accountPortfolios = [{ id: 'z1', name: 'Zerodha' }]
    at('/accounts/a3/portfolio/new?name=Zerodha')
    expect(screen.getByText('record on existing')).toBeInTheDocument()
    expect(createPortfolio).not.toHaveBeenCalled()
  })
})
