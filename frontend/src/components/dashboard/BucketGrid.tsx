// Accounts × buckets for one currency: each cell is the account's money in that
// bucket today, shaded by size. A row opens the account's bucket split.
import { Swatch } from '../charts/kit'
import { useChartTheme } from '../charts/chartTheme'
import { th } from '../ui/Primitives'
import { UNASSIGNED, bucketColor } from '../../lib/buckets'
import { cn } from '../../lib/cn'
import { money, toNumber } from '../../lib/format'
import type { BucketGrid as Grid, GridRow } from '../../types/api'

/** "rgb(42, 120, 214)" → same colour at `alpha`. */
function tint(rgb: string, alpha: number): string {
  return rgb.startsWith('rgb(') ? rgb.replace('rgb(', 'rgba(').replace(')', `, ${alpha.toFixed(3)})`) : rgb
}

const cell = 'font-mono text-[11px] num px-2 py-2 text-right whitespace-nowrap overflow-hidden text-ellipsis'

export function BucketGrid({ currency, grid, onRow }: { currency: string; grid: Grid; onRow: (row: GridRow) => void }) {
  const theme = useChartTheme()
  const max = Math.max(1, ...grid.rows.flatMap((r) => r.cells.map((c) => toNumber(c) ?? 0)))
  const short = (v: string | null) => money(v, currency, { compact: true })
  return (
    <table className="w-full table-fixed border-separate border-spacing-0.5">
      <thead>
        <tr>
          <th className={cn(th, 'w-[38%] bg-transparent border-b-0 px-2')}>{currency}</th>
          {grid.buckets.map((b) => (
            <th key={b?.id ?? 'none'} className={cn(th, 'bg-transparent border-b-0 px-2 text-right')} title={b?.name ?? UNASSIGNED}>
              <span className="inline-flex items-center gap-1.5 max-w-full">
                <Swatch color={bucketColor(theme, b?.color)} />
                <span className="truncate">{b?.name ?? UNASSIGNED}</span>
              </span>
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {grid.rows.map((r) => (
          <tr key={r.account_id} onClick={() => onRow(r)} className="cursor-pointer group">
            <td className="font-mono text-[11px] text-ink px-2 py-2 truncate group-hover:underline">
              <button type="button" className="text-left truncate max-w-full focus:outline-none focus-visible:underline" onClick={() => onRow(r)} aria-label={`${r.name}: edit bucket split`}>
                {r.name}
              </button>
            </td>
            {r.cells.map((c, i) => {
              const v = toNumber(c)
              const b = grid.buckets[i]
              return v === null ? (
                <td key={i} className={cn(cell, 'bg-paper-warm text-ink-faint')}>
                  —
                </td>
              ) : (
                <td key={i} className={cn(cell, 'text-ink')} style={{ background: tint(bucketColor(theme, b?.color), 0.12 + 0.43 * (v / max)) }} title={`${r.name} · ${b?.name ?? UNASSIGNED}: ${money(c, currency)}`}>
                  {short(c)}
                </td>
              )
            })}
          </tr>
        ))}
        <tr>
          <td className="font-mono text-[11px] font-bold text-ink px-2 py-2 border-t-2 border-ink num">{short(String(grid.totals.reduce((s, t) => s + (toNumber(t) ?? 0), 0)))}</td>
          {grid.totals.map((t, i) => (
            <td key={i} className={cn(cell, 'font-bold text-ink border-t-2 border-ink')}>
              {short(t)}
            </td>
          ))}
        </tr>
      </tbody>
    </table>
  )
}
