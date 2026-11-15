import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { BucketAnalytics } from './BucketAnalytics'
import type { BucketRow, Overview } from '../types/api'

// recharts' ResponsiveContainer measures itself; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const row = (bucket_id: string | null, values: (string | null)[], extra: Partial<BucketRow> = {}): BucketRow => ({
  bucket_id,
  values,
  current: values[values.length - 1],
  share: '0.5',
  change_1m: '0',
  pace_3m: null,
  pace_6m: '100',
  pace_12m: null,
  growth_pct: null,
  sources: [],
  ...extra,
})

const overview = {
  months: ['2024-03', '2024-04'],
  buckets: {
    buckets: [
      { id: 'g', name: 'Growth', color: 0, archived: false },
      { id: 'r', name: 'Rivian', color: 3, archived: true },
    ],
    currencies: [
      {
        currency: 'USD',
        rows: [
          row('g', ['900', '950'], {
            sources: [
              { account_id: 'a1', name: 'Chase', percent: '85.0000', value: '850' },
              { account_id: 'a2', name: 'Schwab', percent: '50.0000', value: '100' },
            ],
          }),
          row('r', ['100', null]),
          row(null, ['40', '40']),
        ],
      },
    ],
  },
} as unknown as Overview

describe('BucketAnalytics', () => {
  it('lists buckets (archived and Unassigned included) and expands into the accounts feeding them', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <BucketAnalytics data={overview} />
      </MemoryRouter>,
    )
    const table = screen.getByRole('table')
    const names = within(table)
      .getAllByRole('button', { expanded: false })
      .map((b) => b.textContent)
    expect(names).toEqual(['Growth', 'Rivianarchived', 'Unassigned'])
    expect(within(table).getByText('Unassigned')).toBeInTheDocument()
    expect(within(table).getByText('archived')).toBeInTheDocument()

    expect(screen.queryByRole('link', { name: 'Chase' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Growth: show the accounts/ }))
    expect(screen.getByRole('link', { name: 'Chase' })).toHaveAttribute('href', '/accounts/a1')
    expect(screen.getByText('$850.00')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Growth: hide the accounts/ })).toHaveAttribute('aria-expanded', 'true')
  })
})
