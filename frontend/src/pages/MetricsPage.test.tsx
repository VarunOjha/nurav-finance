import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MilestoneSection } from './MetricsPage'
import type { MilestoneView, TargetRow } from '../types/api'

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

vi.mock('../hooks/queries', () => ({}))
vi.mock('../context/WorkspaceContext', () => ({ useWorkspace: () => ({ workspace: { id: 'w1', name: 'Personal' } }) }))

const trajectory = { months: ['2026-10', '2026-11'], actual: ['500000', '562774'], required: [null, '563000'], projection_pace: [null, null], projection_return: [null, '562774'] }

const row = (id: string, bucket: string, color: number, patch: Partial<TargetRow>): TargetRow => ({
  id,
  milestone_id: 'm1',
  milestone_name: '2029',
  target_date: '2029-12-31',
  start_date: '2026-11-07',
  bucket: { id: bucket.toLowerCase(), name: bucket, color },
  currency: 'USD',
  amount: '1000000',
  expected_return: null,
  status: 'open',
  current: '562774',
  progress_pct: '56.28',
  gap: '437226',
  months_left: '37.7',
  need_flat: '11582.29',
  need_with_return: null,
  required_now: '563110',
  standing: 'on_track',
  projected_pace_date: null,
  projected_return_date: null,
  value_on_date: null,
  pace_3m: null,
  pace_6m: null,
  pace_12m: null,
  trajectory,
  ...patch,
})

const growth = row('r1', 'Growth', 0, { expected_return: '8', need_with_return: '6648.74' })
const rivian = row('r2', 'Rivian', 3, { amount: '90000', current: '10000', progress_pct: '11.1', gap: '80000', need_flat: '2119', standing: 'behind', required_now: '20000' })

const milestone: MilestoneView = {
  id: 'm1',
  name: '2029',
  target_date: '2029-12-31',
  start_date: '2026-11-07',
  note: 'Before the move',
  past: false,
  months_left: '37.7',
  totals: [{ currency: 'USD', current: '572774', amount: '1090000', progress_pct: '52.55', need: '8767.74', need_flat: '13701.29' }],
  rows: [growth, rivian],
}

describe('Metrics by milestone', () => {
  it('sums up the milestone in its header and opens a bucket row into its details', async () => {
    const onEdit = vi.fn()
    const user = userEvent.setup()
    render(<MilestoneSection view={milestone} defaultOpen onEdit={onEdit} />)

    const section = screen.getByRole('region', { name: 'Milestone 2029' })
    const header = within(section).getByRole('button', { name: /2029/, expanded: true })
    // Only: time left and, per currency, the target (up to 3 decimals) and percent done.
    expect(header).toHaveTextContent('3 years 2 months left')
    expect(header).toHaveTextContent('USD$1.09M52.5%')
    expect(header).not.toHaveTextContent('$572.774K')
    expect(header).not.toHaveTextContent('/mo')
    expect(header).not.toHaveTextContent('Behind')
    expect(header).not.toHaveTextContent('on track')
    expect(header).not.toHaveTextContent('Before the move')

    // Rows: Growth needs $6.6K/mo at 8%; Rivian is behind.
    const growthRow = screen.getByRole('button', { name: /Growth · USD: show/ })
    expect(growthRow).toHaveTextContent('$562.8K / $1M 56.3%')
    expect(growthRow).toHaveTextContent('$6.6K/mo @8%')
    expect(growthRow).toHaveTextContent('On track')
    expect(screen.getByRole('button', { name: /Rivian · USD: show/ })).toHaveTextContent('Behind')

    await user.click(growthRow)
    expect(screen.getByRole('button', { name: /Growth · USD: hide/ })).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Needed at 8%/yr')).toBeInTheDocument()
    expect(screen.getByText('Trajectory · month-end')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit milestone 2029' }))
    expect(onEdit).toHaveBeenCalled()

    // Collapsing hides the rows.
    await user.click(header)
    expect(screen.queryByRole('button', { name: /Growth · USD/ })).not.toBeInTheDocument()
  })

  it('shows the exact amount over (or short of) a target, and over the total instead of a percentage', () => {
    const over = row('p1', 'Growth', 0, { status: 'achieved', standing: null, amount: '400000', value_on_date: '452700', progress_pct: '113.18', required_now: null })
    const short = row('p2', 'Emergency fund', 1, { status: 'missed', standing: null, amount: '40000', value_on_date: '37800', progress_pct: '94.5', required_now: null })
    const past: MilestoneView = {
      ...milestone,
      id: 'p',
      name: '2026 H1',
      target_date: '2026-06-30',
      past: true,
      months_left: null,
      note: null,
      totals: [{ currency: 'USD', current: '490500', amount: '440000', progress_pct: '111.48', need: null, need_flat: null }],
      rows: [over, short],
    }
    render(<MilestoneSection view={past} defaultOpen onEdit={null} />)
    expect(screen.getByRole('button', { name: /2026 H1/, expanded: true })).toHaveTextContent('passed Jun 30, 2026')
    expect(screen.getByRole('button', { name: /2026 H1/, expanded: true })).toHaveTextContent('USD$440K111.5%')
    expect(screen.getByRole('button', { name: /Growth · USD/ })).toHaveTextContent('+$52.7K over')
    expect(screen.getByRole('button', { name: /Emergency fund · USD/ })).toHaveTextContent('short $2.2K')
  })

})
