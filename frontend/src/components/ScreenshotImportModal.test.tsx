import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ScreenshotImportModal } from './ScreenshotImportModal'
import { ndjsonParser } from '../lib/screenshotImport'
import type { ScreenshotEvent, ScreenshotResult, ScreenshotRow } from '../types/api'

const row = (over: Partial<ScreenshotRow>): ScreenshotRow => ({
  id: 'h1',
  symbol: 'INFY',
  symbol_basis: 'shown',
  name: 'Infosys',
  asset_class: 'stock',
  quantity: '10',
  buy_price: '1500',
  current_price: '1610.1',
  value: '16101',
  printed: { quantity: '10', buy_price: '1,500.00', current_price: '1,610.10', value: '16,101.00', invested: null },
  derived: [],
  rechecked: [],
  issues: [],
  ...over,
})

const result: ScreenshotResult = {
  rows: [
    row({}),
    row({
      id: 'h2',
      symbol: 'TCS',
      name: 'Tata Consultancy',
      quantity: null,
      current_price: '4120.5',
      issues: [
        { level: 'error', field: 'quantity', message: 'Needs a quantity greater than 0' },
        { level: 'warn', field: 'value', message: '2 × 4,120.5 = 8,241, but the screenshot shows 8,421' },
      ],
    }),
  ],
  checks: [{ kind: 'total', status: 'warn', message: 'Holdings add up to 16,101, but the screenshots’ total is 24,522' }],
  currency_seen: 'INR',
  as_of_seen: '2026-11-04',
  notes: [],
  recheck: 'Re-read: the screenshots say the same',
  screenshots: 1,
  model: 'test/model',
  cost_usd: 0.031,
}

function streamOf(events: ScreenshotEvent[]): Response {
  const text = events.map((e) => JSON.stringify(e)).join('\n') + '\n'
  const bytes = new TextEncoder().encode(text)
  const body = new ReadableStream({
    start(c) {
      // Split mid-line to prove the parser copes with chunk boundaries.
      c.enqueue(bytes.slice(0, 25))
      c.enqueue(bytes.slice(25))
      c.close()
    },
  })
  return new Response(body, { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } })
}

beforeEach(() => {
  URL.createObjectURL = vi.fn(() => 'blob:preview')
  URL.revokeObjectURL = vi.fn()
})
afterEach(() => vi.unstubAllGlobals())

describe('ndjsonParser', () => {
  it('joins lines split across chunks and skips junk', () => {
    const seen: ScreenshotEvent[] = []
    const feed = ndjsonParser((e) => seen.push(e))
    feed('{"type":"stage","stage":"rea')
    feed('ding","text":"Reading"}\nnot json\n{"type":"error",')
    feed('"message":"x"}', true)
    expect(seen).toEqual([
      { type: 'stage', stage: 'reading', text: 'Reading' },
      { type: 'error', message: 'x' },
    ])
  })
})

describe('ScreenshotImportModal', () => {
  it('reads screenshots, makes the person fix errors and confirm warnings, then hands over the rows', async () => {
    const user = userEvent.setup({ applyAccept: false })
    const fetchMock = vi.fn(async () =>
      streamOf([
        { type: 'stage', stage: 'reading', text: 'Reading 1 screenshot…' },
        { type: 'stage', stage: 'checking', text: 'Checking the numbers…' },
        { type: 'result', result },
      ]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const onAccept = vi.fn()
    render(<ScreenshotImportModal open onOpenChange={() => {}} portfolioId="p1" currency="INR" asOf="2026-11-05" onAccept={onAccept} />)

    // Only images are taken.
    const input = screen.getByTestId('screenshot-input')
    await user.upload(input, new File(['%PDF'], 'statement.pdf', { type: 'application/pdf' }))
    expect(screen.getByRole('alert')).toHaveTextContent("statement.pdf isn't a PNG, JPEG or WebP image")
    await user.upload(input, new File(['png'], 'kite.png', { type: 'image/png' }))
    expect(screen.getByAltText('Screenshot 1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Read 1 screenshot' }))
    await screen.findByText(/Holdings add up to/)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/portfolios/p1/snapshots/screenshot')
    expect((init.body as FormData).getAll('files')).toHaveLength(1)
    expect((init.body as FormData).get('as_of')).toBe('2026-11-05')

    const use = screen.getByRole('button', { name: 'Use 2 holdings' })
    expect(use).toBeDisabled() // TCS has no quantity, and there are warnings
    expect(screen.getByText(/fix 1 row to continue/)).toBeInTheDocument()

    const quantities = screen.getAllByLabelText('Quantity')
    await user.type(quantities[1], '2')
    expect(use).toBeDisabled() // warnings not yet acknowledged
    await user.click(screen.getByLabelText(/I've checked the 2 warnings/))
    expect(use).toBeEnabled()

    // The screenshot's date is offered, and taken by default.
    expect(screen.getByLabelText(/Use 4 Nov 2026|Use Nov 4, 2026|the date in the screenshots/)).toBeChecked()

    await user.click(use)
    expect(onAccept).toHaveBeenCalledWith(
      [
        { symbol: 'INFY', name: 'Infosys', asset_class: 'stock', quantity: '10', buy_price: '1500', current_price: '1610.1' },
        { symbol: 'TCS', name: 'Tata Consultancy', asset_class: 'stock', quantity: '2', buy_price: '1500', current_price: '4120.5' },
      ],
      '2026-11-04',
    )
  })

  it('shows the server’s error and stays on the picker', async () => {
    const user = userEvent.setup()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ detail: 'At most 4 screenshots at a time' }), { status: 422, headers: { 'Content-Type': 'application/json' } })),
    )
    render(<ScreenshotImportModal open onOpenChange={() => {}} portfolioId="p1" currency="USD" asOf="2026-11-05" onAccept={vi.fn()} />)
    await user.upload(screen.getByTestId('screenshot-input'), new File(['png'], 'a.png', { type: 'image/png' }))
    await user.click(screen.getByRole('button', { name: 'Read 1 screenshot' }))
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('At most 4 screenshots at a time'))
    expect(screen.getByRole('button', { name: 'Read 1 screenshot' })).toBeEnabled()
  })

  it('reads screenshots handed over from Add portfolio straight away', async () => {
    const fetchMock = vi.fn(async () => streamOf([{ type: 'result', result }]))
    vi.stubGlobal('fetch', fetchMock)
    const files = [new File(['png'], 'kite.png', { type: 'image/png' })]
    render(<ScreenshotImportModal open onOpenChange={() => {}} portfolioId="p9" currency="INR" asOf="2026-11-05" onAccept={vi.fn()} initialFiles={files} />)
    await screen.findByText(/Holdings add up to/)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect((fetchMock.mock.calls[0] as unknown as [string])[0]).toBe('/api/portfolios/p9/snapshots/screenshot')
  })
})
