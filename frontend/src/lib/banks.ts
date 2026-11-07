// Well-known banks, brokers and investment platforms. Their logos are bundled
// in frontend/public/banks/<id>.png (downloaded once by
// scripts/fetch_bank_logos.py — the app itself never fetches anything).
// An account's institution / a portfolio's provider is matched against these
// names and aliases; anything else gets an initials tile.
//
// Keep each entry on one line in this exact shape: the fetch script reads
// the id and domain from it.
import logoIds from './bankLogos.json'

export interface Bank {
  id: string
  name: string
  /** Fallback text (2–4 characters) if the logo file is missing. */
  mark: string
  color: string
  /** ISO country it's based in; '' for global platforms. */
  country: string
  domain: string
  aliases: string[]
}

const b = (id: string, name: string, mark: string, color: string, country: string, domain: string, aliases: string[] = []): Bank => ({
  id,
  name,
  mark,
  color,
  country,
  domain,
  aliases,
})

export const BANKS: Bank[] = [
  // India — banks
  b('sbi', 'State Bank of India', 'SBI', '#1F4E9E', 'IN', 'onlinesbi.sbi', ['sbi']),
  b('hdfc', 'HDFC Bank', 'HDFC', '#004C8F', 'IN', 'hdfcbank.com', ['hdfc']),
  b('icici', 'ICICI Bank', 'ICICI', '#AE282E', 'IN', 'icicibank.com', ['icici']),
  b('axis', 'Axis Bank', 'AXIS', '#97144D', 'IN', 'axisbank.com', ['axis']),
  b('kotak', 'Kotak Mahindra Bank', 'KMB', '#C8102E', 'IN', 'kotaksecurities.com', ['kotak', 'kotak securities']),
  b('pnb', 'Punjab National Bank', 'PNB', '#A2195B', 'IN', 'pnbindia.in', ['pnb']),
  b('bob', 'Bank of Baroda', 'BOB', '#C2410C', 'IN', 'bankofbaroda.in', ['bob']),
  b('canara', 'Canara Bank', 'CAN', '#0068AC', 'IN', 'canarabank.com', ['canara']),
  b('union', 'Union Bank of India', 'UBI', '#B91C1C', 'IN', 'unionbankofindia.bank.in', ['union bank']),
  b('indusind', 'IndusInd Bank', 'IIB', '#8B1D2C', 'IN', 'indusind.com', ['indusind']),
  b('yes', 'Yes Bank', 'YES', '#00518F', 'IN', 'yesbank.in'),
  b('idfc', 'IDFC First Bank', 'IDFC', '#9C1D26', 'IN', 'idfcfirst.bank.in', ['idfc', 'idfc first']),
  b('au', 'AU Small Finance Bank', 'AU', '#6A2C91', 'IN', 'au.bank.in', ['au bank']),
  b('federal', 'Federal Bank', 'FED', '#1C3F94', 'IN', 'federalbank.co.in'),
  b('indiapost', 'India Post', 'IPPB', '#B91C1C', 'IN', 'indiapost.gov.in', ['post office', 'india post payments bank']),
  // India — investing
  b('zerodha', 'Zerodha', 'Z', '#2563B0', 'IN', 'zerodha.com', ['kite']),
  b('coin', 'Coin by Zerodha', 'COIN', '#2563B0', 'IN', 'coin.zerodha.com', ['coin']),
  b('groww', 'Groww', 'G', '#047857', 'IN', 'groww.in'),
  b('upstox', 'Upstox', 'UP', '#5A2D82', 'IN', 'upstox.com'),
  b('angelone', 'Angel One', 'A1', '#1E3A8A', 'IN', 'angelone.in', ['angel broking', 'angel']),
  b('indmoney', 'INDmoney', 'IND', '#0F172A', 'IN', 'indmoney.com'),
  b('kuvera', 'Kuvera', 'KUV', '#0E7490', 'IN', 'kuvera.in'),
  b('icicidirect', 'ICICI Direct', 'ICD', '#AE282E', 'IN', 'icicidirect.com', ['icici securities']),
  b('hdfcsec', 'HDFC Securities', 'HSL', '#004C8F', 'IN', 'hdfcsky.com'),
  b('paytmmoney', 'Paytm Money', 'PTM', '#00579E', 'IN', 'paytmmoney.com'),
  // United States — banks
  b('chase', 'Chase', 'JPM', '#0F5BA7', 'US', 'chase.com', ['jpmorgan chase', 'jp morgan chase', 'chase bank']),
  b('bofa', 'Bank of America', 'BofA', '#012169', 'US', 'bankofamerica.com', ['bofa']),
  b('wells', 'Wells Fargo', 'WF', '#B4141E', 'US', 'wellsfargo.com'),
  b('citi', 'Citi', 'citi', '#05609A', 'US', 'citi.com', ['citibank', 'citigroup']),
  b('capone', 'Capital One', 'C1', '#004879', 'US', 'capitalone.com'),
  b('usbank', 'U.S. Bank', 'USB', '#0C2074', 'US', 'usbank.com', ['us bank', 'usbank']),
  b('pnc', 'PNC Bank', 'PNC', '#C2410C', 'US', 'pnc.com', ['pnc']),
  b('amex', 'American Express', 'AMEX', '#0060B0', 'US', 'americanexpress.com', ['amex']),
  // United States — investing
  b('schwab', 'Charles Schwab', 'CS', '#0369A1', 'US', 'schwab.com', ['schwab']),
  b('fidelity', 'Fidelity', 'FID', '#15803D', 'US', 'fidelity.com', ['fidelity investments']),
  b('vanguard', 'Vanguard', 'VG', '#96151D', 'US', 'investor.vanguard.com'),
  b('robinhood', 'Robinhood', 'RH', '#166534', 'US', 'robinhood.com'),
  b('morganstanley', 'Morgan Stanley', 'MS', '#002B51', 'US', 'morganstanley.com'),
  b('wealthfront', 'Wealthfront', 'WF', '#4C3BCF', 'US', 'wealthfront.com'),
  b('betterment', 'Betterment', 'BTR', '#1E40AF', 'US', 'betterment.com'),
  b('etrade', 'E*TRADE', 'E*T', '#5B21B6', 'US', 'etrade.com', ['etrade', 'e trade']),
  b('sofi', 'SoFi', 'SoFi', '#0E7490', 'US', 'sofi.com', ['sofi invest']),
  b('m1', 'M1 Finance', 'M1', '#111827', 'US', 'm1.com', ['m1']),
  b('webull', 'Webull', 'WB', '#1D4ED8', 'US', 'webull.com'),
  b('merrill', 'Merrill', 'ML', '#012169', 'US', 'merrilledge.com', ['merrill edge', 'merrill lynch']),
  // UK & Europe
  b('hsbc', 'HSBC', 'HSBC', '#B91C1C', 'GB', 'hsbc.co.uk'),
  b('barclays', 'Barclays', 'BARC', '#0369A1', 'GB', 'barclays.co.uk'),
  b('lloyds', 'Lloyds Bank', 'LBG', '#006A4D', 'GB', 'lloydsbank.com', ['lloyds']),
  b('natwest', 'NatWest', 'NW', '#42145F', 'GB', 'natwest.com'),
  b('monzo', 'Monzo', 'M', '#14233C', 'GB', 'monzo.com'),
  b('revolut', 'Revolut', 'R', '#191C1F', 'GB', 'revolut.com'),
  b('wise', 'Wise', 'W', '#163300', 'GB', 'wise.com', ['transferwise']),
  b('ing', 'ING', 'ING', '#C2410C', 'NL', 'ing.com'),
  b('db', 'Deutsche Bank', 'DB', '#0018A8', 'DE', 'db.com'),
  b('n26', 'N26', 'N26', '#1F2937', 'DE', 'n26.com'),
  // UAE & Singapore
  b('enbd', 'Emirates NBD', 'ENBD', '#072C5E', 'AE', 'emiratesnbd.com'),
  b('adcb', 'ADCB', 'ADCB', '#B91C1C', 'AE', 'adcb.com', ['abu dhabi commercial bank']),
  b('fab', 'First Abu Dhabi Bank', 'FAB', '#1E3A8A', 'AE', 'bankfab.com', ['fab']),
  b('mashreq', 'Mashreq', 'MSQ', '#C2410C', 'AE', 'mashreq.com', ['mashreq bank']),
  b('dbs', 'DBS Bank', 'DBS', '#B91C1C', 'SG', 'dbs.com.sg', ['dbs', 'posb']),
  b('ocbc', 'OCBC', 'OCBC', '#C2410C', 'SG', 'ocbc.com', ['ocbc bank']),
  b('uob', 'UOB', 'UOB', '#0B3A82', 'SG', 'uobgroup.com', ['united overseas bank']),
  // Global & crypto
  b('ibkr', 'Interactive Brokers', 'IBKR', '#B91C1C', '', 'interactivebrokers.com', ['ibkr', 'interactive brokers']),
  b('saxo', 'Saxo', 'SAXO', '#0F172A', '', 'home.saxo', ['saxo bank']),
  b('etoro', 'eToro', 'eT', '#15803D', '', 'etoro.com'),
  b('coinbase', 'Coinbase', 'CB', '#0052FF', '', 'coinbase.com'),
  b('binance', 'Binance', 'BNB', '#A16207', '', 'binance.com'),
]

/** Bank ids that have a downloaded logo in /banks/<id>.png. */
export const LOGO_FILES = new Set<string>(logoIds as string[])

export const COUNTRY_CURRENCY: Record<string, string> = {
  US: 'USD',
  IN: 'INR',
  SG: 'SGD',
  GB: 'GBP',
  AE: 'AED',
  CA: 'CAD',
  AU: 'AUD',
  DE: 'EUR',
  NL: 'EUR',
  FR: 'EUR',
  JP: 'JPY',
  CH: 'CHF',
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9*]+/g, ' ').trim()
const INDEX = new Map<string, Bank>()
for (const bank of BANKS) for (const key of [bank.name, bank.id, ...bank.aliases]) INDEX.set(norm(key), bank)

/** The known bank an institution name refers to, if any. */
export function findBank(institution: string | null | undefined): Bank | null {
  if (!institution?.trim()) return null
  return INDEX.get(norm(institution)) ?? null
}

/** Up to two initials for a bank that isn't in the list. */
export function initials(name: string): string {
  const all = name.split(/\s+/).filter((w) => /[a-z0-9]/i.test(w))
  const words = all.filter((w) => !/^(bank|of|the|ltd\.?|limited|inc\.?|plc)$/i.test(w))
  const src = words.length ? words : all
  return (
    src
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || '?'
  )
}

export function searchBanks(query: string): Bank[] {
  const q = norm(query)
  if (!q) return BANKS
  return BANKS.filter((bank) => [bank.name, bank.mark, ...bank.aliases].some((k) => norm(k).includes(q)))
}
