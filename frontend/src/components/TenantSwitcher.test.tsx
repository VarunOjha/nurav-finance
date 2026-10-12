import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { TenantSwitcher } from './TenantSwitcher'
import type { Tenant } from '../types/api'

const tenants: Tenant[] = [
  { id: 't1', name: 'DEFAULT_SELF', description: null, is_default: true, created_at: '2026-10-11T00:00:00Z', account_count: 9, portfolio_count: 4 },
  { id: 't2', name: 'Parents', description: null, is_default: false, created_at: '2026-10-11T00:00:00Z', account_count: 3, portfolio_count: 1 },
]
const selectTenant = vi.fn()

vi.mock('../context/TenantContext', () => ({
  useTenant: () => ({ tenants, tenant: tenants[0], tenantId: 't1', selectTenant, isLoading: false }),
}))

describe('TenantSwitcher', () => {
  it('shows the selected tenant and switches to another', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <TenantSwitcher />
      </MemoryRouter>,
    )
    const trigger = screen.getByRole('button', { name: /Tenant: DEFAULT_SELF/ })
    expect(trigger).toHaveTextContent('DEFAULT_SELF')

    await user.click(trigger)
    expect(screen.getByRole('listbox', { name: 'Tenants' })).toBeInTheDocument()
    expect(screen.getByText('3 accounts · 1 portfolio')).toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: /Parents/ }))
    expect(selectTenant).toHaveBeenCalledWith('t2')
  })
})
