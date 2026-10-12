import { useState, type FormEvent } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { apiErrorMessage } from '../api/client'
import { LogoMark } from '../components/Logo'
import { Button } from '../components/ui/Button'
import { FormError, Input, Select } from '../components/ui/Field'
import { Tabs } from '../components/ui/Primitives'
import { useAuth } from '../context/AuthContext'
import { GENDER_LABELS } from '../lib/format'

type Mode = 'signin' | 'register'

const MIN_PASSWORD = 6

// Two-panel "ledger front page": halftone masthead on the left, the form on the
// right. Same composition as the Nurav Docs login, minus the OTP step.
export function LoginPage() {
  const [mode, setMode] = useState<Mode>('signin')
  return (
    <div className="min-h-screen bg-paper text-ink flex flex-col lg:flex-row">
      <aside className="relative lg:w-1/2 border-b lg:border-b-0 lg:border-r border-line overflow-hidden">
        <div
          className="halftone-field absolute inset-0 opacity-60"
          aria-hidden="true"
          style={{ backgroundImage: 'radial-gradient(rgb(var(--ink) / 0.18) 1px, transparent 1.2px)', backgroundSize: '14px 14px' }}
        />
        <div className="relative px-6 sm:px-12 py-10 lg:py-16 h-full flex flex-col gap-8">
          <div className="border-y-2 border-ink py-4 bg-paper/80">
            <p className="font-mono text-[10px] uppercase tracking-widest text-ink-muted flex justify-between">
              <span>Vol. I</span>
              <span>Ledger edition</span>
              <span>Private</span>
            </p>
            <h1 className="font-mono font-bold uppercase tracking-brand text-3xl sm:text-5xl text-ink mt-3 flex items-center gap-4">
              <LogoMark width={56} height={38} />
              Nurav·Finance
            </h1>
          </div>
          <div className="hidden sm:grid grid-cols-2 gap-6 bg-paper/80 p-4 border border-line">
            <p className="font-mono text-[11px] leading-relaxed text-ink-muted">
              Every account, every currency, every month — recorded as it was. Balances are appended, never overwritten; backdate
              anything you missed.
            </p>
            <p className="font-mono text-[11px] leading-relaxed text-ink-muted">
              Track yourself, your parents or a household as separate tenants. Portfolios keep dated snapshots, so you can see what
              changed and when.
            </p>
          </div>
        </div>
      </aside>

      <main className="lg:w-1/2 flex items-start lg:items-center justify-center px-6 sm:px-12 py-10">
        <div className="w-full max-w-md flex flex-col gap-6">
          <Tabs
            value={mode}
            onChange={setMode}
            options={[
              { value: 'signin', label: 'Sign in' },
              { value: 'register', label: 'Register' },
            ]}
          />
          {mode === 'signin' ? <SignInForm /> : <RegisterForm />}
        </div>
      </main>
    </div>
  )
}

function useAfterAuth() {
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from
  return () => navigate(from && from !== '/login' ? from : '/accounts', { replace: true })
}

function SignInForm() {
  const { signIn } = useAuth()
  const done = useAfterAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await signIn(email.trim(), password)
      done()
    } catch (err) {
      setError(apiErrorMessage(err, 'Sign in failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <Input id="login-email" label="Email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      <Input
        id="login-password"
        label="Password"
        type="password"
        autoComplete="current-password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      <FormError message={error} />
      <div className="flex justify-end">
        <Button type="submit" isLoading={busy} disabled={!email || !password}>
          Sign in
        </Button>
      </div>
    </form>
  )
}

function RegisterForm() {
  const { register } = useAuth()
  const done = useAfterAuth()
  const [form, setForm] = useState({
    first_name: '',
    last_name: '',
    date_of_birth: '',
    gender: '',
    email: '',
    phone: '',
    password: '',
    confirm: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }))

  const passwordShort = form.password.length > 0 && form.password.length < MIN_PASSWORD
  const mismatch = form.confirm.length > 0 && form.confirm !== form.password
  const ready = form.first_name.trim() && form.last_name.trim() && form.email.trim() && form.password.length >= MIN_PASSWORD && !mismatch && form.confirm

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!ready) return
    setError(null)
    setBusy(true)
    try {
      await register({
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        date_of_birth: form.date_of_birth || null,
        gender: form.gender || null,
        email: form.email.trim(),
        phone: form.phone.trim() || null,
        password: form.password,
      })
      done()
    } catch (err) {
      setError(apiErrorMessage(err, 'Registration failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-5" noValidate>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Input id="reg-first" label="First name" autoComplete="given-name" value={form.first_name} onChange={set('first_name')} required />
        <Input id="reg-last" label="Last name" autoComplete="family-name" value={form.last_name} onChange={set('last_name')} required />
        <Input id="reg-dob" label="Date of birth" type="date" autoComplete="bday" value={form.date_of_birth} onChange={set('date_of_birth')} />
        <Select id="reg-gender" label="Gender" value={form.gender} onChange={set('gender')}>
          <option value="">Select…</option>
          {Object.entries(GENDER_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </Select>
      </div>
      <Input id="reg-email" label="Email · used to sign in" type="email" autoComplete="email" value={form.email} onChange={set('email')} required />
      <Input id="reg-phone" label="Phone" type="tel" autoComplete="tel" value={form.phone} onChange={set('phone')} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <Input
          id="reg-password"
          label="Password"
          type="password"
          autoComplete="new-password"
          value={form.password}
          onChange={set('password')}
          hint={`At least ${MIN_PASSWORD} characters`}
          error={passwordShort ? `At least ${MIN_PASSWORD} characters` : null}
          required
        />
        <Input
          id="reg-confirm"
          label="Confirm password"
          type="password"
          autoComplete="new-password"
          value={form.confirm}
          onChange={set('confirm')}
          error={mismatch ? "Passwords don't match" : null}
          required
        />
      </div>
      <FormError message={error} />
      <div className="flex items-center justify-between gap-4">
        <p className="font-mono text-[10px] text-ink-faint">Creates your DEFAULT_SELF tenant and default tags.</p>
        <Button type="submit" isLoading={busy} disabled={!ready}>
          Create account
        </Button>
      </div>
    </form>
  )
}
