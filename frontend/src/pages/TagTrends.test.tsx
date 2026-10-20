import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Overview } from '../types/api'
import { TagTrends } from './AnalyticsPage'

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

const tag = (name: string, currencies: string[]) => ({ tag: name, currencies: currencies.map((currency) => ({ currency, values: ['100', '120'] })) })
const names = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet']
const overview = {
  months: ['2026-08', '2026-09'],
  currencies: [],
  tags: names.map((n) => tag(n, n === 'india' ? ['INR'] : ['USD', 'INR'])),
  allocation: { by_type: [], by_asset_class: [], by_tag: [] },
} as unknown as Overview

const chip = (name: string) => within(screen.getByRole('group', { name: 'Tags' })).getByRole('button', { name })

describe('TagTrends filter', () => {
  it('compares several tags, caps at 8 and keeps colours when one is removed', async () => {
    const user = userEvent.setup()
    render(<TagTrends data={overview} />)
    expect(screen.getByText('8 of 10 shown · 8 max')).toBeInTheDocument()
    expect(chip('india')).toBeDisabled()

    const bravoSwatch = chip('bravo').innerHTML
    await user.click(chip('alpha'))
    expect(chip('alpha')).toHaveAttribute('aria-pressed', 'false')
    expect(chip('bravo').innerHTML).toBe(bravoSwatch)

    await user.click(chip('india'))
    expect(chip('india')).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('8 of 10 shown · 8 max')).toBeInTheDocument()
  })

  it('searches tags and filters by currency', async () => {
    const user = userEvent.setup()
    render(<TagTrends data={overview} />)
    await user.type(screen.getByLabelText('Search tags'), 'ch')
    expect(within(screen.getByRole('group', { name: 'Tags' })).getAllByRole('button').map((b) => b.textContent)).toEqual(['charlie', 'echo'])

    await user.click(screen.getByRole('button', { name: 'Clear' }))
    expect(screen.getByText('Pick one or more tags to see their trend.')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Search tags'))
    await user.click(chip('alpha'))
    const cards = () => screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(cards()).toEqual(['Tag trends', 'INR', 'USD'])
    await user.selectOptions(screen.getByLabelText('Filter by currency'), 'INR')
    expect(cards()).toEqual(['Tag trends', 'INR'])
  })
})
