import { render, screen } from '@testing-library/react'
import { BankLogo } from './BankLogo'

describe('BankLogo', () => {
  it('shows a house for an asset account, whatever the institution', () => {
    render(<BankLogo institution="HDFC Bank" accountType="asset" />)
    expect(screen.getByTestId('asset-icon')).toBeInTheDocument()
    expect(screen.queryByTestId('bank-logo')).not.toBeInTheDocument()
  })

  it("other accounts keep their bank's logo", () => {
    render(<BankLogo institution="HDFC Bank" accountType="savings" />)
    expect(screen.queryByTestId('asset-icon')).not.toBeInTheDocument()
  })
})
