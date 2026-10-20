import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { formatNotes, refChain, RefMode } from './RefMode'

describe('RefMode', () => {
  beforeEach(() => localStorage.clear())

  it('walks distinct refs from the clicked element outwards', () => {
    document.body.innerHTML = `
      <section data-ref="Page · src/pages/A.tsx:10">
        <div data-ref="Card · src/c/Card.tsx:4"><span data-ref="Card · src/c/Card.tsx:4"><b id="t">x</b></span></div>
      </section>`
    expect(refChain(document.getElementById('t')).map((el) => el.getAttribute('data-ref'))).toEqual([
      'Card · src/c/Card.tsx:4',
      'Page · src/pages/A.tsx:10',
    ])
  })

  it('captures a note on a clicked element instead of operating it', async () => {
    const user = userEvent.setup()
    const onAppClick = vi.fn()
    render(
      <MemoryRouter initialEntries={['/portfolios/p1']}>
        <RefMode />
        <button data-ref="PortfolioDetailPage · src/pages/PortfolioDetailPage.tsx:120" onClick={onAppClick}>
          Record snapshot
        </button>
      </MemoryRouter>,
    )
    await user.click(screen.getByRole('button', { name: /Ref/ }))
    fireEvent.click(screen.getByText('Record snapshot'))
    expect(onAppClick).not.toHaveBeenCalled()

    await user.type(screen.getByPlaceholderText('What should change here?'), 'Make this the primary action')
    await user.click(screen.getByRole('button', { name: /Add note/ }))
    expect(screen.getByLabelText('Ref notes')).toHaveTextContent('Make this the primary action')

    const saved = JSON.parse(localStorage.getItem('nurav-ref-notes') ?? '[]')
    expect(formatNotes(saved)).toContain(
      [
        '1. PortfolioDetailPage · src/pages/PortfolioDetailPage.tsx:120',
        '   element: <button> "Record snapshot"',
        '   page: /portfolios/p1',
        '   → Make this the primary action',
      ].join('\n'),
    )
  })
})
