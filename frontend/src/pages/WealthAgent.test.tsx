import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import fixture from '../test/wealthVersion.json'
import type { AgentEvent, WealthVersion } from '../types/api'
import WealthAgentPage from './WealthAgentPage'

const version = fixture.version as unknown as WealthVersion
const save = vi.fn()
const stream = vi.fn()

vi.mock('../context/TenantContext', () => ({ useTenant: () => ({ tenantId: 't1', tenant: { id: 't1', name: 'Self' } }) }))
vi.mock('../hooks/queries', () => ({
  useAgentStatus: () => ({ data: { enabled: true, fake: false, model: 'anthropic/claude-sonnet-4.6', stt_model: 'w', cap_usd: 5, spent_today_usd: 0.42 } }),
  useWealthPlans: () => ({ data: [], isLoading: false }),
  useAgentSnapshot: () => ({ data: undefined, isLoading: false }),
  useWealthMutations: () => ({ save: { mutate: save, isPending: false, error: null, reset: () => {} } }),
}))
vi.mock('../lib/agentStream', () => ({
  AgentRequestError: class extends Error {},
  streamAgent: (path: string, body: unknown, onEvent: (e: AgentEvent) => void) => stream(path, body, onEvent),
}))

const say = (events: AgentEvent[]) =>
  stream.mockImplementationOnce(async (_p: string, _b: unknown, onEvent: (e: AgentEvent) => void) => {
    for (const e of events) onEvent(e)
  })

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {}
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver
})

function setup() {
  const qc = new QueryClient()
  render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <WealthAgentPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )
  return userEvent.setup()
}

describe('Wealth Agent', () => {
  it('goes from a goal to an approved, reported and saved version', async () => {
    const user = setup()
    expect(screen.getByRole('heading', { name: 'What should your money do for you?' })).toBeInTheDocument()
    expect(screen.getByText(/\$0\.42 of \$5\.00 daily cap/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Balanced' }))
    say([
      { type: 'aliases', map: fixture.aliases },
      { type: 'text', delta: 'Which is flexible: **when you get there**, or the return you need?' },
      { type: 'done', messages: [{ role: 'user', content: 'x' }, { role: 'assistant', content: 'y' }] },
    ])
    await user.type(screen.getByLabelText('Your goal'), 'I want $5M in 30 years at 8%')
    await user.click(screen.getByRole('button', { name: 'Start planning' }))
    expect(stream.mock.calls[0][0]).toBe('/agent/turn')
    expect(stream.mock.calls[0][1]).toMatchObject({ text: 'I want $5M in 30 years at 8%', messages: [], prefs: { risk_appetite: 'balanced', solve_for: null } })
    expect(await screen.findByText('when you get there')).toBeInTheDocument()

    say([
      { type: 'draft', draft: version.draft },
      { type: 'text', delta: 'Press Approve & run when it looks right.' },
      { type: 'done', messages: [] },
    ])
    await user.type(screen.getByLabelText('Message the agent'), 'The time{Enter}')
    // The second turn sends back the conversation so far.
    expect(stream.mock.calls[1][1]).toMatchObject({ text: 'The time', messages: [{ role: 'user' }, { role: 'assistant' }] })
    const card = await screen.findByRole('region', { name: 'Draft d1 parameters' })
    expect(within(card).getByText('Chase Savings, Fidelity 401k')).toBeInTheDocument() // real names, not aliases
    expect(within(card).getByText(/USD pot/)).toBeInTheDocument()
    expect(within(card).getByText(/INR pot/)).toBeInTheDocument()
    expect(within(card).getByText(/above the 7–9% range for Growth/)).toBeInTheDocument()

    say([
      { type: 'version', version: { ...version, narrative: null } },
      { type: 'report', n: 1, narrative: version.narrative! },
      { type: 'done', messages: [] },
    ])
    await user.click(within(card).getByRole('button', { name: 'Approve & run' }))
    expect(stream.mock.calls[2][0]).toBe('/agent/approve')
    expect(stream.mock.calls[2][1]).toMatchObject({ draft: { id: 'd1', sig: version.draft.sig } })

    const report = screen.getByRole('region', { name: 'Report' })
    expect(await within(report).findByRole('tab', { name: 'v1' })).toBeInTheDocument()
    const f = version.figures
    expect(within(report).getByText(`On these assumptions you reach ${f['target:USD']} by ${f['fi_date:USD']}; you end with ${f['final:INR']}.`)).toBeInTheDocument()
    expect(within(report).getByText('Fidelity 401k does most of the work.')).toBeInTheDocument()
    const usd = within(report).getByRole('region', { name: 'USD pot' })
    expect(within(usd).getByText('Reach $5M')).toBeInTheDocument()
    expect(within(usd).getByText(/The contribution gets you there .* sooner/)).toBeInTheDocument()
    const inr = within(report).getByRole('region', { name: 'INR pot' })
    expect(within(inr).getByRole('cell', { name: 'Cash' })).toBeInTheDocument()
    expect(screen.getByText('Approved · ran as v1')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'What if I add more each year?' })).toBeInTheDocument()

    await user.click(within(report).getByRole('button', { name: 'Approve & save v1' }))
    expect(screen.getByLabelText('Plan name')).toHaveValue('$5M and a ₹10Cr split')
    await user.click(screen.getByRole('button', { name: 'Save plan' }))
    await waitFor(() => expect(save).toHaveBeenCalled())
    expect(save.mock.calls[0][0]).toMatchObject({ name: '$5M and a ₹10Cr split', draft: { id: 'd1' }, narrative: { headline: version.narrative!.headline } })
  })

  it('shows errors from the stream in the chat', async () => {
    const user = setup()
    say([
      { type: 'error', message: 'Today’s Wealth Agent limit ($5.00) is reached for this tenant.' },
      { type: 'done', messages: [] },
    ])
    await user.click(screen.getByRole('button', { name: /What return do I need/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('limit ($5.00) is reached')
  })
})
