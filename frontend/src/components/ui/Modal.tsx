import type { ReactNode } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '../../lib/cn'

const SIZE = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-2xl',
  xl: 'max-w-5xl',
  // Nearly the whole window — for forms that are really pages (profile, add account).
  page: 'max-w-7xl sm:w-[96vw] h-[92vh]',
} as const

interface ModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  subtitle?: ReactNode
  size?: keyof typeof SIZE
  footer?: ReactNode
  children: ReactNode
}

// Radix dialog chrome (overlay, title bar, close, scrollable body, footer) — modals only supply content.
export function Modal({ open, onOpenChange, title, subtitle, size = 'md', footer, children }: ModalProps) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-ink/40 z-40" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            'fixed z-50 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2',
            'w-[94vw] sm:w-full bg-paper border border-ink flex flex-col max-h-[92vh] shadow-[6px_6px_0_rgb(var(--ink)/0.12)]',
            SIZE[size],
          )}
        >
          <div className="flex items-start justify-between gap-4 px-5 sm:px-7 py-4 border-b border-line shrink-0">
            <div className="min-w-0">
              <Dialog.Title className="font-mono uppercase tracking-widest text-xs text-ink">{title}</Dialog.Title>
              {subtitle && <p className="font-mono text-[11px] text-ink-muted mt-1">{subtitle}</p>}
            </div>
            <Dialog.Close asChild>
              <button aria-label="Close" className="text-ink-muted hover:text-ink focus:outline-none p-1 -m-1">
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </Dialog.Close>
          </div>
          <div className="flex-1 overflow-y-auto">{children}</div>
          {footer && <div className="px-5 sm:px-7 py-4 border-t border-line shrink-0">{footer}</div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}

/** Small yes/no dialog for deletes. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel = 'Delete',
  onConfirm,
  isLoading,
  error,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  body: ReactNode
  confirmLabel?: string
  onConfirm: () => void
  isLoading?: boolean
  error?: string | null
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="sm"
      footer={
        <div className="flex justify-end gap-5">
          <button type="button" onClick={() => onOpenChange(false)} className="font-mono uppercase tracking-widest text-xs text-ink-muted hover:text-ink">
            Cancel
          </button>
          <button
            type="button"
            disabled={isLoading}
            onClick={onConfirm}
            className="font-mono uppercase tracking-widest text-xs text-error border border-error px-4 py-2 hover:underline disabled:opacity-50"
          >
            {confirmLabel}
          </button>
        </div>
      }
    >
      <div className="px-5 sm:px-7 py-5 font-mono text-xs text-ink-muted leading-relaxed space-y-3">
        <div>{body}</div>
        {error && <p className="text-error">{error}</p>}
      </div>
    </Modal>
  )
}
