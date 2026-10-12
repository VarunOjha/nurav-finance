import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { TENANT_KEY, TOKEN_KEY, UNAUTHORIZED_EVENT, USER_KEY } from '../api/client'
import { authApi } from '../api/endpoints'
import type { TokenResponse, User } from '../types/api'

interface AuthContextValue {
  user: User | null
  signIn: (email: string, password: string) => Promise<void>
  register: (body: Record<string, unknown>) => Promise<void>
  signOut: () => void
  setUser: (user: User) => void
}

const AuthContext = createContext<AuthContextValue | null>(null)

// Rehydrate the session from localStorage so a refresh doesn't bounce to login.
function loadStoredUser(): User | null {
  try {
    if (!localStorage.getItem(TOKEN_KEY)) return null
    const raw = localStorage.getItem(USER_KEY)
    return raw ? (JSON.parse(raw) as User) : null
  } catch {
    return null
  }
}

// Owns the auth lifecycle: sign in, register, sign out and the global 401 → logout listener.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(loadStoredUser)
  const queryClient = useQueryClient()

  const store = useCallback((resp: TokenResponse) => {
    localStorage.setItem(TOKEN_KEY, resp.access_token)
    localStorage.setItem(USER_KEY, JSON.stringify(resp.user))
    setUserState(resp.user)
  }, [])

  const setUser = useCallback((next: User) => {
    localStorage.setItem(USER_KEY, JSON.stringify(next))
    setUserState(next)
  }, [])

  const signOut = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    localStorage.removeItem(TENANT_KEY)
    queryClient.clear()
    setUserState(null)
  }, [queryClient])

  useEffect(() => {
    const handler = () => {
      queryClient.clear()
      setUserState(null)
    }
    window.addEventListener(UNAUTHORIZED_EVENT, handler)
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler)
  }, [queryClient])

  const signIn = useCallback(async (email: string, password: string) => store(await authApi.login(email, password)), [store])
  const register = useCallback(async (body: Record<string, unknown>) => store(await authApi.register(body)), [store])

  return <AuthContext.Provider value={{ user, signIn, register, signOut, setUser }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
