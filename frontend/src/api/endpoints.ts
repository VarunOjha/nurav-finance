import { client } from './client'
import type {
  AccountDetail,
  AccountInput,
  AccountSummary,
  AnalyticsRange,
  BalanceEntry,
  BalanceHistory,
  CurrencyConsolidation,
  HoldingInput,
  Overview,
  PortfolioInput,
  PortfolioSummary,
  SnapshotComparison,
  SnapshotPrefill,
  SnapshotSummary,
  Tag,
  Tenant,
  TokenResponse,
  User,
} from '../types/api'

const data = <T>(p: Promise<{ data: T }>) => p.then((r) => r.data)

export const authApi = {
  login: (email: string, password: string) => data(client.post<TokenResponse>('/auth/login', { email, password })),
  register: (body: Record<string, unknown>) => data(client.post<TokenResponse>('/auth/register', body)),
  me: () => data(client.get<User>('/auth/me')),
  updateMe: (body: Partial<User>) => data(client.patch<User>('/auth/me', body)),
  changePassword: (current_password: string, new_password: string) =>
    client.post('/auth/change-password', { current_password, new_password }),
}

export const tenantsApi = {
  list: () => data(client.get<Tenant[]>('/tenants')),
  create: (body: { name: string; description?: string | null }) => data(client.post<Tenant>('/tenants', body)),
  update: (id: string, body: { name?: string; description?: string | null }) => data(client.patch<Tenant>(`/tenants/${id}`, body)),
  remove: (id: string) => client.delete(`/tenants/${id}`),
}

export const tagsApi = {
  list: () => data(client.get<Tag[]>('/tags')),
  create: (body: { name: string; description?: string | null }) => data(client.post<Tag>('/tags', body)),
  update: (id: string, body: { name?: string; description?: string | null }) => data(client.patch<Tag>(`/tags/${id}`, body)),
  remove: (id: string) => client.delete(`/tags/${id}`),
  seed: () => data(client.post<Tag[]>('/tags/seed')),
}

export const accountsApi = {
  list: (status: 'active' | 'closed' | 'all' = 'all') => data(client.get<AccountSummary[]>('/accounts', { params: { status } })),
  get: (id: string) => data(client.get<AccountDetail>(`/accounts/${id}`)),
  create: (body: AccountInput) => data(client.post<AccountDetail>('/accounts', body)),
  update: (id: string, body: Partial<AccountInput>) => data(client.patch<AccountDetail>(`/accounts/${id}`, body)),
  remove: (id: string) => client.delete(`/accounts/${id}`),
  reveal: (id: string) => data(client.post<{ account_number: string }>(`/accounts/${id}/reveal`)),
  balances: (id: string) => data(client.get<BalanceHistory>(`/accounts/${id}/balances`)),
  recordBalance: (id: string, body: { amount: string; as_of: string; note?: string | null }) =>
    data(client.post<BalanceEntry>(`/accounts/${id}/balances`, body)),
  deleteBalance: (id: string, entryId: string) => client.delete(`/accounts/${id}/balances/${entryId}`),
}

export const portfoliosApi = {
  list: () => data(client.get<PortfolioSummary[]>('/portfolios')),
  consolidated: () => data(client.get<{ currencies: CurrencyConsolidation[] }>('/portfolios/consolidated')),
  get: (id: string) => data(client.get<PortfolioSummary>(`/portfolios/${id}`)),
  create: (body: PortfolioInput) => data(client.post<PortfolioSummary>('/portfolios', body)),
  update: (id: string, body: Partial<PortfolioInput>) => data(client.patch<PortfolioSummary>(`/portfolios/${id}`, body)),
  remove: (id: string) => client.delete(`/portfolios/${id}`),
  snapshots: (id: string) => data(client.get<SnapshotSummary[]>(`/portfolios/${id}/snapshots`)),
  snapshot: (id: string, snapshotId: string, compareTo?: string | null) =>
    data(client.get<SnapshotComparison>(`/portfolios/${id}/snapshots/${snapshotId}`, { params: compareTo ? { compare_to: compareTo } : {} })),
  prefill: (id: string, asOf: string) => data(client.get<SnapshotPrefill>(`/portfolios/${id}/snapshots/prefill`, { params: { as_of: asOf } })),
  createSnapshot: (id: string, body: { as_of: string; note?: string | null; holdings: HoldingInput[] }) =>
    data(client.post<SnapshotSummary>(`/portfolios/${id}/snapshots`, body)),
  deleteSnapshot: (id: string, snapshotId: string) => client.delete(`/portfolios/${id}/snapshots/${snapshotId}`),
}

export const analyticsApi = {
  overview: (range: AnalyticsRange) => data(client.get<Overview>('/analytics/overview', { params: { range } })),
}
