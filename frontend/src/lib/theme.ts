import { useSyncExternalStore } from 'react'

// Colour themes. The palette lives in index.css as CSS variables per
// [data-theme]; this module picks one, remembers it per browser, and lets
// charts re-read colours when it changes. index.html applies the saved choice
// before first paint (keep STORAGE_KEY and the ids in sync with it).

export type ThemeId = 'paper' | 'fog' | 'linen' | 'dusk' | 'ink'
export type ThemeChoice = ThemeId | 'system'

export interface ThemeInfo {
  id: ThemeId
  label: string
  mode: 'light' | 'dark'
  blurb: string
  /** paper, paper-warm, ink, line — for the picker's swatch */
  swatch: [string, string, string, string]
}

export const THEMES: ThemeInfo[] = [
  { id: 'paper', label: 'Paper', mode: 'light', blurb: 'Off-white ledger (original light)', swatch: ['#F7F6F1', '#EDECEA', '#1A1918', '#D8D6CF'] },
  { id: 'fog', label: 'Fog', mode: 'light', blurb: 'Cool grey, softer than white', swatch: ['#EEF1F4', '#E2E6EB', '#1E2430', '#CDD3DB'] },
  { id: 'linen', label: 'Linen', mode: 'light', blurb: 'Warm cream, low glare', swatch: ['#F4ECDD', '#EADFCB', '#3A2E22', '#D9CBB3'] },
  { id: 'dusk', label: 'Dusk', mode: 'dark', blurb: 'Soft slate — dark, but not black', swatch: ['#2B2F36', '#343943', '#E6E8EC', '#474D59'] },
  { id: 'ink', label: 'Ink', mode: 'dark', blurb: 'Near-black (original dark)', swatch: ['#161514', '#232220', '#EDECEA', '#3A3936'] },
]

export const STORAGE_KEY = 'nurav-theme'
const CHOICES: ThemeChoice[] = ['system', ...THEMES.map((t) => t.id)]
// jsdom (tests) has no matchMedia.
const darkQuery = (): Pick<MediaQueryList, 'matches' | 'addEventListener'> =>
  window.matchMedia?.('(prefers-color-scheme: dark)') ?? { matches: false, addEventListener: () => {} }

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(STORAGE_KEY) as ThemeChoice | null
    return v && CHOICES.includes(v) ? v : 'system'
  } catch {
    return 'system'
  }
}

export function resolveTheme(choice: ThemeChoice, osDark: boolean): ThemeInfo {
  const id = choice === 'system' ? (osDark ? 'ink' : 'paper') : choice
  return THEMES.find((t) => t.id === id)!
}

let choice: ThemeChoice = readChoice()
let version = 0
const listeners = new Set<() => void>()

function apply() {
  const theme = resolveTheme(choice, darkQuery().matches)
  const root = document.documentElement
  root.dataset.theme = theme.id
  root.dataset.mode = theme.mode
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme.swatch[0])
  version++
  listeners.forEach((l) => l())
}

let started = false
function start() {
  if (started) return
  started = true
  apply()
  darkQuery().addEventListener('change', () => choice === 'system' && apply())
}

export function setTheme(next: ThemeChoice) {
  choice = next
  try {
    localStorage.setItem(STORAGE_KEY, next)
  } catch {
    /* private mode: still applies for this visit */
  }
  apply()
}

function subscribe(listener: () => void) {
  start()
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Current choice (may be "system") and the theme it resolves to. */
export function useTheme(): { choice: ThemeChoice; theme: ThemeInfo; setTheme: (c: ThemeChoice) => void } {
  useSyncExternalStore(subscribe, () => version)
  return { choice, theme: resolveTheme(choice, darkQuery().matches), setTheme }
}

/** Changes whenever the applied palette changes — a dependency for colour reads. */
export function useThemeVersion(): number {
  return useSyncExternalStore(subscribe, () => version)
}

start()
