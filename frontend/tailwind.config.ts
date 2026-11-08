import type { Config } from 'tailwindcss'
import plugin from 'tailwindcss/plugin'

// Table breakpoints measure the table's own box (a size container), not the
// window: the same table sits full-width on one page and beside a sidebar on
// another. `t-md:table-cell` shows a column once the table is 40rem wide.
const TABLE_WIDTHS = { sm: '30rem', md: '40rem', lg: '52rem', xl: '64rem', '2xl': '75rem' }

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
  plugins: [
    plugin(({ addVariant }) => {
      for (const [name, width] of Object.entries(TABLE_WIDTHS)) addVariant(`t-${name}`, `@container table (min-width: ${width})`)
    }),
  ],
}

export default config
