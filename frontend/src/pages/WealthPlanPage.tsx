import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { apiErrorMessage } from '../api/client'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Field'
import { ConfirmDialog, Modal } from '../components/ui/Modal'
import { ErrorBox, Loading, Page, PageHeader } from '../components/ui/Primitives'
import { WealthReport } from '../components/wealth/WealthReport'
import { useWealthMutations, useWealthPlan } from '../hooks/queries'
import { formatDateTime } from '../lib/format'

const NO_NAMES: Record<string, string> = {}

/** A saved plan: the version exactly as it was approved (names were rendered when it was saved). */
export default function WealthPlanPage() {
  const { planId } = useParams()
  const navigate = useNavigate()
  const plan = useWealthPlan(planId ?? null)
  const { rename, remove } = useWealthMutations()
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [name, setName] = useState('')

  if (plan.isLoading) return <Loading />
  if (plan.error || !plan.data) return <Page><ErrorBox message={apiErrorMessage(plan.error, 'Plan not found')} /></Page>
  const p = plan.data

  return (
    <Page>
      <PageHeader
        back={
          <Link to="/wealth/plans" className="font-mono text-[10px] uppercase tracking-widest text-ink-muted hover:text-ink print:hidden">
            ← Saved plans
          </Link>
        }
        title={p.name}
        subtitle={`Saved ${formatDateTime(p.created_at)} · frozen · ${p.model}`}
        actions={
          <div className="flex flex-wrap gap-4 print:hidden">
            <Button
              variant="secondary"
              onClick={() => {
                setName(p.name)
                rename.reset()
                setRenaming(true)
              }}
            >
              Rename
            </Button>
            <Button variant="secondary" onClick={() => window.print()}>
              Print PDF
            </Button>
            <Button variant="danger" onClick={() => setDeleting(true)}>
              Delete
            </Button>
          </div>
        }
      />
      <WealthReport version={p.report} names={NO_NAMES} />

      <Modal
        open={renaming}
        onOpenChange={setRenaming}
        title="Rename plan"
        footer={
          <div className="flex justify-end gap-4">
            <Button variant="secondary" onClick={() => setRenaming(false)}>
              Cancel
            </Button>
            <Button isLoading={rename.isPending} disabled={!name.trim()} onClick={() => rename.mutate({ id: p.id, name: name.trim() }, { onSuccess: () => setRenaming(false) })}>
              Save
            </Button>
          </div>
        }
      >
        <div className="px-5 sm:px-7 py-5">
          <Input id="rename" label="Plan name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus error={rename.error ? apiErrorMessage(rename.error) : null} />
        </div>
      </Modal>
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title="Delete this plan?"
        body={`“${p.name}” will be removed.`}
        isLoading={remove.isPending}
        error={remove.error ? apiErrorMessage(remove.error) : null}
        onConfirm={() => remove.mutate(p.id, { onSuccess: () => navigate('/wealth/plans', { replace: true }) })}
      />
    </Page>
  )
}
