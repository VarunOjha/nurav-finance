import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ConsolidatedHoldingsTable } from './ConsolidatedHoldingsTable'
import type { ConsolidatedHolding } from '../types/api'

const h = (symbol: string, value: string, share: string, cost: string | null, costShare: string | null): ConsolidatedHolding => ({
  symbol,
  name: null,
  asset_class: 'stock',
  quantity: '10',
  value,
  share,
  current_price: '1',
  cost,
  avg_buy_price: cost,
  cost_share: costShare,
  gain: cost,
  gain_pct: null,
  portfolios: ['Robinhood'],
})

const holdings = [h('AAPL', '4000', '0.70', '2500', '0.71'), h('TSLA', '250', '0.04', null, null), h('MSFT', '1500', '0.26', '1000', '0.29')]
const order = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)

describe('ConsolidatedHoldingsTable', () => {
  it('shows starting stake beside current share and sorts any column, blanks last', async () => {
    const user = userEvent.setup()
    render(<ConsolidatedHoldingsTable holdings={holdings} currency="USD" classColor={() => '#000'} className={(c) => c} fallbackColor="#999" />)

    expect(screen.getByRole('columnheader', { name: /Starting stake/ })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: /Current share/ })).toHaveAttribute('aria-sort', 'none')
    expect(order()).toEqual(['AAPL', 'MSFT', 'TSLA']) // value, high → low

    await user.click(screen.getByRole('button', { name: /Starting stake/ }))
    expect(screen.getByRole('columnheader', { name: /Starting stake/ })).toHaveAttribute('aria-sort', 'descending')
    expect(order()).toEqual(['AAPL', 'MSFT', 'TSLA'])
    await user.click(screen.getByRole('button', { name: /Starting stake/ }))
    expect(order()).toEqual(['MSFT', 'AAPL', 'TSLA']) // ascending; no buy price stays last

    await user.click(screen.getByRole('button', { name: /Holding/ }))
    expect(order()).toEqual(['AAPL', 'MSFT', 'TSLA'])
    expect(screen.getByText(/1 holding has no buy price/)).toBeInTheDocument()
  })
})
