import { Link } from 'react-router-dom'
import { Empty, ErrorBox, Loading, Page, PageHeader, Table, td, th } from '../components/ui/Primitives'
import { SOLVE_LABEL } from '../components/wealth/potView'
import { useWealthPlans } from '../hooks/queries'
import { apiErrorMessage } from '../api/client'
import { cn } from '../lib/cn'
import { formatDate, money } from '../lib/format'

export default function WealthPlansPage() {
  const plans = useWealthPlans()
  return (
    <Page>
      <PageHeader
        back={
          <Link to="/wealth" className="font-mono text-[10px] uppercase tracking-widest text-ink-muted hover:text-ink">
            ← Wealth Agent
          </Link>
        }
        title="Saved plans"
        subtitle="Versions you approved and saved, frozen as they were"
      />
      {plans.isLoading ? (
        <Loading />
      ) : plans.error ? (
        <ErrorBox message={apiErrorMessage(plans.error)} />
      ) : !plans.data?.length ? (
        <Empty title="No saved plans yet">
          <Link to="/wealth" className="underline hover:text-ink">
            Plan with the Wealth Agent
          </Link>
        </Empty>
      ) : (
        <Table>
          <thead>
            <tr>
              <th className={th}>Plan</th>
              <th className={th}>As of</th>
              <th className={th}>Pot</th>
              <th className={th}>Question</th>
              <th className={cn(th, 'text-right')}>Starts</th>
              <th className={cn(th, 'text-right')}>Answer</th>
            </tr>
          </thead>
          <tbody>
            {plans.data.flatMap((p) =>
              p.pots.map((pot, i) => (
                <tr key={`${p.id}-${pot.currency}`}>
                  <td className={cn(td, i > 0 && 'border-t-0')}>
                    {i === 0 && (
                      <Link to={`/wealth/plans/${p.id}`} className="hover:underline font-bold">
                        {p.name}
                      </Link>
                    )}
                  </td>
                  <td className={td}>{i === 0 ? formatDate(p.as_of) : ''}</td>
                  <td className={td}>{pot.currency}</td>
                  <td className={td}>{SOLVE_LABEL[pot.solve_for]}</td>
                  <td className={cn(td, 'text-right num')}>{money(pot.start, pot.currency, { compact: true })}</td>
                  <td className={cn(td, 'text-right num font-bold')}>{pot.answer}</td>
                </tr>
              )),
            )}
          </tbody>
        </Table>
      )}
    </Page>
  )
}
