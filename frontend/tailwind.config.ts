import type { Config } from 'tailwindcss'

// Same palette and type as Nurav Docs. Colours are CSS variables (index.css) so
// dark mode can follow the OS by swapping the variables, not every class.
const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        paper: { DEFAULT: v('paper'), warm: v('paper-warm') },
        ink: { DEFAULT: v('ink'), muted: v('ink-muted'), faint: v('ink-faint') },
        line: v('line'),
        error: v('error'),
        // Chart categories, fixed order — see index.css and charts/chartTheme.ts.
        series: Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i + 1, v(`series-${i + 1}`)])),
      },
      fontFamily: {
        mono: ['"JetBrains Mono"', 'ui-monospace', 'Menlo', 'monospace'],
        sans: ['Inter', 'ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif'],
      },
      letterSpacing: {
        brand: '0.15em',
      },
    },
  },
  plugins: [],
}

export default config
