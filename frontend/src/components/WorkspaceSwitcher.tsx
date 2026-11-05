import { useState } from 'react'
import { Link } from 'react-router-dom'
import * as Popover from '@radix-ui/react-popover'
import { Check, ChevronDown } from 'lucide-react'
import { useWorkspace } from '../context/WorkspaceContext'

function counts(accounts: number, portfolios: number): string {
  const a = `${accounts} account${accounts === 1 ? '' : 's'}`
  const p = `${portfolios} portfolio${portfolios === 1 ? '' : 's'}`
  return `${a} · ${p}`
}

// Header workspace picker. Everything below the header follows the selection;
// workspaces themselves are created and managed in Profile.
export function WorkspaceSwitcher() {
  const { workspaces, workspace, selectWorkspace } = useWorkspace()
  const [open, setOpen] = useState(false)
  if (!workspace) return null

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          className="inline-flex items-center gap-2.5 px-2.5 min-h-10 border border-transparent hover:border-line focus:outline-none focus-visible:border-ink min-w-0"
          aria-label={`Workspace: ${workspace.name}. Switch workspace`}
        >
          <span className="hidden sm:inline font-mono text-[10px] uppercase tracking-widest text-ink-muted">Workspace</span>
          <span className="font-mono text-xs uppercase tracking-widest font-medium text-ink truncate max-w-[9rem] sm:max-w-[14rem]">{workspace.name}</span>
          <ChevronDown className="w-3.5 h-3.5 text-ink-muted shrink-0" aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          align="start"
          sideOffset={6}
          className="z-50 w-[19rem] max-w-[92vw] bg-paper border border-ink shadow-[4px_4px_0_rgb(var(--ink)/0.12)]"
        >
          <p className="px-4 pt-3 pb-2 font-mono text-[10px] uppercase tracking-widest text-ink-muted border-b border-line">
            Switch workspace · everything follows it
          </p>
          <ul role="listbox" aria-label="Workspaces" className="max-h-80 overflow-y-auto">
            {workspaces.map((t) => {
              const selected = t.id === workspace.id
              return (
                <li key={t.id}>
                  <button
                    role="option"
                    aria-selected={selected}
                    onClick={() => {
                      selectWorkspace(t.id)
                      setOpen(false)
                    }}
                    className="w-full flex items-start gap-3 px-4 py-3 border-b border-line text-left hover:bg-paper-warm focus:outline-none focus-visible:bg-paper-warm"
                  >
                    <span className="w-3.5 pt-0.5 shrink-0">{selected && <Check className="w-3.5 h-3.5" aria-hidden="true" />}</span>
                    <span className="flex flex-col gap-1 min-w-0">
                      <span className="font-mono text-xs uppercase tracking-widest font-medium text-ink truncate">{t.name}</span>
                      <span className="font-mono text-[10px] text-ink-muted">
                        {counts(t.account_count, t.portfolio_count)}
                        {t.is_default && ' · default'}
                      </span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>
          <Link
            to={{ search: '?profile=workspaces' }}
            onClick={() => setOpen(false)}
            className="block px-4 py-3 font-mono text-[11px] uppercase tracking-widest text-ink-muted hover:text-ink"
          >
            Manage workspaces in Profile →
          </Link>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
