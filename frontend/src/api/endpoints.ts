import { client } from './client'
import type {
  AccountDetail,
  AccountInput,
  AccountSplits,
  AccountSummary,
  AnalyticsRange,
  BalanceEntry,
  BalanceHistory,
  Bucket,
  CurrencyConsolidation,
  Dashboard,
  EstimatorPool,
  InquiryDetail,
  InquirySummary,
  HoldingInput,
  Metrics,
  Overview,
  PortfolioInput,
  PortfolioSummary,
  SnapshotComparison,
  SnapshotPrefill,
  SnapshotSummary,
  SplitInput,
  Milestone,
  MilestoneInput,
  Workspace,
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

export const workspacesApi = {
  list: () => data(client.get<Workspace[]>('/workspaces')),
  create: (body: { name: string; description?: string | null }) => data(client.post<Workspace>('/workspaces', body)),
  update: (id: string, body: { name?: string; description?: string | null }) => data(client.patch<Workspace>(`/workspaces/${id}`, body)),
  remove: (id: string) => client.delete(`/workspaces/${id}`),
}

export type BucketBody = { name?: string; description?: string | null; color?: number | null }

export const bucketsApi = {
  list: () => data(client.get<Bucket[]>('/buckets')),
  create: (body: BucketBody & { name: string }) => data(client.post<Bucket>('/buckets', body)),
  update: (id: string, body: BucketBody) => data(client.patch<Bucket>(`/buckets/${id}`, body)),
  reorder: (ids: string[]) => data(client.put<Bucket[]>('/buckets/order', { ids })),
  archive: (id: string) => data(client.post<Bucket>(`/buckets/${id}/archive`)),
  unarchive: (id: string) => data(client.post<Bucket>(`/buckets/${id}/unarchive`)),
  remove: (id: string) => client.delete(`/buckets/${id}`),
  seed: () => data(client.post<Bucket[]>('/buckets/seed')),
}

export const splitsApi = {
  get: (accountId: string) => data(client.get<AccountSplits>(`/accounts/${accountId}/splits`)),
  create: (accountId: string, body: SplitInput) => data(client.post<AccountSplits>(`/accounts/${accountId}/splits`, body)),
  remove: (accountId: string, splitId: string) => data(client.delete<AccountSplits>(`/accounts/${accountId}/splits/${splitId}`)),
}

export const milestonesApi = {
  list: () => data(client.get<Milestone[]>('/milestones')),
  create: (body: MilestoneInput) => data(client.post<Milestone>('/milestones', body)),
  update: (id: string, body: MilestoneInput) => data(client.put<Milestone>(`/milestones/${id}`, body)),
  remove: (id: string) => client.delete(`/milestones/${id}`),
  metrics: () => data(client.get<Metrics>('/metrics')),
}

export const accountsApi = {
  list: (status: 'active' | 'closed' | 'all' = 'all') => data(client.get<AccountSummary[]>('/accounts', { params: { status } })),
  get: (id: string) => data(client.get<AccountDetail>(`/accounts/${id}`)),
  create: (body: AccountInput) => data(client.post<AccountDetail>('/accounts', body)),
  update: (id: string, body: Partial<AccountInput>) => data(client.patch<AccountDetail>(`/accounts/${id}`, body)),
  remove: (id: string) => client.delete(`/accounts/${id}`),
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
  update: (id: string, body: Partial<Omit<PortfolioInput, 'snapshot'>>) => data(client.patch<PortfolioSummary>(`/portfolios/${id}`, body)),
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

export const dashboardApi = {
  get: () => data(client.get<Dashboard>('/dashboard')),
}

export const estimatorApi = {
  pool: () => data(client.get<EstimatorPool>('/estimator/pool')),
  list: () => data(client.get<InquirySummary[]>('/estimator/inquiries')),
  get: (id: string) => data(client.get<InquiryDetail>(`/estimator/inquiries/${id}`)),
  remove: (id: string) => client.delete(`/estimator/inquiries/${id}`),
}
