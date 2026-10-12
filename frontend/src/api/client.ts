import axios, { AxiosError } from 'axios'

export const TOKEN_KEY = 'nurav_finance_token'
export const USER_KEY = 'nurav_finance_user'
export const TENANT_KEY = 'nurav_finance_tenant'
export const UNAUTHORIZED_EVENT = 'nurav-finance:unauthorized'

export const client = axios.create({
  baseURL: '/api',
  headers: { 'Content-Type': 'application/json' },
})

// Attach the JWT and the selected tenant to every request. The tenant id is
// read at request time, so switching tenants takes effect immediately.
client.interceptors.request.use((config) => {
  const token = localStorage.getItem(TOKEN_KEY)
  if (token) config.headers.Authorization = `Bearer ${token}`
  const tenant = localStorage.getItem(TENANT_KEY)
  if (tenant && !config.headers['X-Tenant-Id']) config.headers['X-Tenant-Id'] = tenant
  return config
})

// On 401, clear stored credentials and tell the app to show the login page.
client.interceptors.response.use(
  (res) => res,
  (error: AxiosError) => {
    if (error.response?.status === 401 && !error.config?.url?.startsWith('/auth/login')) {
      localStorage.removeItem(TOKEN_KEY)
      localStorage.removeItem(USER_KEY)
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    }
    return Promise.reject(error)
  },
)

/** Human-readable message from an API error (FastAPI `detail`, string or validation list). */
export function apiErrorMessage(error: unknown, fallback = 'Something went wrong'): string {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail
    if (typeof detail === 'string') return detail
    if (Array.isArray(detail) && detail.length > 0) {
      const first = detail[0] as { msg?: string; loc?: (string | number)[] }
      const field = first.loc?.filter((p) => typeof p === 'string' && p !== 'body').join('.')
      const msg = (first.msg ?? fallback).replace(/^Value error, /, '')
      return field ? `${field}: ${msg}` : msg
    }
    if (!error.response) return 'Cannot reach the server'
  }
  return fallback
}
