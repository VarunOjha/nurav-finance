import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BucketSplitModal } from './BucketSplitModal'
import type { AccountSplits, Bucket } from '../types/api'

const createSplit = vi.fn(async () => ({}))
let splits: AccountSplits

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

vi.mock('../hooks/queries', () => ({
  useAccountSplits: () => ({ data: splits, isLoading: false }),
  useBuckets: () => ({ data: buckets }),
  useSplitMutations: () => ({ create: { mutateAsync: createSplit, isPending: false }, remove: { mutateAsync: vi.fn(), isPending: false } }),
}))

const account = { id: 'a1', name: 'Chase Brokerage', currency: 'USD' }
const save = () => screen.getByRole('button', { name: 'Save split' })

describe('BucketSplitModal', () => {
  beforeEach(() => createSplit.mockClear())

  it('first split: covers all history, must add up to exactly 100%', async () => {
    splits = { account_id: 'a1', currency: 'USD', value: '50000', current: null, history: [] }
    const user = userEvent.setup()
    render(<BucketSplitModal account={account} onOpenChange={() => {}} />)

    expect(screen.getByText(/All history — this is the account's first split/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Effective from')).not.toBeInTheDocument()
    expect(save()).toBeDisabled()
    // Archived buckets can't be picked.
    expect(screen.queryByRole('option', { name: 'Old car' })).not.toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Add bucket'), 'g')
    expect(screen.getByLabelText('Percent for Growth')).toHaveValue('100') // a new line takes what's left
    expect(screen.getByText('100% allocated ✓')).toBeInTheDocument()
    expect(screen.getByText('$50,000.00')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Add bucket'), 'e')
    await user.type(screen.getByLabelText('Percent for Emergency fund'), '15')
    expect(screen.getByText('Over by 15%')).toBeInTheDocument()
    expect(save()).toBeDisabled()

    await user.clear(screen.getByLabelText('Percent for Growth'))
    await user.type(screen.getByLabelText('Percent for Growth'), '80')
    expect(screen.getByText('5% still to allocate')).toBeInTheDocument()
    await user.click(screen.getAllByRole('button', { name: '+rest' })[0])
    expect(screen.getByText('100% allocated ✓')).toBeInTheDocument()

    await user.click(save())
    expect(createSplit).toHaveBeenCalledWith({
      accountId: 'a1',
      body: {
        effective_from: null,
        lines: [
          { bucket_id: 'g', percent: '85' },
          { bucket_id: 'e', percent: '15' },
        ],
      },
    })
  })

  it('later changes start from the split in force and take a date', async () => {
    splits = {
      account_id: 'a1',
      currency: 'USD',
      value: '1000',
      current: {
        id: 's1',
        effective_from: null,
        covers_history: true,
        until: null,
        note: null,
        recorded_at: '2026-01-01T00:00:00Z',
        lines: [{ bucket_id: 'g', name: 'Growth', color: 0, archived: false, percent: '100.0000', value: '1000' }],
      },
      history: [],
    }
    splits.history = [splits.current!]
    const user = userEvent.setup()
    render(<BucketSplitModal account={account} onOpenChange={() => {}} />)

    expect(screen.getByLabelText('Percent for Growth')).toHaveValue('100')
    expect(screen.getByLabelText('Effective from')).toBeInTheDocument()
    expect(screen.getByText(/All history → now/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Remove Growth' }))
    expect(screen.getByText('Add a bucket to start')).toBeInTheDocument()
    expect(save()).toBeDisabled()
  })
})
