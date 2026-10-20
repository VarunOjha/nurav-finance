import { render, screen, within } from '@testing-library/react'
import type { Overview, TopAsset } from '../types/api'
import { TopAssetsSection } from './AnalyticsPage'

const holding = (symbol: string, value: number, held_in = ['Schwab']): TopAsset => ({ kind: 'holding', name: symbol, symbol, group: 'etf', held_in, value: String(value) })
const account = (name: string, value: number): TopAsset => ({ kind: 'account', name, symbol: null, group: 'savings', held_in: [], value: String(value) })

const assets = [account('Chase', 5000), holding('VTI', 4000, ['Fidelity', 'Schwab']), ...Array.from({ length: 10 }, (_, i) => holding(`S${i}`, 100 - i))]
const overview = { top_assets: [{ currency: 'USD', assets }] } as unknown as Overview

const rows = () => within(screen.getByRole('list', { name: 'Top assets in USD' })).getAllByRole('listitem')

describe('TopAssetsSection', () => {
  it('ranks the top 10 accounts and holdings together with shares', () => {
    render(<TopAssetsSection data={overview} scope="both" columns="" />)
    expect(rows()).toHaveLength(10)
    expect(rows()[0]).toHaveTextContent('Chase')
    expect(rows()[1]).toHaveTextContent('VTI')
    expect(rows()[1]).toHaveTextContent('ETF · Fidelity, Schwab')
    expect(screen.getByText(/top 10 of 12/)).toBeInTheDocument()
  })

  it('follows the scope toggle', () => {
    render(<TopAssetsSection data={overview} scope="accounts" columns="" />)
    expect(rows()).toHaveLength(1)
    expect(rows()[0]).toHaveTextContent('100.0%')
  })
})
