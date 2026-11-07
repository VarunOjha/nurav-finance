// Screenshots chosen in "Add portfolio → From screenshots", handed to the new
// portfolio's snapshot page, which reads them straight away. Memory only — never
// stored; a page reload drops them.

let pending: { portfolioId: string; files: File[] } | null = null

export function handOffScreenshots(portfolioId: string, files: File[]) {
  pending = files.length ? { portfolioId, files } : null
}

/** The screenshots waiting for this portfolio, if any (doesn't clear them). */
export function peekScreenshots(portfolioId: string): File[] | null {
  return pending?.portfolioId === portfolioId ? pending.files : null
}

export function clearScreenshots(portfolioId: string) {
  if (pending?.portfolioId === portfolioId) pending = null
}
