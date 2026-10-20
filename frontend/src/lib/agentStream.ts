// The Wealth Agent's streaming requests (/api/agent/turn and /approve).
// Server-Sent Events over a POST, so fetch + a reader rather than axios or
// EventSource. Same auth and tenant headers as api/client.ts.

import { TENANT_KEY, TOKEN_KEY, UNAUTHORIZED_EVENT, USER_KEY } from '../api/client'
import type { AgentEvent } from '../types/api'

export class AgentRequestError extends Error {}

/** Splits an SSE byte stream into events; tolerant of chunks that end mid-line. */
export function sseParser(onEvent: (e: AgentEvent) => void) {
  let buffer = ''
  return (chunk: string) => {
    buffer += chunk
    let cut: number
    while ((cut = buffer.indexOf('\n\n')) >= 0) {
      const block = buffer.slice(0, cut)
      buffer = buffer.slice(cut + 2)
      for (const line of block.split('\n')) {
        if (!line.startsWith('data:')) continue
        try {
          onEvent(JSON.parse(line.slice(5).trim()) as AgentEvent)
        } catch {
          // A malformed line is skipped; the stream goes on.
        }
      }
    }
  }
}

export async function streamAgent(path: '/agent/turn' | '/agent/approve', body: unknown, onEvent: (e: AgentEvent) => void, signal?: AbortSignal): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'text/event-stream' }
  const token = localStorage.getItem(TOKEN_KEY)
  const tenant = localStorage.getItem(TENANT_KEY)
  if (token) headers.Authorization = `Bearer ${token}`
  if (tenant) headers['X-Tenant-Id'] = tenant
  let res: Response
  try {
    res = await fetch(`/api${path}`, { method: 'POST', headers, body: JSON.stringify(body), signal })
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    throw new AgentRequestError('Cannot reach the server')
  }
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    throw new AgentRequestError('Signed out')
  }
  if (!res.ok || !res.body) {
    let detail = `The agent request failed (HTTP ${res.status})`
    try {
      const j = await res.json()
      if (typeof j.detail === 'string') detail = j.detail
    } catch {
      // keep the generic message
    }
    throw new AgentRequestError(detail)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const feed = sseParser(onEvent)
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    feed(decoder.decode(value, { stream: true }))
  }
  feed(decoder.decode() + '\n\n')
}
