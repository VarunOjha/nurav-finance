import { useEffect, useState } from 'react'

// Recharts needs concrete colour strings, so read the palette's CSS variables
// (index.css) and re-read them when the OS switches light/dark.
export interface ChartTheme {
  ink: string
  inkMuted: string
  inkFaint: string
  paper: string
  paperWarm: string
  line: string
  error: string
  /** Distinct series colours, ink-first, monochrome-friendly. */
  series: string[]
}

function cssVar(name: string): string {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim()
  return raw ? `rgb(${raw.split(/\s+/).join(', ')})` : '#888'
}

function read(): ChartTheme {
  const ink = cssVar('ink')
  const inkMuted = cssVar('ink-muted')
  const inkFaint = cssVar('ink-faint')
  return {
    ink,
    inkMuted,
    inkFaint,
    paper: cssVar('paper'),
    paperWarm: cssVar('paper-warm'),
    line: cssVar('line'),
    error: cssVar('error'),
    series: [ink, inkMuted, inkFaint, cssVar('line')],
  }
}

export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState<ChartTheme>(read)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => setTheme(read())
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return theme
}

export const axisTick = { fontFamily: '"JetBrains Mono", monospace', fontSize: 10 }
