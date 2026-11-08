import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InvestedTable, NowTable, WinnersLosers, outcomes } from './HoldingsTables'
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
const props = { holdings, currency: 'USD', classColor: () => '#000', className: (c: string) => c, fallbackColor: '#999' }
const order = () => screen.getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell')[0].textContent)

describe('InvestedTable', () => {
  it('ranks by money invested, keeps holdings without a buy price last, and says why', async () => {
    const user = userEvent.setup()
    render(<InvestedTable {...props} />)
    expect(screen.getByRole('columnheader', { name: /Invested/ })).toHaveAttribute('aria-sort', 'descending')
    expect(screen.queryByRole('columnheader', { name: /^Value/ })).not.toBeInTheDocument()
    expect(order()).toEqual(['AAPL', 'MSFT', 'TSLA'])

    await user.click(screen.getByRole('button', { name: /Share of invested/ }))
    await user.click(screen.getByRole('button', { name: /Share of invested/ }))
    expect(order()).toEqual(['MSFT', 'AAPL', 'TSLA']) // ascending; no buy price stays last
    expect(screen.getByText(/1 holding has no buy price/)).toBeInTheDocument()
  })
})

describe('NowTable', () => {
  it('shows only today’s side, ranked by value', () => {
    render(<NowTable {...props} />)
    expect(screen.getByRole('columnheader', { name: /Share of value/ })).toBeInTheDocument()
    expect(screen.queryByRole('columnheader', { name: /Avg buy/ })).not.toBeInTheDocument()
    expect(order()).toEqual(['AAPL', 'MSFT', 'TSLA'])
  })
})

describe('outcomes', () => {
  it('compares shares over the same holdings, so both sides add up to 100%', () => {
    const rows = outcomes(holdings)
    expect(rows.map((r) => r.holding.symbol)).toEqual(['AAPL', 'MSFT']) // TSLA has no buy price
    const aapl = rows[0]
    expect(aapl.costShare).toBeCloseTo(2500 / 3500)
    expect(aapl.valueShare).toBeCloseTo(4000 / 5500)
    expect(aapl.gainPct).toBeCloseTo(0.6)
    expect(rows.reduce((s, r) => s + r.valueShare, 0)).toBeCloseTo(1)
  })
})

describe('WinnersLosers', () => {
  it('splits bets into winners (biggest gain first) and losers (biggest loss first)', () => {
    const mixed = [
      h('AAPL', '4000', '0.4', '2500', '0.25'),
      h('INTC', '1000', '0.1', '3000', '0.3'),
      h('MSFT', '1500', '0.15', '1000', '0.1'),
      h('TSLA', '3000', '0.3', '3500', '0.35'),
    ]
    render(<WinnersLosers rows={outcomes(mixed)} currency="USD" />)
    const rowsIn = (name: string) =>
      within(screen.getByRole('region', { name }))
        .getAllByRole('row')
        .slice(1)
        .map((r) => within(r).getAllByRole('cell')[0].textContent)
    expect(rowsIn('Top winners')).toEqual(['AAPL', 'MSFT'])
    expect(rowsIn('Top losers')).toEqual(['INTC', 'TSLA'])
  })
})
