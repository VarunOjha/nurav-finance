import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Check, Loader2 } from 'lucide-react'
import { apiErrorMessage } from '../api/client'
import { AgentText } from '../components/wealth/AgentText'
import { CompareVersions } from '../components/wealth/CompareVersions'
import { Composer } from '../components/wealth/Composer'
import { DraftCard } from '../components/wealth/DraftCard'
import { StartScreen } from '../components/wealth/StartScreen'
import { WealthReport } from '../components/wealth/WealthReport'
import { Input } from '../components/ui/Field'
import { Modal, ConfirmDialog } from '../components/ui/Modal'
import { Button } from '../components/ui/Button'
import { useTenant } from '../context/TenantContext'
import { useAgentStatus, useWealthMutations } from '../hooks/queries'
import { actionableDraft, chatReducer, INITIAL, type ChatState, type FeedItem } from '../lib/agentChat'
import { AgentRequestError, streamAgent } from '../lib/agentStream'
import { swapAliases } from '../lib/figures'
import { cn } from '../lib/cn'
import type { AgentEvent, WealthDraft, WealthPrefs } from '../types/api'

const NO_PREFS: WealthPrefs = { solve_for: null, horizon_years: null, horizon_age: null, risk_appetite: null }
const cap = 'font-mono text-[10px] uppercase tracking-widest text-ink-muted'
const usd = (n: number) => `$${n.toFixed(2)}`

/**
 * The Wealth Agent: a start screen, then chat on the left and the report
 * canvas on the right (tabs on a phone). The conversation lives only in this
 * page's memory: leaving it, or "New chat", clears it.
 */
export default function WealthAgentPage() {
  const status = useAgentStatus()
  const { tenantId } = useTenant()
  const qc = useQueryClient()
  const [chat, dispatch] = useReducer(chatReducer, INITIAL)
  const [prefs, setPrefs] = useState<WealthPrefs>(NO_PREFS)
  const [text, setText] = useState('')
  const [pane, setPane] = useState<'chat' | 'report'>('chat')
  const [confirmNew, setConfirmNew] = useState(false)
  const abort = useRef<AbortController | null>(null)
  const chatRef = useRef(chat)
  chatRef.current = chat

  const started = chat.feed.length > 0
  const enabled = status.data?.enabled !== false

  // Leaving with an unsaved chat loses it: say so.
  useEffect(() => {
    if (!started) return
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [started])

  // A chat belongs to one tenant: switching tenants starts over.
  const tenantRef = useRef(tenantId)
  useEffect(() => {
    if (tenantRef.current !== tenantId) {
      abort.current?.abort()
      dispatch({ type: 'reset' })
      tenantRef.current = tenantId
    }
  }, [tenantId])
  useEffect(() => () => abort.current?.abort(), [])

  const run = useCallback(
    async (path: '/agent/turn' | '/agent/approve', body: Record<string, unknown>) => {
      abort.current?.abort()
      const ctl = new AbortController()
      abort.current = ctl
      let finished = false
      const onEvent = (e: AgentEvent) => {
        if (e.type === 'done') finished = true
        if (e.type === 'version') setPane('report')
        dispatch({ type: 'event', event: e })
      }
      try {
        await streamAgent(path, { ...body, prefs }, onEvent, ctl.signal)
        if (!finished && !ctl.signal.aborted) dispatch({ type: 'failed', message: 'The connection dropped before the agent finished. Try again.' })
      } catch (e) {
        dispatch({ type: 'failed', message: e instanceof AgentRequestError ? e.message : 'Something went wrong. Try again.' })
      } finally {
        qc.invalidateQueries({ queryKey: ['t', tenantId, 'agent', 'status'] })
      }
    },
    [prefs, qc, tenantId],
  )

  const send = (raw: string) => {
    const msg = raw.trim()
    if (!msg || chatRef.current.busy || !enabled) return
    dispatch({ type: 'send', text: msg })
    setText('')
    setPane('chat')
    run('/agent/turn', { messages: chatRef.current.transcript, text: msg })
  }

  const approve = (draft: WealthDraft) => {
    if (chatRef.current.busy) return
    dispatch({ type: 'approve', draft })
    run('/agent/approve', { messages: chatRef.current.transcript, draft })
  }

  const reset = () => {
    abort.current?.abort()
    dispatch({ type: 'reset' })
    setText('')
    setConfirmNew(false)
  }

  if (!started) {
    return (
      <StartScreen
        status={status.data}
        prefs={prefs}
        onPrefs={setPrefs}
        text={text}
        onText={setText}
        onStart={send}
      />
    )
  }

  return (
    <div className="h-full flex flex-col min-h-0">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-2.5 border-b border-line print:hidden">
        <div className="flex items-center gap-3 min-w-0">
          <h1 className="font-mono uppercase tracking-widest text-xs text-ink m-0">Wealth Agent</h1>
          <span className="hidden sm:inline font-mono text-[9.5px] uppercase tracking-widest border border-line text-ink-muted px-1.5 py-0.5">Unsaved chat · clears when you leave</span>
        </div>
        <div className="flex items-center gap-4">
          <span className="font-mono text-[10.5px] text-ink-muted num">
            This chat {usd(chat.chatCost)}
            {chat.today !== null && chat.cap !== null && ` · today ${usd(chat.today)} / ${usd(chat.cap)}`}
          </span>
          <Button variant="secondary" onClick={() => (chat.versions.length > Object.keys(chat.saved).length ? setConfirmNew(true) : reset())}>
            New chat
          </Button>
        </div>
      </div>

      <div className="lg:hidden flex border-b border-line print:hidden" role="tablist" aria-label="View">
        {(['chat', 'report'] as const).map((p) => (
          <button
            key={p}
            role="tab"
            aria-selected={pane === p}
            onClick={() => setPane(p)}
            className={cn('flex-1 font-mono text-[11px] uppercase tracking-widest py-2.5 border-b-2', pane === p ? 'border-ink text-ink' : 'border-transparent text-ink-muted')}
          >
            {p === 'chat' ? 'Chat' : `Report${chat.versions.length ? ` · v${chat.versions.length}` : ''}`}
          </button>
        ))}
      </div>

      <div className="flex-1 min-h-0 flex">
        <section aria-label="Conversation" className={cn('w-full lg:w-[29rem] xl:w-[32rem] lg:border-r border-line flex-col min-h-0 print:hidden', pane === 'chat' ? 'flex' : 'hidden lg:flex')}>
          <ChatFeed chat={chat} onApprove={approve} onSuggest={send} onChange={() => document.getElementById('say')?.focus()} />
          <div className="p-3 border-t border-line">
            <Composer value={text} onChange={setText} onSend={() => send(text)} busy={!!chat.busy} placeholder="Reply, or say what to change…" hint={chat.busy ? undefined : 'Enter to send · Shift+Enter for a new line'} />
          </div>
        </section>
        <section aria-label="Report" className={cn('flex-1 min-w-0 min-h-0 flex-col', pane === 'report' ? 'flex' : 'hidden lg:flex', 'print:flex')}>
          <ReportCanvas chat={chat} onSaved={(n, id) => dispatch({ type: 'saved', n, planId: id })} />
        </section>
      </div>

      <ConfirmDialog
        open={confirmNew}
        onOpenChange={setConfirmNew}
        title="Start a new chat?"
        body="This conversation and any unsaved versions will be cleared."
        confirmLabel="Start over"
        onConfirm={reset}
      />
    </div>
  )
}

function ChatFeed({ chat, onApprove, onSuggest, onChange }: { chat: ChatState; onApprove: (d: WealthDraft) => void; onSuggest: (t: string) => void; onChange: () => void }) {
  const end = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    end.current?.scrollIntoView({ block: 'end' })
  }, [chat.feed, chat.status])
  const names = chat.aliases
  const open = actionableDraft(chat)
  const lastSuggestions = [...chat.feed].reverse().find((f) => f.kind === 'suggestions')?.id
  return (
    <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-5 py-5 flex flex-col gap-4" aria-live="polite">
      {chat.feed.map((f) => (
        <FeedRow key={f.id} f={f} chat={chat} names={names} open={open} onApprove={onApprove} onChange={onChange} onSuggest={f.id === lastSuggestions && !chat.busy ? onSuggest : undefined} />
      ))}
      {chat.busy && (
        <p className="font-mono text-[11px] text-ink-muted inline-flex items-center gap-2 m-0" role="status">
          <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
          {chat.status ?? (chat.busy === 'approve' ? 'Running the engine…' : 'Thinking…')}
        </p>
      )}
      <div ref={end} />
    </div>
  )
}

function FeedRow({
  f,
  chat,
  names,
  open,
  onApprove,
  onChange,
  onSuggest,
}: {
  f: FeedItem
  chat: ChatState
  names: Record<string, string>
  open: WealthDraft | null
  onApprove: (d: WealthDraft) => void
  onChange: () => void
  onSuggest?: (t: string) => void
}) {
  switch (f.kind) {
    case 'user':
      return <div className="self-end max-w-[85%] bg-paper-warm px-3.5 py-2.5 font-sans text-[13.5px] leading-relaxed text-ink whitespace-pre-wrap">{f.text}</div>
    case 'agent':
      return (
        <div className="flex flex-col gap-1.5">
          <span className={cap}>Agent</span>
          <AgentText text={swapAliases(f.text, names)} />
        </div>
      )
    case 'draft': {
      const d = chat.drafts.find((x) => x.id === f.draftId)
      if (!d) return null
      const ran = chat.approved[d.id]
      const state = ran ? { version: ran } : open?.id === d.id ? 'open' : 'replaced'
      return <DraftCard draft={d} names={names} state={state} busy={!!chat.busy} onApprove={() => onApprove(d)} onChange={onChange} />
    }
    case 'approved':
      return (
        <div className="self-end border border-line px-3 py-1.5 font-mono text-[10.5px] text-ink-muted inline-flex items-center gap-1.5">
          <Check className="w-3 h-3" aria-hidden="true" /> Approved {f.draftId}
        </div>
      )
    case 'version':
      return (
        <p className="font-mono text-[11px] text-ink border-l-2 border-ink pl-3 m-0">
          v{f.n} is ready on the report canvas{chat.saved[f.n] ? ' · saved' : ''}.
        </p>
      )
    case 'error':
      return (
        <p role="alert" className="font-sans text-[13px] text-error border border-error/50 px-3 py-2 m-0 flex gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" /> {f.text}
        </p>
      )
    case 'suggestions':
      if (!onSuggest) return null
      return (
        <div className="flex flex-col gap-2" aria-label="Suggestions">
          {f.items.map((s) => (
            <button key={s} type="button" onClick={() => onSuggest(s)} className="text-left border border-line hover:border-ink bg-paper px-3 py-2 font-sans text-[12.5px] text-ink">
              {swapAliases(s, names)}
            </button>
          ))}
        </div>
      )
  }
}

function ReportCanvas({ chat, onSaved }: { chat: ChatState; onSaved: (n: number, id: string) => void }) {
  const [tab, setTab] = useState<number | 'compare' | null>(null)
  const [saving, setSaving] = useState(false)
  const latest = chat.versions[chat.versions.length - 1]
  // A new version opens its own tab.
  useEffect(() => {
    if (latest?.n) setTab(latest.n)
  }, [latest?.n])
  const open = actionableDraft(chat)

  if (!chat.versions.length) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <div className="max-w-sm text-center flex flex-col gap-2">
          <p className={cap}>Report canvas</p>
          <p className="font-sans text-[13.5px] text-ink-muted leading-relaxed m-0">
            {open ? `Draft ${open.id} is waiting in the chat. Approve it and the report appears here.` : 'Each plan you approve runs through Nurav’s engine and appears here as a version you can compare and save.'}
          </p>
        </div>
      </div>
    )
  }
  const current = tab === 'compare' ? null : (chat.versions.find((v) => v.n === tab) ?? latest)
  const savedId = current ? chat.saved[current.n as number] : undefined
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 border-b border-line print:hidden">
        <div className="flex overflow-x-auto" role="tablist" aria-label="Versions">
          {chat.versions.map((v) => (
            <button
              key={v.n}
              role="tab"
              aria-selected={current?.n === v.n}
              onClick={() => setTab(v.n as number)}
              className={cn('font-mono text-[11.5px] px-3.5 py-3 border-b-2 whitespace-nowrap', current?.n === v.n ? 'border-ink text-ink font-bold' : 'border-transparent text-ink-muted hover:text-ink')}
            >
              v{v.n}
              {chat.saved[v.n as number] && ' ✓'}
            </button>
          ))}
          {chat.versions.length > 1 && (
            <button
              role="tab"
              aria-selected={tab === 'compare'}
              onClick={() => setTab('compare')}
              className={cn('font-mono text-[11.5px] px-3.5 py-3 border-b-2 whitespace-nowrap', tab === 'compare' ? 'border-ink text-ink font-bold' : 'border-transparent text-ink-muted hover:text-ink')}
            >
              Side by side
            </button>
          )}
        </div>
        {current && (
          <div className="flex items-center gap-4 py-2">
            <Button variant="secondary" onClick={() => window.print()}>
              Print
            </Button>
            {savedId ? (
              <Link to={`/wealth/plans/${savedId}`} className="font-mono text-[11px] uppercase tracking-widest text-ink underline">
                Saved · open
              </Link>
            ) : (
              <button
                type="button"
                disabled={!current.narrative || !!chat.busy}
                onClick={() => setSaving(true)}
                className="h-10 px-4 bg-ink text-paper font-mono text-[11px] uppercase tracking-widest disabled:opacity-40"
              >
                Approve &amp; save v{current.n}
              </button>
            )}
          </div>
        )}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 sm:px-6 py-6">
        {current ? <WealthReport version={current} names={chat.aliases} /> : <CompareVersions versions={chat.versions} names={chat.aliases} />}
      </div>
      {current && (
        <SaveModal
          open={saving}
          onOpenChange={setSaving}
          defaultName={swapAliases(current.draft.params.title, chat.aliases)}
          onSave={(name) => ({ name, draft: current.draft, narrative: current.narrative })}
          onSaved={(id) => onSaved(current.n as number, id)}
        />
      )}
    </>
  )
}

function SaveModal({
  open,
  onOpenChange,
  defaultName,
  onSave,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  defaultName: string
  onSave: (name: string) => Parameters<ReturnType<typeof useWealthMutations>['save']['mutate']>[0]
  onSaved: (id: string) => void
}) {
  const { save } = useWealthMutations()
  const [name, setName] = useState(defaultName)
  useEffect(() => {
    if (open) {
      setName(defaultName)
      save.reset()
    }
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const submit = () =>
    save.mutate(onSave(name.trim()), {
      onSuccess: (plan) => {
        onSaved(plan.id)
        onOpenChange(false)
      },
    })
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Save this version"
      subtitle="Frozen as it is now: the numbers, the assumptions and the agent’s words."
      footer={
        <div className="flex justify-end gap-4">
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} isLoading={save.isPending} disabled={!name.trim()}>
            Save plan
          </Button>
        </div>
      }
    >
      <form
        className="px-5 sm:px-7 py-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (name.trim()) submit()
        }}
      >
        <Input id="plan-name" label="Plan name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoFocus error={save.error ? apiErrorMessage(save.error, 'Could not save the plan') : null} />
      </form>
    </Modal>
  )
}
