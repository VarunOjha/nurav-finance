import { useState } from 'react'
import { Button } from './ui/Button'
import { TextArea } from './ui/Field'
import { Modal } from './ui/Modal'
import { Table, td, th } from './ui/Primitives'
import { cn } from '../lib/cn'
import { ASSET_CLASS_LABELS, money, quantity } from '../lib/format'
import { ASSET_CLASSES, HOLDINGS_CSV_TEMPLATE, parseHoldingsCsv, type CsvHolding, type CsvResult } from '../lib/holdingsCsv'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  currency: string
  onAccept: (holdings: CsvHolding[]) => void
}

// Paste → Validate → Accept. Accept stays disabled until the exact text in the
// box has validated cleanly; any edit sends it back to "not validated".
export function HoldingsCsvModal({ open, onOpenChange, currency, onAccept }: Props) {
  const [text, setText] = useState('')
  const [result, setResult] = useState<CsvResult | null>(null)
  const [validated, setValidated] = useState<string | null>(null)
  const [showFormat, setShowFormat] = useState(true)

  const current = result !== null && validated === text
  const ok = current && result.errors.length === 0
  const total = ok ? result.holdings.reduce((s, h) => s + Number(h.quantity) * Number(h.current_price), 0) : 0

  const close = (next: boolean) => {
    if (!next) {
      setText('')
      setResult(null)
      setValidated(null)
    }
    onOpenChange(next)
  }

  const validate = () => {
    setResult(parseHoldingsCsv(text))
    setValidated(text)
  }

  return (
    <Modal
      open={open}
      onOpenChange={close}
      size="xl"
      title="Import holdings from CSV"
      subtitle="One row per holding for this snapshot's date. Accepting replaces the rows in the table — review them, then save."
      footer={
        <div className="flex flex-wrap items-center justify-end gap-5">
          <Button variant="ghost" onClick={() => close(false)}>
            Cancel
          </Button>
          <Button variant="secondary" onClick={validate} disabled={!text.trim()}>
            Validate
          </Button>
          <Button
            disabled={!ok}
            onClick={() => {
              if (!ok) return
              onAccept(result.holdings)
              close(false)
            }}
          >
            {ok ? `Accept ${result.holdings.length} holding${result.holdings.length === 1 ? '' : 's'}` : 'Accept'}
          </Button>
        </div>
      }
    >
      <div className="px-5 sm:px-7 py-5 flex flex-col gap-5">
        <div className="border border-line">
          <button
            type="button"
            aria-expanded={showFormat}
            onClick={() => setShowFormat((v) => !v)}
            className="w-full text-left px-4 py-2.5 font-mono text-[10px] uppercase tracking-widest text-ink-muted hover:text-ink bg-paper-warm"
          >
            {showFormat ? '▾' : '▸'} Accepted format
          </button>
          {showFormat && (
            <div className="px-4 py-3 font-mono text-[11px] text-ink-muted leading-relaxed space-y-2 border-t border-line">
              <p>
                First row is the header. Columns, in any order: <span className="text-ink">symbol</span>, <span className="text-ink">quantity</span>,{' '}
                <span className="text-ink">current_price</span> (required) and <span className="text-ink">name</span>,{' '}
                <span className="text-ink">asset_class</span>, <span className="text-ink">buy_price</span> (optional). Comma- or tab-separated, so you can paste straight from a spreadsheet.
              </p>
              <p>
                asset_class: {ASSET_CLASSES.join(', ')} — blank means stock. Both prices are per unit in {currency}; buy_price is your average cost. Numbers only: no currency symbols;
                thousands separators are fine inside quotes. Quote any value containing a comma. Lines starting with # are ignored.
              </p>
              <div className="flex flex-wrap gap-5 pt-1">
                <Button variant="ghost" onClick={() => setText(HOLDINGS_CSV_TEMPLATE)}>
                  Paste example
                </Button>
              </div>
            </div>
          )}
        </div>

        <TextArea
          id="holdings-csv"
          label="CSV"
          rows={10}
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={'symbol,name,asset_class,quantity,buy_price,current_price\nAAPL,Apple Inc.,stock,10,150.25,227.52'}
          className="[&_textarea]:font-mono [&_textarea]:text-xs [&_textarea]:whitespace-pre"
        />

        {result && !current && <p className="font-mono text-[11px] text-ink-muted">Text changed since the last check — validate again.</p>}

        {current && result.errors.length > 0 && (
          <div role="alert" className="border border-error/40 px-4 py-3 font-mono text-xs text-error space-y-1">
            <p className="uppercase tracking-widest text-[10px]">
              {result.errors.length} problem{result.errors.length === 1 ? '' : 's'} — fix and validate again
            </p>
            <ul className="space-y-0.5">
              {result.errors.map((e, i) => (
                <li key={i}>
                  {e.line !== null && <span className="text-ink-muted">Line {e.line}: </span>}
                  {e.message}
                </li>
              ))}
            </ul>
          </div>
        )}

        {ok && (
          <div className="flex flex-col gap-3">
            <p className="font-mono text-xs text-ink">
              ✓ {result.holdings.length} holding{result.holdings.length === 1 ? '' : 's'} valid · total {money(total, currency)}
            </p>
            <Table>
              <thead>
                <tr>
                  <th className={th}>Line</th>
                  <th className={th}>Symbol</th>
                  <th className={th}>Name</th>
                  <th className={th}>Class</th>
                  <th className={cn(th, 'text-right')}>Quantity</th>
                  <th className={cn(th, 'text-right')}>Buy price · {currency}</th>
                  <th className={cn(th, 'text-right')}>Current price · {currency}</th>
                  <th className={cn(th, 'text-right')}>Value</th>
                </tr>
              </thead>
              <tbody>
                {result.holdings.map((h) => (
                  <tr key={h.symbol}>
                    <td className={cn(td, 'text-ink-muted')}>{h.line}</td>
                    <td className={cn(td, 'font-medium')}>{h.symbol}</td>
                    <td className={td}>{h.name ?? '—'}</td>
                    <td className={cn(td, 'text-[10px] uppercase tracking-widest text-ink-muted')}>{ASSET_CLASS_LABELS[h.asset_class]}</td>
                    <td className={cn(td, 'text-right num')}>{quantity(h.quantity)}</td>
                    <td className={cn(td, 'text-right num')}>{h.buy_price === null ? '—' : money(h.buy_price, currency)}</td>
                    <td className={cn(td, 'text-right num')}>{money(h.current_price, currency)}</td>
                    <td className={cn(td, 'text-right num')}>{money(Number(h.quantity) * Number(h.current_price), currency)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        )}
      </div>
    </Modal>
  )
}
