import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import DashboardPage from './DashboardPage'
import { lifeSpan } from '../components/dashboard/LifeMap'
import type { Dashboard, Metrics } from '../types/api'

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const growth = { id: 'g', name: 'Growth', color: 0 }
const emergency = { id: 'e', name: 'Emergency', color: 1 }
const cash = { id: 'c', name: 'Cash', color: 2 }

const dashboard: Dashboard = {
  today: '2026-11-08',
  next_milestone: { id: 'm1', name: '2030', target_date: '2030-04-30' },
  currencies: [
    {
      currency: 'USD',
      net_worth: '794608',
      account_count: 10,
      yearly: [{ year: 2026, value: '794608', as_of: '2026-11-08' }],
      top_entries: [{ kind: 'holding', name: 'MSFT', symbol: 'MSFT', held_in: ['Morgan Stanley'], value: '238075', share: '0.3', bucket_ids: ['g'] }],
      top_stocks: [{ symbol: 'NKE', name: 'Nike', held_in: ['Fidelity', 'Robinhood'], value: '19878', cost: '30428', gain_pct: '-34.67', share: '0.046' }],
      grid: { buckets: [growth, cash], rows: [{ account_id: 'a1', name: 'Chase Savings', cells: [null, '27410'], total: '27410' }], totals: ['0', '27410'] },
    },
    {
      currency: 'INR',
      net_worth: '7143620',
      account_count: 7,
      yearly: [],
      top_entries: [],
      top_stocks: [],
      grid: { buckets: [], rows: [], totals: [] },
    },
  ],
  attention: [
    { kind: 'rebalance', currency: 'USD', bucket: cash, amount: '29589', other_bucket: emergency, other_amount: '56532', expected_return: null, label: null, symbol: null, share: null },
    { kind: 'concentration', currency: 'USD', bucket: growth, amount: null, other_bucket: null, other_amount: null, expected_return: null, label: null, symbol: 'MSFT', share: '0.42' },
  ],
  checkin: {
    last: '2026-11-08',
    items: [
      { kind: 'balance', id: 'a1', account_id: 'a1', name: 'Chase Savings', currency: 'USD', last: '2026-11-06' },
      { kind: 'holdings', id: 'p1', account_id: 'a2', name: 'Fidelity', currency: 'USD', last: '2026-11-06' },
    ],
  },
}

const metrics = { milestones: [], buckets: [] } as unknown as Metrics

vi.mock('../hooks/queries', () => ({
  useDashboard: () => ({ data: dashboard, isLoading: false, error: null }),
  useMetrics: () => ({ data: metrics }),
  useBuckets: () => ({ data: [{ ...growth }, { ...emergency }, { ...cash }] }),
}))
vi.mock('../components/BucketSplitModal', () => ({ BucketSplitModal: () => null }))

function renderPage() {
  render(
    <MemoryRouter>
      <DashboardPage />
    </MemoryRouter>,
  )
}

test('tiles, attention lines, top tables and the check-in accordion', async () => {
  renderPage()
  expect(screen.getByText('Net worth · USD')).toBeInTheDocument()
  expect(screen.getByText('$794,608')).toBeInTheDocument()
  expect(screen.getByText('17')).toBeInTheDocument()
  expect(screen.getByText('10 USD · 7 INR')).toBeInTheDocument()
  expect(screen.getByText(/Cash is \$29\.6K over target; Emergency is \$56\.5K short\./)).toBeInTheDocument()
  expect(screen.getByText('MSFT is 42% of Growth.')).toBeInTheDocument()
  expect(screen.getByText('−35%')).toBeInTheDocument()

  expect(screen.queryByRole('link', { name: /Fidelity/ })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: /Check-in/ }))
  expect(screen.getByRole('link', { name: /Fidelity/ })).toHaveAttribute('href', '/portfolios/p1/snapshots/new')
  expect(screen.getByText('1 USD balance')).toBeInTheDocument()
})

test('life map spans a working lifetime past the last milestone', () => {
  expect(lifeSpan('2026-11-08', [{ target_date: '2030-04-30' }]).years).toEqual([2026, 2030, 2035, 2040, 2045, 2050, 2055, 2060])
  expect(lifeSpan('2026-11-08', [{ target_date: '2058-01-01' }]).years.at(-1)).toBe(2070)
})
