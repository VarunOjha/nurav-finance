import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useSearchParams } from 'react-router-dom'
import * as Popover from '@radix-ui/react-popover'
import { BarChart3, Compass, Landmark, Menu, Palette, UserCircle } from 'lucide-react'
import { Logo } from './Logo'
import { TenantSwitcher } from './TenantSwitcher'
import { ThemePicker } from './ThemePicker'
import { RefMode } from './RefMode'
import { useAuth } from '../context/AuthContext'
import type { ProfileSection } from './ProfileModal'

const ProfileModal = lazy(() => import('./ProfileModal'))

const NAV = [
  { to: '/accounts', label: 'Accounts', icon: Landmark },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/wealth', label: 'Wealth Agent', icon: Compass },
] as const

// Baked in at image build time (--build-arg APP_VERSION=v1.0.0); local builds show "dev".
const APP_VERSION: string = import.meta.env.VITE_APP_VERSION || 'dev'

// App shell — header (menu, logo, user menu) with the tenant bar under it, slide-in nav
// drawer scoped to the content area, and footer. Same structure as Nurav Docs.
export function AppLayout() {
  const { user, signOut } = useAuth()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [userOpen, setUserOpen] = useState(false)
  const [themeOpen, setThemeOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)
  const location = useLocation()
  const [params, setParams] = useSearchParams()

  // Profile is a modal over the current page, driven by ?profile (or
  // ?profile=tenants) so it survives reloads, works as a link and Back closes it.
  const profileParam = params.get('profile')
  const profileOpen = profileParam !== null
  const openProfile = (section: ProfileSection = null) => {
    setDrawerOpen(false)
    setParams((p) => {
      p.set('profile', section ?? '')
      return p
    })
  }
  const closeProfile = () =>
    setParams(
      (p) => {
        p.delete('profile')
        return p
      },
      { replace: true },
    )

  // Navigating closes the drawer — it overlays the content it just changed.
  useEffect(() => {
    setDrawerOpen(false)
  }, [location.pathname])

  // Escape closes the drawer and returns focus to the menu button.
  useEffect(() => {
    if (!drawerOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      setDrawerOpen(false)
      menuButtonRef.current?.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [drawerOpen])

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-3.5 px-6 py-4 font-mono text-sm uppercase tracking-widest transition-colors focus:outline-none ${
      isActive ? 'text-ink bg-paper-warm' : 'text-ink-muted hover:text-ink'
    }`

  return (
    <div className="h-screen bg-paper text-ink flex flex-col">
      <header className="shrink-0 z-30 bg-paper border-b border-line">
        <div className="px-3 sm:px-8 py-4 sm:py-5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 sm:gap-5 min-w-0">
            <button
              ref={menuButtonRef}
              onClick={() => setDrawerOpen((prev) => !prev)}
              aria-label={drawerOpen ? 'Close navigation' : 'Open navigation'}
              aria-expanded={drawerOpen}
              className="text-ink-muted hover:text-ink focus:outline-none p-1"
            >
              <Menu className="w-7 h-7" aria-hidden="true" />
            </button>
            <NavLink to="/accounts" className="focus:outline-none hidden sm:inline-flex">
              <Logo size="lg" />
            </NavLink>
            <NavLink to="/accounts" className="focus:outline-none sm:hidden" aria-label="Nurav Finance home">
              <Logo size="sm" />
            </NavLink>
          </div>

          <div className="flex items-center gap-3 sm:gap-4 shrink-0">
            <RefMode />
            <Popover.Root open={themeOpen} onOpenChange={setThemeOpen}>
              <Popover.Trigger asChild>
                <button aria-label="Theme" title="Theme" className="text-ink-muted hover:text-ink focus:outline-none p-1">
                  <Palette className="w-6 h-6" aria-hidden="true" />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content align="end" sideOffset={8} className="z-50 w-72 bg-paper border border-line p-2 max-h-[80vh] overflow-y-auto">
                  <p className="px-2 pt-1 pb-2 font-mono text-[10px] uppercase tracking-widest text-ink-muted">Theme</p>
                  <ThemePicker />
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>

            <Popover.Root open={userOpen} onOpenChange={setUserOpen}>
              <Popover.Trigger asChild>
                <button aria-label="User menu" className="text-ink-muted hover:text-ink focus:outline-none shrink-0">
                  <UserCircle className="w-8 h-8" aria-hidden="true" />
                </button>
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Content align="end" sideOffset={8} className="z-50 w-52 bg-paper border border-line p-2">
                  <div className="px-2 py-1.5 mb-1">
                    <p className="font-mono text-xs text-ink truncate">
                      {user?.first_name} {user?.last_name}
                    </p>
                    <p className="font-mono text-[10px] text-ink-muted mt-0.5 truncate">{user?.email}</p>
                  </div>
                  <div className="border-t border-line pt-1">
                    <button
                      onClick={() => {
                        setUserOpen(false)
                        openProfile()
                      }}
                      className="w-full text-left px-2 py-1.5 font-mono uppercase tracking-widest text-xs text-ink-muted hover:text-ink hover:underline focus:outline-none"
                    >
                      Profile
                    </button>
                    <button
                      onClick={() => {
                        setUserOpen(false)
                        signOut()
                      }}
                      className="w-full text-left px-2 py-1.5 font-mono uppercase tracking-widest text-xs text-ink-muted hover:text-ink hover:underline focus:outline-none"
                    >
                      Sign Out
                    </button>
                  </div>
                </Popover.Content>
              </Popover.Portal>
            </Popover.Root>
          </div>
        </div>
        {/* Tenant bar — everything below follows the selected tenant */}
        <div className="border-t border-line px-3 sm:px-8 py-1 flex items-center min-w-0">
          <TenantSwitcher />
        </div>
      </header>

      {/* Content area — the drawer is scoped here, never over header or footer */}
      <div className="flex-1 relative overflow-hidden">
        {drawerOpen && <div className="absolute inset-0 z-10 bg-ink/30" aria-hidden="true" onClick={() => setDrawerOpen(false)} />}

        <div
          role="navigation"
          aria-label="Main navigation"
          className={`absolute inset-y-0 left-0 z-20 w-72 max-w-[80vw] bg-paper border-r border-line flex flex-col transform transition-transform duration-200 ease-in-out ${
            drawerOpen ? 'translate-x-0' : '-translate-x-full invisible'
          }`}
        >
          <nav className="flex-1 py-4 overflow-y-auto">
            {NAV.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className={linkClass}>
                <Icon className="w-5 h-5 shrink-0" aria-hidden="true" />
                {label}
              </NavLink>
            ))}
          </nav>
        </div>

        <main className="h-full overflow-y-auto">
          <Outlet />
        </main>
        {profileOpen && (
          <Suspense fallback={null}>
            <ProfileModal open onOpenChange={(o) => !o && closeProfile()} section={profileParam === 'tenants' ? 'tenants' : null} />
          </Suspense>
        )}
      </div>

      <footer className="shrink-0 border-t border-line bg-paper">
        <div className="max-w-7xl mx-auto px-4 sm:px-8 py-4 sm:py-5 flex flex-wrap items-center justify-between gap-3">
          <Logo size="md" />
          <p className="font-mono text-xs text-ink-faint">{APP_VERSION} · personal project by Varun Ojha · 2026</p>
        </div>
      </footer>
    </div>
  )
}
