// Wealth estimator: run an inquiry (the response streams NDJSON progress, then
// the saved inquiry's id) and the small formatters its pages share.

import { TOKEN_KEY, UNAUTHORIZED_EVENT, USER_KEY, WORKSPACE_KEY } from '../api/client'
import type { InquiryEvent, InquiryInput, InquirySummary, ScenarioKey } from '../types/api'
import { ndjsonParser } from './screenshotImport'

export class InquiryError extends Error {}

export async function runInquiry(body: InquiryInput, onEvent: (e: InquiryEvent) => void, signal?: AbortSignal): Promise<void> {
  const headers: Record<string, string> = { Accept: 'application/x-ndjson', 'Content-Type': 'application/json' }
  const token = localStorage.getItem(TOKEN_KEY)
  const workspace = localStorage.getItem(WORKSPACE_KEY)
  if (token) headers.Authorization = `Bearer ${token}`
  if (workspace) headers['X-Workspace-Id'] = workspace

  let res: Response
  try {
    res = await fetch('/api/estimator/inquiries', { method: 'POST', headers, body: JSON.stringify(body), signal })
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    throw new InquiryError('Cannot reach the server')
  }
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY)
    localStorage.removeItem(USER_KEY)
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT))
    throw new InquiryError('Signed out')
  }
  if (!res.ok || !res.body) {
    let detail = `The inquiry failed (HTTP ${res.status})`
    try {
      const j = await res.json()
      if (typeof j.detail === 'string') detail = j.detail
      else if (Array.isArray(j.detail) && j.detail[0]?.msg) detail = String(j.detail[0].msg).replace(/^Value error, /, '')
    } catch {
      // keep the generic message
    }
    throw new InquiryError(detail)
  }
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  const feed = ndjsonParser<InquiryEvent>(onEvent)
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      feed(decoder.decode(value, { stream: true }))
    }
  } catch (e) {
    if ((e as Error).name === 'AbortError') return
    throw new InquiryError('The connection dropped while the inquiry was running')
  }
  feed(decoder.decode(), true)
}

/** The day an inquiry was made, in local time. */
export const inquiryDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

export const SCENARIO_LABEL: Record<ScenarioKey, string> = { conservative: 'Conservative', balanced: 'Balanced', aggressive: 'Aggressive' }

/** FI year, or "60+" when it's beyond the horizon (or never). */
export const fiYear = (y: number | null | undefined) => (y === null || y === undefined ? '60+ yrs' : String(y))

/** "−2 yrs", "+0.5 yr", "0" — years gained (−) or lost (+). */
export function yearsDelta(d: number | null | undefined): string {
  if (d === null || d === undefined) return '—'
  const r = Math.round(d * 10) / 10
  if (r === 0) return '0'
  const abs = Math.abs(r)
  return `${r > 0 ? '+' : '−'}${abs % 1 === 0 ? abs.toFixed(0) : abs.toFixed(1)} yr${abs === 1 ? '' : 's'}`
}

/** "1 INR = 0.0114 USD" is unreadable; show the bigger side: "1 USD = 88.0 INR". */
export function fxLabel(currency: string, valueInExpense: number, expenseCurrency: string): string {
  if (valueInExpense >= 1) return `1 ${currency} = ${valueInExpense.toFixed(2)} ${expenseCurrency}`
  return `1 ${expenseCurrency} = ${(1 / valueInExpense).toFixed(1)} ${currency}`
}

/** Balanced FI year change against the inquiry before it (oldest-first list). */
export function balancedDeltas(list: InquirySummary[]): (number | null)[] {
  return list.map((q, i) => {
    const prev = list[i - 1]
    const a = prev?.fi_years.balanced
    const b = q.fi_years.balanced
    return prev && a !== null && b !== null ? b - a : null
  })
}

/**
 * Advice over time: one row per change title seen in the last `n` inquiries, the latest's
 * advice first; `marks[i]` says whether inquiry i (oldest first) gave it. A row the latest
 * inquiry no longer gives is `resolved`.
 */
export function adviceRows(list: InquirySummary[], n = 6): { title: string; marks: boolean[]; resolved: boolean }[] {
  const recent = list.slice(-n)
  const latest = recent[recent.length - 1]
  if (!latest) return []
  const titles = [...latest.changes]
  for (const q of [...recent].reverse()) for (const t of q.changes) if (!titles.includes(t)) titles.push(t)
  return titles.slice(0, 8).map((title) => ({
    title,
    marks: recent.map((q) => q.changes.includes(title)),
    resolved: !latest.changes.includes(title),
  }))
}

/** Balanced targets whose value moved across the last `n` inquiries: "MSFT 15% → 10%". */
export function movingTargets(list: InquirySummary[], n = 6): { label: string; values: (number | null)[] }[] {
  const recent = list.slice(-n)
  const latest = recent[recent.length - 1]
  if (!latest || recent.length < 2) return []
  return Object.keys(latest.targets)
    .map((key) => ({ label: latest.labels[key] ?? key, values: recent.map((q) => q.targets[key] ?? null) }))
    .filter((r) => new Set(r.values.map((v) => v ?? 0)).size > 1)
    .slice(0, 3)
}

// ── retire earlier: monthly savings on top of the pool ──────────────────────
// Everything in today's money: the pool grows at the real rate (growth after
// inflation) and each month's saving is a fixed amount in today's money (so it
// rises with inflation). Same compounding as the server's: (1 + m)^12 = 1 + g.

export const MAX_MONTHS = 60 * 12

const monthly = (realPct: number) => Math.pow(1 + realPct / 100, 1 / 12) - 1

/** Months until `pool` (+ `saving` a month) reaches `target`; null = not within 60 years. */
export function monthsToTarget(pool: number, target: number, realPct: number, saving: number): number | null {
  if (pool >= target) return 0
  const m = monthly(realPct)
  let n: number
  if (Math.abs(m) < 1e-12) {
    if (saving <= 0) return null
    n = (target - pool) / saving
  } else {
    const x = (target + saving / m) / (pool + saving / m)
    if (!(x > 0)) return null
    n = Math.log(x) / Math.log(1 + m)
  }
  return Number.isFinite(n) && n >= 0 && n <= MAX_MONTHS ? n : null
}

/** Saving a month (today's money) that reaches `target` in `months`; 0 when the pool gets there anyway. */
export function savingFor(pool: number, target: number, realPct: number, months: number): number {
  if (months <= 0) return Math.max(0, target - pool)
  const m = monthly(realPct)
  const k = Math.pow(1 + m, months)
  const need = Math.abs(m) < 1e-12 ? (target - pool) / months : ((target - pool * k) * m) / (k - 1)
  return Math.max(0, need)
}

/** The calendar year `months` after `todayIso` (days as the server counts them: 365.25 a year). */
export function yearAfter(todayIso: string, months: number): number {
  const [y, mo, d] = todayIso.split('-').map(Number)
  const day = new Date(y, mo - 1, d)
  day.setDate(day.getDate() + Math.round((months / 12) * 365.25))
  return day.getFullYear()
}

/** Months from `todayIso` to the start of December of `year`: "retire by 2041" means within 2041. */
export function monthsUntil(todayIso: string, year: number): number {
  const [y, mo] = todayIso.split('-').map(Number)
  return (year - y) * 12 + (12 - mo)
}

// ── after retiring: taking the withdrawal rate of the pool each year ────────
// From the retire year on, the pool earns r and you take w of it each year, so
// it changes by (1 + r − w) a year and your income moves with it. In today's
// money that's (1 + r − w) / (1 + i) a year: rising when growth after
// inflation beats the rate, falling when it doesn't.

export interface RetiredRow {
  /** Years after retiring. */
  after: number
  /** Monthly income in today's money. */
  monthlyToday: number
  /** Monthly income in that year's money. */
  monthlyThen: number
  /** The pool in today's money. */
  poolToday: number
}

export function afterRetiring(
  targetToday: number,
  targetThen: number,
  returnPct: number,
  inflationPct: number,
  ratePct: number,
  years = 30,
  step = 3,
): RetiredRow[] {
  const r = returnPct / 100
  const i = inflationPct / 100
  const w = ratePct / 100
  const rows: RetiredRow[] = []
  for (let k = 0; k <= years; k += step) {
    const poolToday = targetToday * Math.pow((1 + r - w) / (1 + i), k)
    rows.push({ after: k, poolToday, monthlyToday: (w * poolToday) / 12, monthlyThen: (w * targetThen * Math.pow(1 + r - w, k)) / 12 })
  }
  return rows
}

/** Yearly change of that income in today's money, in percent. */
export const incomeGrowthPct = (returnPct: number, inflationPct: number, ratePct: number) =>
  ((1 + returnPct / 100 - ratePct / 100) / (1 + inflationPct / 100) - 1) * 100
