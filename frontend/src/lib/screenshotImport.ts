// Screenshot import: upload 1-4 holdings screenshots, follow progress, get a
// proposal back. The response streams NDJSON (one JSON event per line), so this
// uses fetch + a reader rather than axios. Same auth and workspace headers as
// api/client.ts. Nothing is saved server-side; the images aren't kept.

import { TOKEN_KEY, UNAUTHORIZED_EVENT, USER_KEY, WORKSPACE_KEY } from '../api/client'
import type { ScreenshotEvent } from '../types/api'

export const MAX_SCREENSHOTS = 4
export const MAX_SCREENSHOT_BYTES = 10 * 1024 * 1024
export const SCREENSHOT_TYPES = ['image/png', 'image/jpeg', 'image/webp']

export class ScreenshotImportError extends Error {}

/** Why a file can't be used, or null if it's fine. */
export function screenshotProblem(file: File): string | null {
  if (!SCREENSHOT_TYPES.includes(file.type)) return `${file.name || 'That file'} isn't a PNG, JPEG or WebP image`
  if (file.size > MAX_SCREENSHOT_BYTES) return `${file.name || 'That image'} is larger than 10 MB`
  return null
}

/** Splits an NDJSON byte stream into events; tolerant of chunks that end mid-line. */
export function ndjsonParser<E = ScreenshotEvent>(onEvent: (e: E) => void) {
  let buffer = ''
  return (chunk: string, end = false) => {
    buffer += chunk
    const lines = buffer.split('\n')
    buffer = end ? '' : (lines.pop() ?? '')
    for (const line of lines) {
      if (!line.trim()) continue
      try {
        onEvent(JSON.parse(line) as E)
      } catch {
        // A malformed line is skipped; the stream goes on.
      }
    }
  }
}

/** `target`: the portfolio's id, or `{ currency }` for a portfolio that will be created with these holdings. */
export async function importScreenshots(
  target: string | { currency: string },
  files: File[],
  asOf: string,
  onEvent: (e: ScreenshotEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const form = new FormData()
  files.forEach((f) => form.append('files', f, f.name || 'screenshot.png'))
  if (typeof target === 'string') form.append('as_of', asOf)
  else form.append('currency', target.currency)
  const url = typeof target === 'string' ? `/api/portfolios/${target}/snapshots/screenshot` : '/api/portfolios/screenshot'
  const headers: Record<string, string> = { Accept: 'application/x-ndjson' }
  const token = localStorage.getItem(TOKEN_KEY)
  const workspace = localStorage.getItem(WORKSPACE_KEY)
  if (token) headers.Authorization = `Bearer ${token}`
  if (workspace) headers['X-Workspace-Id'] = workspace

  let res: Response
  try {
    res = await fetch(url, { method: 'POST', headers, body: form, signal })
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    throw new ScreenshotImportError('Cannot reach the server')
  }
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    throw new ScreenshotImportError('Signed out')
  }
  if (!res.ok || !res.body) {
    let detail = `Reading the screenshots failed (HTTP ${res.status})`
    try {
      const j = await res.json()
      if (typeof j.detail === 'string') detail = j.detail
      else if (Array.isArray(j.detail) && j.detail[0]?.msg) detail = j.detail[0].msg
    } catch {
      // keep the generic message
    }
    throw new ScreenshotImportError(detail)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const feed = ndjsonParser(onEvent)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      feed(decoder.decode(value, { stream: true }))
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    throw new ScreenshotImportError('The connection dropped while reading the screenshots')
  }
  feed(decoder.decode(), true)
}
