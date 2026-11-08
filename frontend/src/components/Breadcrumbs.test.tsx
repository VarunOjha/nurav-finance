import { crumbsFor } from './Breadcrumbs'
import { pickMovers, spread } from './charts/ShareShift'
import type { Outcome } from './HoldingsTables'

const trail = (path: string) => crumbsFor(path).map((c) => ({ key: c.key, to: c.to }))

describe('crumbsFor', () => {
  it('ends on the current page, which is not a link', () => {
    expect(trail('/accounts')).toEqual([{ key: 'accounts', to: undefined }])
    expect(trail('/accounts/a1')).toEqual([
      { key: 'accounts', to: '/accounts' },
      { key: 'a1', to: undefined },
    ])
  })

  it('walks portfolio → snapshot', () => {
    expect(trail('/portfolios/p1/snapshots/new')).toEqual([
      { key: 'portfolios', to: '/portfolios' },
      { key: 'p1', to: '/portfolios/p1' },
      { key: 'new', to: undefined },
    ])
  })

  it('has nothing for unknown paths', () => {
    expect(trail('/')).toEqual([])
    expect(trail('/login')).toEqual([])
  })
})

describe('spread (slope chart labels)', () => {
  it('keeps labels apart and in order without leaving the box', () => {
    const out = spread([100, 102, 50, 101], 16, 0, 300)
    const sorted = [...out].sort((a, b) => a - b)
    for (let i = 1; i < sorted.length; i++) expect(sorted[i] - sorted[i - 1]).toBeGreaterThanOrEqual(16)
    expect(out[2]).toBe(50) // already clear, untouched
    expect(out[0]).toBeLessThan(out[3]) // order kept
    expect(out[3]).toBeLessThan(out[1])
  })

  it('pushes back up from the bottom edge', () => {
    const out = spread([295, 296, 297], 16, 0, 300)
    expect(Math.max(...out)).toBeLessThanOrEqual(300)
    expect(out).toEqual([268, 284, 300])
  })
})

describe('pickMovers', () => {
  const o = (symbol: string, costShare: number, valueShare: number) => ({ holding: { symbol }, costShare, valueShare }) as unknown as Outcome
  it('keeps the biggest gainers and shrinkers of weight, and folds the rest', () => {
    const rows = [o('A', 0.1, 0.2), o('B', 0.1, 0.12), o('C', 0.1, 0.15), o('D', 0.2, 0.1), o('E', 0.2, 0.19), o('F', 0.3, 0.24)]
    const { grew, shrank, rest } = pickMovers(rows, 2)
    expect(grew.map((r) => r.holding.symbol)).toEqual(['A', 'C'])
    expect(shrank.map((r) => r.holding.symbol)).toEqual(['D', 'F'])
    expect(rest.map((r) => r.holding.symbol)).toEqual(['B', 'E'])
  })
})
