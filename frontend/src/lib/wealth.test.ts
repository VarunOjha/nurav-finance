import fixture from '../test/wealthVersion.json'
import type { AgentEvent, WealthVersion } from '../types/api'
import { actionableDraft, chatReducer, INITIAL, type ChatState } from './agentChat'
import { sseParser } from './agentStream'
import { renderTokens, show, swapAliases } from './figures'
import { answerOf, answerShort, contributionText, mainLine } from '../components/wealth/potView'
import { blocks } from '../components/wealth/AgentText'

const version = fixture.version as unknown as WealthVersion
const run = (events: AgentEvent[], s: ChatState = INITIAL) => events.reduce((acc, e) => chatReducer(acc, { type: 'event', event: e }), s)

describe('figures and aliases', () => {
  it('fills tokens and swaps aliases, longest first', () => {
    expect(renderTokens('{final_nominal} by {end_year}, {nope}', { final_nominal: '$6.4M', end_year: '2056' })).toBe('$6.4M by 2056, {nope}')
    expect(swapAliases('Account A and Account AA', { 'Account A': 'Chase', 'Account AA': 'Ally' })).toBe('Chase and Ally')
    expect(show(version.narrative!.insights.at(-1)!, version.figures, fixture.aliases)).toBe('Fidelity 401k does most of the work.')
  })
})

describe('SSE parser', () => {
  it('handles events split across chunks and skips comments', () => {
    const got: AgentEvent[] = []
    const feed = sseParser((e) => got.push(e))
    feed(': OPENROUTER PROCESSING\n\ndata: {"type":"te')
    feed('xt","delta":"Hi"}\n\ndata: {"type":"status","text":"x"}\n')
    expect(got).toEqual([{ type: 'text', delta: 'Hi' }])
    feed('\n')
    expect(got).toHaveLength(2)
  })
})

describe('chat state', () => {
  it('streams text into one reply, then a draft, and keeps the transcript the server returns', () => {
    let s = chatReducer(INITIAL, { type: 'send', text: 'I want $10M' })
    s = run(
      [
        { type: 'aliases', map: { 'Account A': 'Chase' } },
        { type: 'text', delta: 'Which ' },
        { type: 'text', delta: 'mode?' },
        { type: 'draft', draft: version.draft },
        { type: 'text', delta: '\n\nPress Approve & run.' },
        { type: 'usage', cost: 0.01, today: 0.5, cap: 5 },
        { type: 'done', messages: [{ role: 'user', content: 'I want $10M' }, { role: 'assistant', content: 'Which mode?' }] },
      ],
      s,
    )
    expect(s.feed.map((f) => f.kind)).toEqual(['user', 'agent', 'draft', 'agent'])
    expect(s.feed[1]).toMatchObject({ text: 'Which mode?' })
    expect(s.feed[3]).toMatchObject({ text: 'Press Approve & run.' })
    expect(s.transcript).toHaveLength(2)
    expect(s.busy).toBe(false)
    expect(s.chatCost).toBe(0.01)
    expect(actionableDraft(s)?.id).toBe('d1')
  })

  it('an approval adds a version, then its report with the summary rendered', () => {
    let s = run([{ type: 'draft', draft: version.draft }])
    s = chatReducer(s, { type: 'approve', draft: version.draft })
    expect(s.busy).toBe('approve')
    s = run([{ type: 'version', version: { ...version, narrative: null } }], s)
    expect(actionableDraft(s)).toBeNull()
    expect(s.approved.d1).toBe(1)
    s = run([{ type: 'report', n: 1, narrative: version.narrative! }, { type: 'done', messages: [] }], s)
    expect(s.versions[0].narrative).not.toBeNull()
    const summary = s.feed.find((f) => f.kind === 'agent')
    expect(summary).toMatchObject({ text: `Version ready, starting from ${version.figures['start:USD']}. The report is on the right.` })
    expect(s.feed.at(-1)).toMatchObject({ kind: 'suggestions' })
  })
})

describe('pot answers from server results', () => {
  const t = { asOf: version.draft.as_of, birth: version.draft.birth_date }
  const [usd, inr] = version.pots
  const [pUsd, pInr] = version.draft.params.pots

  it('words each pot’s answer from its own unknown', () => {
    const a = answerOf(usd, pUsd, t, 3)
    expect(a.q).toBe('When you reach $5M')
    expect(a.v).toMatch(/^[A-Z][a-z]{2} 20\d\d · age \d+$/)
    expect(answerShort(inr, t)).toBe(version.figures['final:INR'])
    expect(answerOf(inr, pInr, t, 3).sub).toContain('short of the target')
  })

  it('marks the approved return among the three and words contributions', () => {
    expect(usd.lines.map((l) => l.label)).toEqual(['6%', '8%', '10%'])
    expect(mainLine(usd, pUsd)).toBe(1)
    expect(mainLine(inr, pInr)).toBe(1)
    expect(contributionText(pUsd.contribution, 'USD')).toBe('+$10K/yr for 10 yrs')
    expect(contributionText(null, 'USD')).toBe('none')
  })

  it('carries the segment checks the server made', () => {
    const cash = inr.segments!.find((s) => s.name === 'Cash')!
    expect(cash.reaches).toBe(false)
    expect(cash.required!.value).toBeGreaterThan(0)
  })
})

describe('agent text', () => {
  it('keeps numbered items in separate paragraphs as one list', () => {
    const b = blocks('Intro\n\n1. **One**\n\n2. Two\n   more\n\nOutro')
    expect(b.map((x) => x.kind)).toEqual(['p', 'list', 'p'])
    expect(b[1]).toMatchObject({ ordered: true, start: 1, items: ['**One**', 'Two more'] })
  })
})
