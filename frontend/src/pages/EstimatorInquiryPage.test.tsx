import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import EstimatorInquiryPage from './EstimatorInquiryPage'
import type { InquiryDetail, InquiryScenario } from '../types/api'

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const scenario = (year: number | null, age: number | null, ret: number, extra: Partial<InquiryScenario> = {}): InquiryScenario => ({
  return_pct: ret,
  return_rebalanced_pct: ret + 0.4,
  real_growth_pct: ((1 + ret / 100) / 1.025 - 1) * 100,
  preserved: ret > 6,
  surplus_pct: ((1 + ret / 100) / 1.025 - 1) * 100 - 3.5,
  lasts_years: ret > 6 ? null : 61.6,
  fi_today: 2742857,
  fi_nominal: 5560000,
  years: 28.6,
  fi_date: year ? `${year}-06-01` : null,
  fi_year: year,
  fi_age: age,
  rebalanced_years: 26.4,
  rebalanced_year: year ? year - 2 : null,
  progress: 0.28,
  curve: [
    { year: 2026, as_is: 760800, rebalanced: 760800 },
    { year: 2027, as_is: 795000, rebalanced: 798000 },
  ],
  rebalance: [{ key: 'USD:stock:MSFT', label: 'MSFT', now_pct: 31.3, target_pct: 10, move: -162000 }],
  milestones: [
    { year: 2030, focus: 'Trim MSFT to 10%', amount: 1004700, fi: false },
    ...(year ? [{ year, focus: 'FI', amount: 5560000, fi: true }] : []),
  ],
  change_years: [-2, null],
  risk_years: [3],
  ...extra,
})

const inquiry: InquiryDetail = {
  id: 'i1',
  created_at: '2026-11-08T15:00:00Z',
  monthly_expenses: '8000',
  currency: 'USD',
  model: 'anthropic/claude-sonnet-5.5',
  cost: '0.04',
  previous: null,
  result: {
    currency: 'USD',
    today: '2026-11-08',
    withdrawal_rate_pct: 3.5,
    monthly_expenses: 8000,
    age: 34,
    pool: 760800,
    pool_by_currency: [],
    inflation: [{ currency: 'USD', rate_pct: 2.5, period: '1995–2024', index: 'US CPI-U' }],
    expense_inflation_pct: 2.5,
    fx: [{ currency: 'INR', value_in_expense_currency: 1 / 88, drift_pct: -3 }],
    scenarios: {
      conservative: scenario(null, null, 5.8),
      balanced: scenario(2055, 63, 7.2),
      aggressive: scenario(2046, 54, 8.6, { rebalance: [{ key: 'USD:stock:MSFT', label: 'MSFT', now_pct: 31.3, target_pct: 20, move: -86000 }] }),
    },
    structure: { overall: 6, diversification: 3, liquidity: 9, growth_mix: 6, currency_spread: 5 },
    keep: ['Cash covers 14 months'],
    changes: [
      { title: 'Cap MSFT at 10%', detail: 'Now 31%', effect: { kind: 'return_pct', value: 0.4 }, label: null },
      { title: 'Split deposits over ₹5L', detail: 'SBI', effect: { kind: 'none', value: 0 }, label: 'Safety' },
    ],
    risks: [{ severity: 'high', title: 'Single stock', detail: 'MSFT 31%', stress: { kind: 'pool_pct', value: -15 }, label: '−50% MSFT' }],
    excluded: [{ name: '2821 Turpin House', currency: 'USD', value: 115000, reason: 'fixed' }],
  },
}

vi.mock('../hooks/queries', () => ({
  useInquiry: () => ({ data: inquiry, isLoading: false, error: null }),
  useInquiryMutations: () => ({ remove: { mutate: vi.fn(), isPending: false, error: null } }),
}))

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/estimator/i1']}>
      <Routes>
        <Route path="/estimator/:inquiryId" element={<EstimatorInquiryPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('EstimatorInquiryPage', () => {
  it('opens on balanced and switches every section with the scenario', async () => {
    renderPage()
    const picker = screen.getByRole('group', { name: 'Scenario' })
    const balanced = within(picker).getByRole('button', { name: /Balanced/ })
    expect(balanced).toHaveAttribute('aria-pressed', 'true')
    expect(within(picker).getByRole('button', { name: /Conservative/ })).toHaveTextContent('60+ yrs')
    expect(within(picker).getByRole('button', { name: /Conservative/ })).toHaveTextContent('Runs out after 62 yrs')
    expect(balanced).toHaveTextContent('Never runs out · income +1.2%/yr')
    expect(screen.getByText('Rebalance · Balanced')).toBeInTheDocument()
    expect(screen.getByText('10%')).toBeInTheDocument()

    await userEvent.click(within(picker).getByRole('button', { name: /Aggressive/ }))
    expect(screen.getByText('Rebalance · Aggressive')).toBeInTheDocument()
    expect(screen.getByText('20%')).toBeInTheDocument()
    expect(screen.getByText('Milestones · Aggressive')).toBeInTheDocument()
  })

  it('shows years per change and risk, labels for safety items, and what was left out', () => {
    renderPage()
    expect(screen.getByText('−2 yrs')).toBeInTheDocument()
    expect(screen.getByText('Safety')).toBeInTheDocument()
    expect(screen.getByText('−50% MSFT · +3 yrs')).toBeInTheDocument()
    expect(screen.getByText('1 USD = 88.0 INR · −3% / yr')).toBeInTheDocument()
    expect(screen.getByText(/2821 Turpin House/)).toBeInTheDocument()
  })

  it('shows the gap and what saving each month does', async () => {
    renderPage()
    expect(screen.getByText('Retire earlier · Balanced')).toBeInTheDocument()
    expect(screen.getByText('$1.98M')).toBeInTheDocument() // $2,742,857 − $760,800
    await userEvent.type(screen.getByLabelText('Save / month'), '4000')
    expect(screen.getByText(/^Retire 20\d\d · age \d+$/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Retire by'), '2041')
    expect(screen.getByText(/^Save \$[\d,]+ \/ mo$/)).toBeInTheDocument()
  })

  it('shows income after retiring every 3 years for 30, in today’s and that year’s money', () => {
    renderPage()
    const title = screen.getByText(/^After retiring · Balanced · 3.5% a year$/)
    const table = title.closest('section')!.querySelector('table')!
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(11)
    expect(rows[0]).toHaveTextContent('2055')
    expect(rows[0]).toHaveTextContent('$8,000') // 3.5% of the $2.74M target, monthly
    expect(rows[0]).toHaveTextContent('$16,217') // 3.5% of $5.56M in 2055 dollars
    expect(rows[10]).toHaveTextContent('2085')
  })
})
