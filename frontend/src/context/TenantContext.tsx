import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { TENANT_KEY } from '../api/client'
import { tenantsApi } from '../api/endpoints'
import type { Tenant } from '../types/api'

interface TenantContextValue {
  tenants: Tenant[]
  tenant: Tenant | null
  /** Selected tenant id; every tenant-scoped query key includes it. */
  tenantId: string | null
  selectTenant: (id: string) => void
  isLoading: boolean
}

const TenantContext = createContext<TenantContextValue | null>(null)

export const tenantsKey = ['tenants'] as const

// Holds the header switcher's selection. The id is mirrored to localStorage,
// where the API client reads it for the X-Tenant-Id header. If the stored id
// no longer exists (deleted tenant, different user), fall back to the default.
export function TenantProvider({ children }: { children: ReactNode }) {
  const { data: tenants = [], isLoading } = useQuery({ queryKey: tenantsKey, queryFn: tenantsApi.list })
  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem(TENANT_KEY))

  const tenant = useMemo(
    () => tenants.find((t) => t.id === selected) ?? tenants.find((t) => t.is_default) ?? tenants[0] ?? null,
    [tenants, selected],
  )

  useEffect(() => {
    if (tenant && tenant.id !== localStorage.getItem(TENANT_KEY)) {
      localStorage.setItem(TENANT_KEY, tenant.id)
      setSelected(tenant.id)
    }
  }, [tenant])

  const selectTenant = useCallback((id: string) => {
    localStorage.setItem(TENANT_KEY, id)
    setSelected(id)
  }, [])

  const value: TenantContextValue = {
    tenants,
    tenant,
    // Only expose the id once localStorage agrees, so no request goes out
    // with a stale header.
    tenantId: tenant && tenant.id === selected ? tenant.id : null,
    selectTenant,
    isLoading,
  }
  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>
}

export function useTenant(): TenantContextValue {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useTenant must be used inside TenantProvider')
  return ctx
}
