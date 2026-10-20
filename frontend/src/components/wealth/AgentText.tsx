import { Fragment, type ReactNode } from 'react'

// The agent's chat replies: short paragraphs, bullet or numbered lists, and
// **bold**. Nothing else is interpreted (no links, no HTML).

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith('**') && part.endsWith('**') && part.length > 4 ? <strong key={i}>{part.slice(2, -2)}</strong> : <Fragment key={i}>{part}</Fragment>,
  )
}

const BULLET = /^\s*([-•*]|\d+[.)])\s+/

type Block = { kind: 'p'; lines: string[] } | { kind: 'list'; ordered: boolean; start: number; items: string[] }

export function blocks(text: string): Block[] {
  const out: Block[] = []
  for (const para of text.trim().split(/\n\s*\n/)) {
    for (const line of para.split('\n')) {
      if (!line.trim()) continue
      const m = BULLET.exec(line)
      const last = out[out.length - 1]
      if (m) {
        const ordered = /\d/.test(m[1])
        const body = line.slice(m[0].length)
        // A numbered item in its own paragraph continues the list before it.
        if (last?.kind === 'list' && last.ordered === ordered) last.items.push(body)
        else out.push({ kind: 'list', ordered, start: ordered ? parseInt(m[1], 10) : 1, items: [body] })
      } else if (last?.kind === 'list' && /^\s{2,}/.test(line)) {
        last.items[last.items.length - 1] += ` ${line.trim()}`
      } else if (last?.kind === 'p' && !para.startsWith(line)) {
        last.lines.push(line)
      } else {
        out.push({ kind: 'p', lines: [line] })
      }
    }
  }
  return out
}

export function AgentText({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2.5 font-sans text-[13.5px] leading-relaxed text-ink">
      {blocks(text).map((b, i) =>
        b.kind === 'list' ? (
          b.ordered ? (
            <ol key={i} start={b.start} className="list-decimal pl-5 flex flex-col gap-1.5">
              {b.items.map((it, k) => (
                <li key={k}>{inline(it)}</li>
              ))}
            </ol>
          ) : (
            <ul key={i} className="list-disc pl-5 flex flex-col gap-1.5">
              {b.items.map((it, k) => (
                <li key={k}>{inline(it)}</li>
              ))}
            </ul>
          )
        ) : (
          <p key={i} className="m-0">
            {b.lines.map((l, k) => (
              <Fragment key={k}>
                {k > 0 && <br />}
                {inline(l)}
              </Fragment>
            ))}
          </p>
        ),
      )}
    </div>
  )
}
