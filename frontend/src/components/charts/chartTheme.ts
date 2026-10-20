import { useMemo } from 'react'
import { useThemeVersion } from '../../lib/theme'

// Recharts needs concrete colour strings, so read the palette's CSS variables
// (index.css) and re-read them whenever the theme (or the OS, under System) changes.
export interface ChartTheme {
  ink: string
  inkMuted: string
  inkFaint: string
  paper: string
  paperWarm: string
  line: string
  error: string
  /**
   * Categorical colours in fixed order (blue, orange, aqua, yellow, magenta,
   * green, violet, red). Assign by entity, never by rank, and never cycle: fold
   * anything past 8 into "Other". Several are under 3:1 on light surfaces, so
   * every chart using them needs a legend or direct labels.
   */
  series: string[]
}

function cssVar(name: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()
  return raw ? `rgb(${raw.split(/\s+/).join(', ')})` : '#888'
}

function read(): ChartTheme {
  return {
    ink: cssVar('ink'),
    inkMuted: cssVar('ink-muted'),
    inkFaint: cssVar('ink-faint'),
    paper: cssVar('paper'),
    paperWarm: cssVar('paper-warm'),
    line: cssVar('line'),
    error: cssVar('error'),
    series: Array.from({ length: 8 }, (_, i) => cssVar(`series-${i + 1}`)),
  }
}

export function useChartTheme(): ChartTheme {
  const version = useThemeVersion()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(read, [version])
}

export const axisTick = { fontFamily: '"JetBrains Mono", monospace', fontSize: 10 }
