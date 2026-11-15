import { Fragment, type ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useAccount, useInquiry, usePortfolio } from '../hooks/queries'
import { inquiryDate } from '../lib/estimator'
import { cn } from '../lib/cn'

const SECTIONS: Record<string, string> = { dashboard: 'Dashboard', accounts: 'Accounts', portfolios: 'Portfolios', analytics: 'Analytics', metrics: 'Metrics', estimator: 'Wealth estimator' }

interface Crumb {
  key: string
  label: ReactNode
  to?: string // absent on the current page
}

const crumbText = 'font-mono text-xs uppercase tracking-widest truncate'

// Names come from the same query cache the page uses, so no extra requests.
function AccountName({ id }: { id: string }) {
  const { data, error } = useAccount(id)
  return <>{data?.name ?? (error ? 'Not found' : '…')}</>
}

function PortfolioName({ id }: { id: string }) {
  const { data, error } = usePortfolio(id)
  return <>{data?.name ?? (error ? 'Not found' : '…')}</>
}

function InquiryName({ id }: { id: string }) {
  const { data, error } = useInquiry(id)
  return <>{data ? inquiryDate(data.created_at) : error ? 'Not found' : '…'}</>
}

/** The trail after the workspace switcher, from the current path. */
export function crumbsFor(pathname: string): Crumb[] {
  const [section, id, sub, subId] = pathname.split('/').filter(Boolean)
  const title = section ? SECTIONS[section] : undefined
  if (!section || !title) return []
  const crumbs: Crumb[] = [{ key: section, label: title, to: `/${section}` }]
  if (id && section === 'accounts') crumbs.push({ key: id, label: <AccountName id={id} />, to: `/accounts/${id}` })
  if (id && section === 'portfolios') crumbs.push({ key: id, label: <PortfolioName id={id} />, to: `/portfolios/${id}` })
  if (id && section === 'estimator') crumbs.push({ key: id, label: <InquiryName id={id} />, to: `/estimator/${id}` })
  if (section === 'portfolios' && sub === 'snapshots' && subId === 'new') crumbs.push({ key: 'new', label: 'Record holdings' })
  if (section === 'accounts' && sub === 'portfolio' && subId === 'new') crumbs.push({ key: 'new', label: 'Add portfolio' })
  delete crumbs[crumbs.length - 1].to // the last crumb is where you are
  return crumbs
}

// Workspace bar trail: Workspace ▾ / Accounts / HDFC Savings. Every crumb but the
// last links up the hierarchy.
export function Breadcrumbs() {
  const { pathname } = useLocation()
  const crumbs = crumbsFor(pathname)
  if (crumbs.length === 0) return null
  return (
    <nav aria-label="Breadcrumb" className="min-w-0">
      <ol className="flex items-center gap-2 min-w-0">
        {crumbs.map((c) => (
          <Fragment key={c.key}>
            <li aria-hidden="true" className="font-mono text-xs text-ink-faint shrink-0">
              /
            </li>
            <li className={cn('min-w-0', c.to ? 'shrink' : 'shrink-[0.5]')}>
              {c.to ? (
                <Link to={c.to} className={cn(crumbText, 'block text-ink-muted hover:text-ink hover:underline focus:outline-none focus-visible:underline')}>
                  {c.label}
                </Link>
              ) : (
                <span aria-current="page" className={cn(crumbText, 'block text-ink font-medium')}>
                  {c.label}
                </span>
              )}
            </li>
          </Fragment>
        ))}
      </ol>
    </nav>
  )
}
