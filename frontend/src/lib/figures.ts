// The agent writes numbers as figure tokens ({final_nominal}) and accounts as
// aliases ("Account A"). These fill both in for the screen; the server does
// the same when it saves a plan (services/agent/narrative.py).

const TOKEN = /\{([a-z_0-9]+(?::[^{}:]+)*)\}/g

export function renderTokens(text: string, figures: Record<string, string>): string {
  return text.replace(TOKEN, (whole, name: string) => figures[name] ?? whole)
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

export function swapAliases(text: string, names: Record<string, string>): string {
  const keys = Object.keys(names)
  if (!keys.length || !text) return text
  // Longest first so "Account AA" isn't caught by "Account A".
  const rx = new RegExp(`\\b(${keys.sort((a, b) => b.length - a.length).map(escape).join('|')})\\b`, 'g')
  return text.replace(rx, (a) => names[a] ?? a)
}

export const show = (text: string, figures: Record<string, string>, names: Record<string, string>) => swapAliases(renderTokens(text, figures), names)
