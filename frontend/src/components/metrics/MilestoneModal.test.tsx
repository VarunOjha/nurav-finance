import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MilestoneModal, yearEnd } from './MilestoneModal'
import type { Bucket, Milestone } from '../../types/api'

const create = vi.fn(async () => ({}))
const update = vi.fn(async () => ({}))

const bucket = (id: string, name: string, color: number, archived = false): Bucket => ({
  id,
  name,
  description: null,
  color,
  position: color,
  archived,
  created_at: '2026-11-07T00:00:00Z',
  current_accounts: [],
  used: false,
  milestone_count: 0,
})
const buckets = [bucket('g', 'Growth', 0), bucket('e', 'Emergency fund', 1), bucket('x', 'Old car', 2, true)]

vi.mock('../../hooks/queries', () => ({
  useBuckets: () => ({ data: buckets }),
  useAccounts: () => ({ data: [{ currency: 'INR' }, { currency: 'USD' }, { currency: 'USD' }] }),
  useOverview: () => ({ data: { buckets: { currencies: [{ currency: 'USD', rows: [{ bucket_id: 'g', current: '562774.39' }] }] } } }),
  useMilestoneMutations: () => ({
    create: { mutateAsync: create, isPending: false },
    update: { mutateAsync: update, isPending: false },
    remove: { mutateAsync: vi.fn(), isPending: false },
  }),
}))

const save = () => screen.getByRole('button', { name: 'Save milestone' })

describe('MilestoneModal', () => {
  beforeEach(() => {
    create.mockClear()
    update.mockClear()
  })

  it('a year as the name fills the date; one line per bucket + currency; saves the whole milestone', async () => {
    const user = userEvent.setup()
    render(<MilestoneModal open milestone={null} onClose={() => {}} />)

    expect(save()).toBeDisabled()
    await user.type(screen.getByLabelText('Name'), '2030')
    expect(screen.getByLabelText('Date')).toHaveValue('2030-12-31')
    expect(screen.getByText('Dec 31 of the year in the name')).toBeInTheDocument()

    // Starts with one line (first bucket, the most-used currency); shows today's value.
    expect(screen.getByLabelText('Bucket for line Growth')).toHaveValue('g')
    expect(screen.getByText('now $562,774.39')).toBeInTheDocument()
    // Archived buckets can't be picked.
    expect(screen.queryByRole('option', { name: 'Old car (archived)' })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Target balance for Growth'), '1000000')
    await user.type(screen.getByLabelText('Expected return for Growth'), '8')

    // A second line picks the next unused bucket; switching it to Growth too is flagged.
    await user.click(screen.getByRole('button', { name: 'Add bucket' }))
    expect(screen.getByLabelText('Bucket for line Emergency fund')).toHaveValue('e')
    expect(screen.getByText('nothing in USD yet')).toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Bucket for line Emergency fund'), 'g')
    expect(screen.getAllByText('Growth · USD is here twice')).toHaveLength(2)
    expect(save()).toBeDisabled()
    await user.click(screen.getAllByRole('button', { name: 'Remove Growth' })[1])

    await user.click(save())
    expect(create).toHaveBeenCalledWith({
      name: '2030',
      target_date: '2030-12-31',
      start_date: expect.any(String),
      note: null,
      lines: [{ bucket_id: 'g', currency: 'USD', amount: '1000000', expected_return: '8' }],
    })
  })

  it('editing keeps archived lines (locked) and replaces the lines on save', async () => {
    const milestone: Milestone = {
      id: 'm1',
      name: '2029',
      target_date: '2029-12-31',
      start_date: '2026-11-07',
      note: null,
      created_at: '2026-11-07T00:00:00Z',
      lines: [
        { id: 'l1', bucket_id: 'g', bucket_name: 'Growth', color: 0, archived: false, currency: 'USD', amount: '1000000.0000', expected_return: '8.000' },
        { id: 'l2', bucket_id: 'x', bucket_name: 'Old car', color: 2, archived: true, currency: 'USD', amount: '20000.0000', expected_return: null },
      ],
    }
    const user = userEvent.setup()
    render(<MilestoneModal open milestone={milestone} onClose={() => {}} />)
    expect(screen.getByLabelText('Name')).toHaveValue('2029')
    expect(screen.getByLabelText('Bucket for line Old car')).toBeDisabled()
    expect(screen.getByText(/Archived: kept here, left out of the numbers/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete milestone' })).toBeInTheDocument()

    await user.clear(screen.getByLabelText('Target balance for Growth'))
    await user.type(screen.getByLabelText('Target balance for Growth'), '1200000')
    await user.click(save())
    expect(update).toHaveBeenCalledWith({
      id: 'm1',
      body: {
        name: '2029',
        target_date: '2029-12-31',
        start_date: '2026-11-07',
        note: null,
        lines: [
          { bucket_id: 'g', currency: 'USD', amount: '1200000', expected_return: '8' },
          { bucket_id: 'x', currency: 'USD', amount: '20000', expected_return: null },
        ],
      },
    })
  })

  it('copying a milestone opens a new one prefilled from it, ready to tweak', async () => {
    const source: Milestone = {
      id: 'm1',
      name: '2030',
      target_date: '2030-12-31',
      start_date: '2026-11-07',
      note: 'Before the move',
      created_at: '2026-11-07T00:00:00Z',
      lines: [
        { id: 'l1', bucket_id: 'g', bucket_name: 'Growth', color: 0, archived: false, currency: 'USD', amount: '1000000.0000', expected_return: '8.000' },
        { id: 'l2', bucket_id: 'x', bucket_name: 'Old car', color: 2, archived: true, currency: 'USD', amount: '20000.0000', expected_return: null },
      ],
    }
    const user = userEvent.setup()
    render(<MilestoneModal open milestone={null} copyFrom={source} onClose={() => {}} />)
    expect(screen.getByRole('dialog', { name: /New milestone · copy of 2030/ })).toBeInTheDocument()
    expect(screen.getByLabelText('Name')).toHaveValue('2030 copy')
    expect(screen.queryByRole('button', { name: /Delete/ })).not.toBeInTheDocument()
    // The archived bucket isn't carried over (it can't go in a new milestone).
    expect(screen.queryByLabelText('Bucket for line Old car')).not.toBeInTheDocument()

    // Renaming it to another year moves the date with it; then tweak an amount.
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), '2035')
    expect(screen.getByLabelText('Date')).toHaveValue('2035-12-31')
    await user.clear(screen.getByLabelText('Target balance for Growth'))
    await user.type(screen.getByLabelText('Target balance for Growth'), '2500000')
    await user.click(save())
    expect(update).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledWith({
      name: '2035',
      target_date: '2035-12-31',
      start_date: expect.any(String),
      note: 'Before the move',
      lines: [{ bucket_id: 'g', currency: 'USD', amount: '2500000', expected_return: '8' }],
    })
  })

  it('only fills the date from a year-like name', () => {
    expect(yearEnd('2035')).toBe('2035-12-31')
    expect(yearEnd(' 2040 ')).toBe('2040-12-31')
    expect(yearEnd('Rivian')).toBeNull()
    expect(yearEnd('20301')).toBeNull()
  })
})
