// Wealth Agent chat state: what the server needs back (`transcript`) and what
// the screen shows (`feed`, drafts, versions). A pure reducer over the stream
// events, so the whole flow is testable without a network. Nothing here is
// persisted: the chat is gone when the page is left.

import type { AgentEvent, ChatMessage, Narrative, WealthDraft, WealthVersion } from '../types/api'
import { renderTokens } from './figures'

export type FeedItem =
  | { kind: 'user'; id: number; text: string }
  | { kind: 'agent'; id: number; text: string }
  | { kind: 'draft'; id: number; draftId: string }
  | { kind: 'approved'; id: number; draftId: string }
  | { kind: 'version'; id: number; n: number }
  | { kind: 'error'; id: number; text: string }
  | { kind: 'suggestions'; id: number; items: string[] }

export interface ChatState {
  transcript: ChatMessage[]
  feed: FeedItem[]
  aliases: Record<string, string>
  drafts: WealthDraft[]
  versions: WealthVersion[]
  /** Draft id -> version number it ran as. */
  approved: Record<string, number>
  /** Version number -> saved plan id. */
  saved: Record<number, string>
  busy: false | 'turn' | 'approve'
  status: string | null
  chatCost: number
  today: number | null
  cap: number | null
  /** The agent text item still receiving deltas, if any. */
  open: number | null
  nextId: number
}

export const INITIAL: ChatState = {
  transcript: [],
  feed: [],
  aliases: {},
  drafts: [],
  versions: [],
  approved: {},
  saved: {},
  busy: false,
  status: null,
  chatCost: 0,
  today: null,
  cap: null,
  open: null,
  nextId: 1,
}

export type ChatAction =
  | { type: 'send'; text: string }
  | { type: 'approve'; draft: WealthDraft }
  | { type: 'event'; event: AgentEvent }
  | { type: 'failed'; message: string }
  | { type: 'saved'; n: number; planId: string }
  | { type: 'reset' }

// Omit over each member of the union (a plain Omit would merge them).
type OmitEach<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never
type NewItem = OmitEach<FeedItem, 'id'>

function push(s: ChatState, item: NewItem): ChatState {
  return { ...s, feed: [...s.feed, { ...item, id: s.nextId } as FeedItem], nextId: s.nextId + 1, open: null }
}

export function chatReducer(s: ChatState, a: ChatAction): ChatState {
  switch (a.type) {
    case 'reset':
      return INITIAL
    case 'send':
      return { ...push(s, { kind: 'user', text: a.text }), busy: 'turn', status: null }
    case 'approve':
      return { ...push(s, { kind: 'approved', draftId: a.draft.id }), busy: 'approve', status: null }
    case 'failed':
      return { ...push(s, { kind: 'error', text: a.message }), busy: false, status: null }
    case 'saved':
      return { ...s, saved: { ...s.saved, [a.n]: a.planId } }
    case 'event':
      return onEvent(s, a.event)
  }
}

function onEvent(s: ChatState, e: AgentEvent): ChatState {
  switch (e.type) {
    case 'aliases':
      return { ...s, aliases: { ...s.aliases, ...e.map } }
    case 'text': {
      const last = s.feed[s.feed.length - 1]
      if (s.open !== null && last?.id === s.open && last.kind === 'agent') {
        return { ...s, status: null, feed: [...s.feed.slice(0, -1), { ...last, text: last.text + e.delta }] }
      }
      const text = e.delta.replace(/^\s+/, '')
      if (!text) return s
      const next = push(s, { kind: 'agent', text })
      return { ...next, open: s.nextId, status: null }
    }
    case 'status':
      return { ...s, status: e.text, open: null }
    case 'draft':
      return push({ ...s, drafts: [...s.drafts, e.draft] }, { kind: 'draft', draftId: e.draft.id })
    case 'version': {
      const v = e.version
      const n = v.n as number
      return push({ ...s, versions: [...s.versions, v], approved: { ...s.approved, [v.draft.id]: n } }, { kind: 'version', n })
    }
    case 'report':
      return withReport(s, e.n, e.narrative)
    case 'usage':
      return { ...s, chatCost: s.chatCost + (e.cost || 0), today: e.today, cap: e.cap }
    case 'error':
      return push(s, { kind: 'error', text: e.message })
    case 'done':
      return { ...s, transcript: [...s.transcript, ...e.messages], busy: false, status: null, open: null }
  }
}

function withReport(s: ChatState, n: number, narrative: Narrative): ChatState {
  const versions = s.versions.map((v) => (v.n === n ? { ...v, narrative } : v))
  const v = versions.find((x) => x.n === n)
  let next: ChatState = { ...s, versions }
  if (v) next = push(next, { kind: 'agent', text: renderTokens(narrative.chat_summary, v.figures) })
  if (narrative.follow_ups.length) next = push(next, { kind: 'suggestions', items: narrative.follow_ups })
  return next
}

/** The draft the person can still approve: the newest one, unless it already ran. */
export function actionableDraft(s: ChatState): WealthDraft | null {
  const last = s.drafts[s.drafts.length - 1]
  return last && !(last.id in s.approved) ? last : null
}
