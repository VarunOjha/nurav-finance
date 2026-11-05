import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import type { Workspace } from '../types/api'

const workspaces: Workspace[] = [
  { id: 't1', name: 'Personal', description: null, is_default: true, created_at: '2026-10-11T00:00:00Z', account_count: 9, portfolio_count: 4 },
  { id: 't2', name: 'Parents', description: null, is_default: false, created_at: '2026-10-11T00:00:00Z', account_count: 3, portfolio_count: 1 },
]
const selectWorkspace = vi.fn()

vi.mock('../context/WorkspaceContext', () => ({
  useWorkspace: () => ({ workspaces, workspace: workspaces[0], workspaceId: 't1', selectWorkspace, isLoading: false }),
}))

describe('WorkspaceSwitcher', () => {
  it('shows the selected workspace and switches to another', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <WorkspaceSwitcher />
      </MemoryRouter>,
    )
    const trigger = screen.getByRole('button', { name: /Workspace: Personal/ })
    expect(trigger).toHaveTextContent('Personal')

    await user.click(trigger)
    expect(screen.getByRole('listbox', { name: 'Workspaces' })).toBeInTheDocument()
    expect(screen.getByText('3 accounts · 1 portfolio')).toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: /Parents/ }))
    expect(selectWorkspace).toHaveBeenCalledWith('t2')
  })
})
