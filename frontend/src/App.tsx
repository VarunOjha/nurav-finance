import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import { AppLayout } from './components/AppLayout'
import { Loading } from './components/ui/Primitives'
import { useAuth } from './context/AuthContext'
import { TenantProvider } from './context/TenantContext'
import { LoginPage } from './pages/LoginPage'

// Charts (recharts) only load with the pages that draw them.
const AccountsPage = lazy(() => import('./pages/AccountsPage'))
const AccountDetailPage = lazy(() => import('./pages/AccountDetailPage'))
const PortfoliosPage = lazy(() => import('./pages/PortfoliosPage'))
const PortfolioDetailPage = lazy(() => import('./pages/PortfolioDetailPage'))
const SnapshotPage = lazy(() => import('./pages/SnapshotPage'))
const AnalyticsPage = lazy(() => import('./pages/AnalyticsPage'))
const ProfilePage = lazy(() => import('./pages/ProfilePage'))

function RequireAuth() {
  const { user } = useAuth()
  const location = useLocation()
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return (
    <TenantProvider>
      <AppLayout />
    </TenantProvider>
  )
}

const page = (el: JSX.Element) => <Suspense fallback={<div className="max-w-7xl mx-auto px-4 sm:px-8"><Loading /></div>}>{el}</Suspense>

export default function App() {
  const { user } = useAuth()
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/accounts" replace /> : <LoginPage />} />
      <Route element={<RequireAuth />}>
        <Route index element={<Navigate to="/accounts" replace />} />
        <Route path="/accounts" element={page(<AccountsPage />)} />
        <Route path="/accounts/:accountId" element={page(<AccountDetailPage />)} />
        <Route path="/portfolios" element={page(<PortfoliosPage />)} />
        <Route path="/portfolios/:portfolioId" element={page(<PortfolioDetailPage />)} />
        <Route path="/portfolios/:portfolioId/snapshots/new" element={page(<SnapshotPage />)} />
        <Route path="/analytics" element={page(<AnalyticsPage />)} />
        <Route path="/profile" element={page(<ProfilePage />)} />
        <Route path="*" element={<Navigate to="/accounts" replace />} />
      </Route>
    </Routes>
  )
}
