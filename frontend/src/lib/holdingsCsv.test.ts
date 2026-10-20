import { HOLDINGS_CSV_TEMPLATE, parseHoldingsCsv } from './holdingsCsv'

const messages = (text: string) => parseHoldingsCsv(text).errors.map((e) => `${e.line ?? '-'}: ${e.message}`)

describe('holdings CSV', () => {
  it('accepts the example template', () => {
    const { holdings, errors } = parseHoldingsCsv(HOLDINGS_CSV_TEMPLATE)
    expect(errors).toEqual([])
    expect(holdings.map((h) => h.symbol)).toEqual(['AAPL', 'VTI', 'VTSAX', 'BTC', 'CASH'])
    expect(holdings[2]).toMatchObject({
      name: 'Vanguard Total Stock Market Index Fund, Admiral',
      asset_class: 'mutual_fund',
      quantity: '1204.337',
      buy_price: '118.40',
      current_price: '142.05',
    })
    expect(holdings[3].buy_price).toBeNull() // blank buy price is allowed
  })

  it('takes columns in any order, aliases, tabs, CRLF and defaults', () => {
    const { holdings, errors } = parseHoldingsCsv('﻿Shares\tTicker\tAvg cost\tPrice\r\n# comment\r\n\r\n3\tmsft\t300\t410.5\r\n')
    expect(errors).toEqual([])
    expect(holdings).toEqual([{ line: 4, symbol: 'MSFT', name: null, asset_class: 'stock', quantity: '3', buy_price: '300', current_price: '410.5' }])
    const noBuyColumn = parseHoldingsCsv('symbol,asset_class,quantity,current_price\nVFIAX,Mutual Fund,1,1').holdings[0]
    expect(noBuyColumn).toMatchObject({ asset_class: 'mutual_fund', buy_price: null })
  })

  it('reports header problems', () => {
    expect(messages('')).toEqual(['-: Paste a header row and at least one holding'])
    expect(messages('symbol,qty,prise\nA,1,1')).toEqual([
      '1: Unknown column "prise" — use symbol, name, asset_class, quantity, buy_price, current_price',
      '1: Missing required column: current_price',
    ])
    expect(messages('symbol,quantity,price,current_price\nA,1,1,1')).toEqual(['1: Column "current_price" appears twice'])
    expect(messages('symbol,quantity,current_price')).toEqual(['-: No holdings below the header row'])
  })

  it('reports every bad row with its line number', () => {
    const csv = [
      'symbol,name,asset_class,quantity,buy_price,current_price',
      'AAPL,Apple,stock,0,1,10',
      'VTI,,fund,1,,$5',
      ',x,,1,,1',
      'MSFT,,,1,-2,1.1234567',
      'A,B,C,D,E,F,G',
    ].join('\n')
    expect(messages(csv)).toEqual([
      '2: Quantity must be greater than 0',
      '3: Asset class "fund" — use one of stock, etf, mutual_fund, bond, cash, crypto, other',
      '3: Current price "$5" isn\'t a plain number (no currency symbols or signs)',
      '4: Symbol is required',
      '5: Buy price "-2" isn\'t a plain number (no currency symbols or signs)',
      '5: Current price allows at most 6 decimal places',
      '6: 7 values but the header has 6 columns — quote values that contain commas',
    ])
  })

  it('rejects duplicate symbols case-insensitively', () => {
    expect(messages('symbol,quantity,current_price\naapl,1,1\nAAPL,2,2')).toEqual(['3: AAPL already appears on line 2 — each symbol once per snapshot'])
  })
})
