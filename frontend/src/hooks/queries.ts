// TanStack Query hooks. Workspace-scoped keys start with the workspace id, so
// switching workspaces swaps every cache entry at once. Mutations invalidate
// (no optimistic updates), like Nurav Docs.
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { accountsApi, analyticsApi, portfoliosApi, tagsApi, workspacesApi } from '../api/endpoints'
import { workspacesKey, useWorkspace } from '../context/WorkspaceContext'
import type { AccountInput, AnalyticsRange, HoldingInput, PortfolioInput } from '../types/api'

const keys = {
  tags: ['tags'] as const,
  accounts: (t: string | null) => ['t', t, 'accounts'] as const,
  account: (t: string | null, id: string) => ['t', t, 'accounts', id] as const,
  balances: (t: string | null, id: string) => ['t', t, 'accounts', id, 'balances'] as const,
  portfolios: (t: string | null) => ['t', t, 'portfolios'] as const,
  consolidated: (t: string | null) => ['t', t, 'portfolios', 'consolidated'] as const,
  portfolio: (t: string | null, id: string) => ['t', t, 'portfolios', id] as const,
  snapshots: (t: string | null, id: string) => ['t', t, 'portfolios', id, 'snapshots'] as const,
  snapshot: (t: string | null, id: string, sid: string, cmp: string | null) => ['t', t, 'portfolios', id, 'snapshots', sid, cmp] as const,
  prefill: (t: string | null, id: string, asOf: string) => ['t', t, 'portfolios', id, 'prefill', asOf] as const,
  analytics: (t: string | null, range: AnalyticsRange) => ['t', t, 'analytics', range] as const,
}

/** Everything derived from a workspace's data, plus the counts shown on workspaces/tags. */
function invalidateWorkspaceData(qc: QueryClient, workspaceId: string | null) {
  qc.invalidateQueries({ queryKey: ['t', workspaceId] })
  qc.invalidateQueries({ queryKey: workspacesKey })
  qc.invalidateQueries({ queryKey: keys.tags })
}

function useScoped() {
  const { workspaceId } = useWorkspace()
  return { workspaceId, enabled: !!workspaceId }
}

// ── workspaces & tags (user-level) ──────────────────────────────────────────────

export function useTags() {
  return useQuery({ queryKey: keys.tags, queryFn: tagsApi.list })
}

export function useTagMutations() {
  const qc = useQueryClient()
  const done = () => {
    qc.invalidateQueries({ queryKey: keys.tags })
    qc.invalidateQueries({ queryKey: ['t'] }) // tag chips on accounts/portfolios
  }
  return {
    create: useMutation({ mutationFn: tagsApi.create, onSuccess: done }),
    update: useMutation({ mutationFn: (v: { id: string; name?: string; description?: string | null }) => tagsApi.update(v.id, v), onSuccess: done }),
    remove: useMutation({ mutationFn: tagsApi.remove, onSuccess: done }),
    seed: useMutation({ mutationFn: tagsApi.seed, onSuccess: done }),
  }
}

export function useWorkspaceMutations() {
  const qc = useQueryClient()
  const done = () => qc.invalidateQueries({ queryKey: workspacesKey })
  return {
    create: useMutation({ mutationFn: workspacesApi.create, onSuccess: done }),
    update: useMutation({ mutationFn: (v: { id: string; name?: string; description?: string | null }) => workspacesApi.update(v.id, v), onSuccess: done }),
    remove: useMutation({ mutationFn: workspacesApi.remove, onSuccess: done }),
  }
}

// ── accounts & balances ──────────────────────────────────────────────────────

export function useAccounts() {
  const { workspaceId, enabled } = useScoped()
  return useQuery({ queryKey: keys.accounts(workspaceId), queryFn: () => accountsApi.list('all'), enabled })
}

export function useAccount(id: string) {
  const { workspaceId, enabled } = useScoped()
  return useQuery({ queryKey: keys.account(workspaceId, id), queryFn: () => accountsApi.get(id), enabled })
}

export function useBalances(id: string) {
  const { workspaceId, enabled } = useScoped()
  return useQuery({ queryKey: keys.balances(workspaceId, id), queryFn: () => accountsApi.balances(id), enabled })
}

export function useAccountMutations() {
  const qc = useQueryClient()
  const { workspaceId } = useWorkspace()
  const done = () => invalidateWorkspaceData(qc, workspaceId)
  return {
    create: useMutation({ mutationFn: (body: AccountInput) => accountsApi.create(body), onSuccess: done }),
    update: useMutation({ mutationFn: (v: { id: string; body: Partial<AccountInput> }) => accountsApi.update(v.id, v.body), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => accountsApi.remove(id), onSuccess: done }),
    recordBalance: useMutation({
      mutationFn: (v: { id: string; amount: string; as_of: string; note?: string | null }) => accountsApi.recordBalance(v.id, v),
      onSuccess: done,
    }),
    deleteBalance: useMutation({ mutationFn: (v: { id: string; entryId: string }) => accountsApi.deleteBalance(v.id, v.entryId), onSuccess: done }),
  }
}

// ── portfolios & snapshots ───────────────────────────────────────────────────

export function usePortfolios() {
  const { workspaceId, enabled } = useScoped()
  return useQuery({ queryKey: keys.portfolios(workspaceId), queryFn: portfoliosApi.list, enabled })
}

export function useConsolidated() {
  const { workspaceId, enabled } = useScoped()
  return useQuery({ queryKey: keys.consolidated(workspaceId), queryFn: portfoliosApi.consolidated, enabled })
}

export function usePortfolio(id: string) {
  const { workspaceId, enabled } = useScoped()
  return useQuery({ queryKey: keys.portfolio(workspaceId, id), queryFn: () => portfoliosApi.get(id), enabled })
}

export function useSnapshots(id: string) {
  const { workspaceId, enabled } = useScoped()
  return useQuery({ queryKey: keys.snapshots(workspaceId, id), queryFn: () => portfoliosApi.snapshots(id), enabled })
}

export function useSnapshotComparison(id: string, snapshotId: string | null, compareTo: string | null) {
  const { workspaceId, enabled } = useScoped()
  return useQuery({
    queryKey: keys.snapshot(workspaceId, id, snapshotId ?? '', compareTo),
    queryFn: () => portfoliosApi.snapshot(id, snapshotId as string, compareTo),
    enabled: enabled && !!snapshotId,
  })
}

export function useSnapshotPrefill(id: string, asOf: string) {
  const { workspaceId, enabled } = useScoped()
  return useQuery({
    queryKey: keys.prefill(workspaceId, id, asOf),
    queryFn: () => portfoliosApi.prefill(id, asOf),
    enabled: enabled && /^\d{4}-\d{2}-\d{2}$/.test(asOf),
  })
}

export function usePortfolioMutations() {
  const qc = useQueryClient()
  const { workspaceId } = useWorkspace()
  const done = () => invalidateWorkspaceData(qc, workspaceId)
  return {
    create: useMutation({ mutationFn: (body: PortfolioInput) => portfoliosApi.create(body), onSuccess: done }),
    update: useMutation({ mutationFn: (v: { id: string; body: Partial<PortfolioInput> }) => portfoliosApi.update(v.id, v.body), onSuccess: done }),
    remove: useMutation({ mutationFn: (id: string) => portfoliosApi.remove(id), onSuccess: done }),
    createSnapshot: useMutation({
      mutationFn: (v: { id: string; as_of: string; note?: string | null; holdings: HoldingInput[] }) => portfoliosApi.createSnapshot(v.id, v),
      onSuccess: done,
    }),
    deleteSnapshot: useMutation({ mutationFn: (v: { id: string; snapshotId: string }) => portfoliosApi.deleteSnapshot(v.id, v.snapshotId), onSuccess: done }),
  }
}

// ── analytics ────────────────────────────────────────────────────────────────

export function useOverview(range: AnalyticsRange) {
  const { workspaceId, enabled } = useScoped()
  return useQuery({ queryKey: keys.analytics(workspaceId, range), queryFn: () => analyticsApi.overview(range), enabled })
}
