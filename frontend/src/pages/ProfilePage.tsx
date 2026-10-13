import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useLocation } from 'react-router-dom'
import { Pencil, Trash2 } from 'lucide-react'
import { apiErrorMessage } from '../api/client'
import { authApi } from '../api/endpoints'
import { Button } from '../components/ui/Button'
import { DateField } from '../components/ui/DateField'
import { FormError, Input, PasswordInput, Select } from '../components/ui/Field'
import { ConfirmDialog, Modal } from '../components/ui/Modal'
import { Chip, Loading, Page, PageHeader, Table, td, th } from '../components/ui/Primitives'
import { useAuth } from '../context/AuthContext'
import { useTenant } from '../context/TenantContext'
import { useTagMutations, useTags, useTenantMutations } from '../hooks/queries'
import { cn } from '../lib/cn'
import { formatDate, GENDER_LABELS, todayISO } from '../lib/format'
import { birthDateError, EARLIEST_BIRTH_DATE, emailError, phoneError } from '../lib/validate'
import type { Gender, Tag, Tenant } from '../types/api'

const sectionTitle = 'font-mono text-[10px] font-medium uppercase tracking-widest text-ink-muted'
const iconBtn = 'inline-flex items-center justify-center w-9 h-9 text-ink-muted hover:text-ink focus:outline-none focus-visible:ring-1 focus-visible:ring-ink disabled:opacity-30 disabled:cursor-not-allowed'
const badge = 'font-mono text-[9px] uppercase tracking-widest border border-ink px-1 py-px ml-2 align-middle'
const TAG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/
const MIN_PASSWORD = 6

// ── Details + password ───────────────────────────────────────────────────────

function DetailsSection() {
  const { user, setUser } = useAuth()
  const [form, setForm] = useState({
    first_name: user?.first_name ?? '',
    last_name: user?.last_name ?? '',
    date_of_birth: user?.date_of_birth ?? '',
    gender: user?.gender ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
  })
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [busy, setBusy] = useState(false)
  const [touched, setTouched] = useState<Partial<Record<keyof typeof form, boolean>>>({})
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => {
    setSaved(false)
    setForm((f) => ({ ...f, [key]: e.target.value }))
  }
  const blur = (key: keyof typeof form) => () => setTouched((t) => ({ ...t, [key]: true }))
  const today = todayISO()
  const problems = {
    email: emailError(form.email),
    phone: phoneError(form.phone),
    date_of_birth: birthDateError(form.date_of_birth, today),
  }
  const show = (key: keyof typeof problems) => (touched[key] ? problems[key] : null)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setTouched({ email: true, phone: true, date_of_birth: true })
    if (problems.email || problems.phone || problems.date_of_birth) return
    setError(null)
    setBusy(true)
    try {
      const next = await authApi.updateMe({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        date_of_birth: form.date_of_birth || null,
        gender: (form.gender || null) as Gender | null,
        email: form.email.trim(),
        phone: form.phone.trim() || null,
      })
      setUser(next)
      setSaved(true)
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="border border-line p-5 sm:p-6 flex flex-col gap-6 min-w-0">
      <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
        <h2 className={sectionTitle}>Details</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
          <Input id="p-first" label="First name" value={form.first_name} onChange={set('first_name')} required />
          <Input id="p-last" label="Last name" value={form.last_name} onChange={set('last_name')} required />
          <DateField
            id="p-dob"
            label="Date of birth"
            value={form.date_of_birth}
            onChange={(e) => {
              set('date_of_birth')(e)
              blur('date_of_birth')()
            }}
            min={EARLIEST_BIRTH_DATE}
            max={today}
            error={show('date_of_birth')}
          />
          <Select id="p-gender" label="Gender" value={form.gender} onChange={set('gender')}>
            <option value="">Select…</option>
            {Object.entries(GENDER_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </Select>
        </div>
        <Input id="p-email" label="Email · login" type="email" value={form.email} onChange={set('email')} onBlur={blur('email')} error={show('email')} required />
        <Input
          id="p-phone"
          label="Phone · optional"
          type="tel"
          placeholder="+1 415 555 0123"
          value={form.phone}
          onChange={set('phone')}
          onBlur={blur('phone')}
          error={show('phone')}
          hint="Include the country code, e.g. +91 or +1"
        />
        <FormError message={error} />
        <div className="flex items-center justify-end gap-4">
          {saved && <span className="font-mono text-[11px] text-ink-muted">Saved</span>}
          <Button type="submit" isLoading={busy} disabled={!form.first_name.trim() || !form.last_name.trim() || !form.email.trim()}>
            Save
          </Button>
        </div>
      </form>
      <PasswordForm />
    </section>
  )
}

function PasswordForm() {
  const [form, setForm] = useState({ current: '', next: '', confirm: '' })
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => {
    setDone(false)
    setForm((f) => ({ ...f, [key]: e.target.value }))
  }
  const short = form.next.length > 0 && form.next.length < MIN_PASSWORD
  const mismatch = form.confirm.length > 0 && form.confirm !== form.next
  const ready = form.current && form.next.length >= MIN_PASSWORD && form.confirm === form.next

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready) return
    setError(null)
    setBusy(true)
    try {
      await authApi.changePassword(form.current, form.next)
      setForm({ current: '', next: '', confirm: '' })
      setDone(true)
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not change password'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5 border-t border-line pt-5" noValidate>
      <h2 className={sectionTitle}>Change password</h2>
      <PasswordInput id="pw-current" label="Current password" autoComplete="current-password" value={form.current} onChange={set('current')} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <PasswordInput
          id="pw-new"
          label="New password"
          autoComplete="new-password"
          value={form.next}
          onChange={set('next')}
          hint={`At least ${MIN_PASSWORD} characters`}
          error={short ? `At least ${MIN_PASSWORD} characters` : null}
        />
        <PasswordInput
          id="pw-confirm"
          label="Confirm"
          autoComplete="new-password"
          value={form.confirm}
          onChange={set('confirm')}
          error={mismatch ? "Passwords don't match" : null}
        />
      </div>
      <FormError message={error} />
      <div className="flex items-center justify-end gap-4">
        {done && <span className="font-mono text-[11px] text-ink-muted">Password changed</span>}
        <Button type="submit" variant="primary" isLoading={busy} disabled={!ready}>
          Change password
        </Button>
      </div>
    </form>
  )
}

// ── Tenants ──────────────────────────────────────────────────────────────────

function TenantEditModal({ tenant, onClose }: { tenant: Tenant | null; onClose: () => void }) {
  const { update } = useTenantMutations()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (tenant) {
      setName(tenant.name)
      setDescription(tenant.description ?? '')
      setError(null)
    }
  }, [tenant])

  const save = async () => {
    if (!tenant) return
    setError(null)
    try {
      await update.mutateAsync({
        id: tenant.id,
        ...(tenant.is_default ? {} : { name: name.trim() }),
        description: description.trim() || null,
      })
      onClose()
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save tenant'))
    }
  }

  return (
    <Modal
      open={!!tenant}
      onOpenChange={(o) => !o && onClose()}
      title="Edit tenant"
      size="md"
      footer={
        <div className="flex justify-end gap-5">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} isLoading={update.isPending} disabled={!name.trim()}>
            Save
          </Button>
        </div>
      }
    >
      <div className="px-5 sm:px-7 py-5 flex flex-col gap-5">
        <Input
          id="t-edit-name"
          label="Tenant name"
          value={name}
          maxLength={60}
          onChange={(e) => setName(e.target.value)}
          disabled={tenant?.is_default}
          hint={tenant?.is_default ? "The default tenant's name can't change" : undefined}
        />
        <Input id="t-edit-desc" label="Description · optional" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
        <FormError message={error} />
      </div>
    </Modal>
  )
}

function TenantsSection() {
  const { tenants, tenant: selected, selectTenant, isLoading } = useTenant()
  const { create, remove } = useTenantMutations()
  const location = useLocation()
  const ref = useRef<HTMLElement | null>(null)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)
  const [editing, setEditing] = useState<Tenant | null>(null)
  const [deleting, setDeleting] = useState<Tenant | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  useEffect(() => {
    if (location.hash === '#tenants') ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [location.hash])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setCreateError(null)
    try {
      await create.mutateAsync({ name: name.trim(), description: description.trim() || null })
      setName('')
      setDescription('')
      setAdding(false)
    } catch (err) {
      setCreateError(apiErrorMessage(err, 'Could not create tenant'))
    }
  }

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteError(null)
    try {
      await remove.mutateAsync(deleting.id)
      if (selected?.id === deleting.id) {
        const fallback = tenants.find((t) => t.is_default)
        if (fallback) selectTenant(fallback.id)
      }
      setDeleting(null)
    } catch (err) {
      setDeleteError(apiErrorMessage(err, 'Could not delete tenant'))
    }
  }

  return (
    <section id="tenants" ref={ref} className="flex flex-col gap-4 min-w-0 scroll-mt-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={sectionTitle}>Tenants · {tenants.length}</h2>
        <Button onClick={() => setAdding((a) => !a)} aria-expanded={adding}>
          + New tenant
        </Button>
      </div>

      {adding && (
        <form onSubmit={submit} className="border border-ink p-5 flex flex-col gap-4" noValidate>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_2fr] gap-5">
            <Input id="t-new-name" label="Tenant name" placeholder="e.g. Parents" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            <Input
              id="t-new-desc"
              label="Description · optional"
              placeholder="Whose money this is"
              maxLength={500}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <FormError message={createError} />
          <div className="flex justify-end gap-5">
            <Button
              variant="ghost"
              onClick={() => {
                setAdding(false)
                setCreateError(null)
              }}
            >
              Cancel
            </Button>
            <Button type="submit" isLoading={create.isPending} disabled={!name.trim()}>
              Create
            </Button>
          </div>
        </form>
      )}

      {isLoading ? (
        <Loading />
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Tenant</th>
              <th className={th}>Description</th>
              <th className={cn(th, 'text-right')}>Accounts</th>
              <th className={cn(th, 'text-right')}>Portfolios</th>
              <th className={th}>Created</th>
              <th className={th}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tenants.map((t) => {
              const active = t.id === selected?.id
              const hasData = t.account_count > 0 || t.portfolio_count > 0
              return (
                <tr key={t.id}>
                  <td className={td}>
                    <span className="uppercase tracking-widest font-medium">{t.name}</span>
                    {t.is_default && <span className={badge}>default</span>}
                    {active && <span className={badge}>active</span>}
                  </td>
                  <td className={cn(td, 'text-ink-muted whitespace-normal min-w-[12rem]')}>{t.description ?? '—'}</td>
                  <td className={cn(td, 'text-right num')}>{t.account_count}</td>
                  <td className={cn(td, 'text-right num')}>{t.portfolio_count}</td>
                  <td className={cn(td, 'text-ink-muted')}>{formatDate(t.created_at.slice(0, 10))}</td>
                  <td className={cn(td, 'text-right py-0')}>
                    <div className="inline-flex items-center gap-1">
                      {!active && (
                        <button type="button" onClick={() => selectTenant(t.id)} className="font-mono text-[10px] uppercase tracking-widest text-ink-muted hover:text-ink hover:underline px-2 min-h-9">
                          Use
                        </button>
                      )}
                      <button type="button" className={iconBtn} aria-label={`Edit tenant ${t.name}`} onClick={() => setEditing(t)}>
                        <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                      </button>
                      {!t.is_default && (
                        <button
                          type="button"
                          className={iconBtn}
                          aria-label={`Delete tenant ${t.name}`}
                          title={hasData ? 'Delete its accounts and portfolios first' : undefined}
                          disabled={hasData}
                          onClick={() => {
                            setDeleteError(null)
                            setDeleting(t)
                          }}
                        >
                          <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </Table>
      )}
      <p className="font-mono text-[11px] text-ink-muted">
        Each tenant owns its own accounts, portfolios and history; switch between them from the header. DEFAULT_SELF is created at sign-up and
        can't be deleted.
      </p>

      <TenantEditModal tenant={editing} onClose={() => setEditing(null)} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete tenant"
        body={<>Delete {deleting?.name}? It has no accounts or portfolios left.</>}
        onConfirm={confirmDelete}
        isLoading={remove.isPending}
        error={deleteError}
      />
    </section>
  )
}

// ── Tags ─────────────────────────────────────────────────────────────────────

function TagModal({ open, tag, onClose }: { open: boolean; tag: Tag | null; onClose: () => void }) {
  const { create, update } = useTagMutations()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(tag?.name ?? '')
      setDescription(tag?.description ?? '')
      setError(null)
    }
  }, [open, tag])

  const valid = TAG_RE.test(name)
  const busy = create.isPending || update.isPending

  const save = async () => {
    if (!valid) return
    setError(null)
    try {
      if (tag) await update.mutateAsync({ id: tag.id, name, description: description.trim() || null })
      else await create.mutateAsync({ name, description: description.trim() || null })
      onClose()
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not save tag'))
    }
  }

  return (
    <Modal
      open={open}
      onOpenChange={(o) => !o && onClose()}
      title={tag ? 'Edit tag' : 'New tag'}
      size="md"
      footer={
        <div className="flex justify-end gap-5">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} isLoading={busy} disabled={!valid}>
            Save
          </Button>
        </div>
      }
    >
      <div className="px-5 sm:px-7 py-5 flex flex-col gap-5">
        <Input
          id="tag-name"
          label="Tag name"
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value.toLowerCase())}
          hint="lowercase-hyphenated, e.g. emergency-fund"
          error={name && !valid ? 'Use lowercase letters, digits and single hyphens' : null}
          autoFocus
        />
        <Input id="tag-desc" label="Description · optional" value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} />
        <FormError message={error} />
      </div>
    </Modal>
  )
}

function TagsSection() {
  const { data: tags = [], isLoading } = useTags()
  const { remove, seed } = useTagMutations()
  const [modal, setModal] = useState<{ open: boolean; tag: Tag | null }>({ open: false, tag: null })
  const [deleting, setDeleting] = useState<Tag | null>(null)
  const [error, setError] = useState<string | null>(null)

  const confirmDelete = async () => {
    if (!deleting) return
    setError(null)
    try {
      await remove.mutateAsync(deleting.id)
      setDeleting(null)
    } catch (err) {
      setError(apiErrorMessage(err, 'Could not delete tag'))
    }
  }

  return (
    <section className="flex flex-col gap-4 min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className={sectionTitle}>Tags · {tags.length} · shared by all your tenants</h2>
        <div className="flex items-center gap-5">
          <Button variant="secondary" onClick={() => seed.mutate()} isLoading={seed.isPending}>
            Seed defaults
          </Button>
          <Button onClick={() => setModal({ open: true, tag: null })}>+ New tag</Button>
        </div>
      </div>
      {isLoading ? (
        <Loading />
      ) : tags.length === 0 ? (
        <p className="font-mono text-[11px] text-ink-muted border border-dashed border-line px-4 py-6 text-center">No tags. Seed the defaults or add your own.</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Tag</th>
              <th className={th}>Description</th>
              <th className={cn(th, 'text-right')}>Accounts</th>
              <th className={cn(th, 'text-right')}>Portfolios</th>
              <th className={th}>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {tags.map((t) => (
              <tr key={t.id}>
                <td className={td}>
                  <Chip>{t.name}</Chip>
                </td>
                <td className={cn(td, 'text-ink-muted whitespace-normal min-w-[12rem]')}>{t.description ?? '—'}</td>
                <td className={cn(td, 'text-right num')}>{t.account_count}</td>
                <td className={cn(td, 'text-right num')}>{t.portfolio_count}</td>
                <td className={cn(td, 'text-right py-0')}>
                  <div className="inline-flex items-center gap-1">
                    <button type="button" className={iconBtn} aria-label={`Edit tag ${t.name}`} onClick={() => setModal({ open: true, tag: t })}>
                      <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                    <button
                      type="button"
                      className={iconBtn}
                      aria-label={`Delete tag ${t.name}`}
                      onClick={() => {
                        setError(null)
                        setDeleting(t)
                      }}
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
      <TagModal open={modal.open} tag={modal.tag} onClose={() => setModal({ open: false, tag: null })} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete tag"
        body={<>Delete “{deleting?.name}”? Removes it from every account and portfolio; balances are untouched.</>}
        onConfirm={confirmDelete}
        isLoading={remove.isPending}
        error={error}
      />
    </section>
  )
}

export default function ProfilePage() {
  const { user } = useAuth()
  return (
    <Page>
      <PageHeader
        title="Profile"
        subtitle="Your details, the tenants you track, and the tags you use on accounts and portfolios."
        actions={user ? <span className="font-mono text-xs text-ink-muted">Member since {formatDate(user.created_at.slice(0, 10))}</span> : undefined}
      />
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-8 items-start">
        <DetailsSection />
        <TenantsSection />
      </div>
      <TagsSection />
    </Page>
  )
}
