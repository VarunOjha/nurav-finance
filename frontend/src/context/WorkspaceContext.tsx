import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { WORKSPACE_KEY } from '../api/client'
import { workspacesApi } from '../api/endpoints'
import type { Workspace } from '../types/api'

interface WorkspaceContextValue {
  workspaces: Workspace[]
  workspace: Workspace | null
  /** Selected workspace id; every workspace-scoped query key includes it. */
  workspaceId: string | null
  selectWorkspace: (id: string) => void
  isLoading: boolean
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null)

export const workspacesKey = ['workspaces'] as const

// Holds the header switcher's selection. The id is mirrored to localStorage,
// where the API client reads it for the X-Workspace-Id header. If the stored id
// no longer exists (deleted workspace, different user), fall back to the default.
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { data: workspaces = [], isLoading } = useQuery({ queryKey: workspacesKey, queryFn: workspacesApi.list })
  const [selected, setSelected] = useState<string | null>(() => localStorage.getItem(WORKSPACE_KEY))

  const workspace = useMemo(
    () => workspaces.find((t) => t.id === selected) ?? workspaces.find((t) => t.is_default) ?? workspaces[0] ?? null,
    [workspaces, selected],
  )

  useEffect(() => {
    if (workspace && workspace.id !== localStorage.getItem(WORKSPACE_KEY)) {
      localStorage.setItem(WORKSPACE_KEY, workspace.id)
      setSelected(workspace.id)
    }
  }, [workspace])

  const selectWorkspace = useCallback((id: string) => {
    localStorage.setItem(WORKSPACE_KEY, id)
    setSelected(id)
  }, [])

  const value: WorkspaceContextValue = {
    workspaces,
    workspace,
    // Only expose the id once localStorage agrees, so no request goes out
    // with a stale header.
    workspaceId: workspace && workspace.id === selected ? workspace.id : null,
    selectWorkspace,
    isLoading,
  }
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
}

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext)
  if (!ctx) throw new Error('useWorkspace must be used inside WorkspaceProvider')
  return ctx
}
