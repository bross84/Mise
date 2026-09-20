import { useEffect, useRef, useState } from 'react'
import { Sparkles, X } from 'lucide-react'
import { aiEditRecipe, updateRecipe } from '../api/client.js'
import { buildUpdatePayload } from './aiChanges.js'
import AiChangeCard from './AiChangeCard.jsx'
import { MarkdownText } from './MarkdownText.jsx'

let msgSeq = 0
const nextId = () => `m${Date.now()}-${(msgSeq += 1)}`

const EXAMPLES = [
  'Halve the salt',
  'The instructions mention a skillet that isn’t in the ingredients — add it',
]

export default function AiAssistPanel({ recipeId, recipe, open, onClose, onApplied }) {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  useEffect(() => {
    if (open) inputRef.current?.focus()
  }, [open])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, sending])

  // draft=false is a plain conversation: the server never returns change cards for it.
  const send = async (text, draft = false) => {
    const instruction = text.trim()
    if (!instruction || sending) return

    const priorConversation = messages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && !m.error)
      .slice(-8)
      .map((m) => ({ role: m.role, content: m.content }))

    setMessages((m) => [...m, { id: nextId(), role: 'user', content: instruction }])
    setInput('')
    setSending(true)
    try {
      const res = await aiEditRecipe(recipeId, instruction, priorConversation, draft)
      const changes = res.changes ?? []
      const suggestions = res.suggestions ?? []
      setMessages((m) => [
        ...m,
        {
          id: nextId(),
          role: 'assistant',
          content:
            res.reply || (changes.length || suggestions.length ? 'Proposed changes:' : 'No changes proposed.'),
          changes,
          suggestions,
          suggestionStatus: {},
        },
      ])
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: nextId(),
          role: 'assistant',
          content: err instanceof Error ? err.message : 'The assistant request failed.',
          error: true,
        },
      ])
    } finally {
      setSending(false)
    }
  }

  const applyChangeSet = async (msgId, accepted) => {
    if (!accepted.length) return
    setMessages((m) => m.map((x) => (x.id === msgId ? { ...x, busy: true } : x)))
    try {
      const { payload } = buildUpdatePayload(recipe, accepted)
      const updated = await updateRecipe(recipeId, payload)
      onApplied?.(updated)
      setMessages((m) =>
        m.map((x) =>
          x.id === msgId
            ? {
                ...x,
                busy: false,
                resultText: `Applied ${accepted.length} change${accepted.length === 1 ? '' : 's'}.`,
              }
            : x,
        ),
      )
    } catch (err) {
      setMessages((m) =>
        m.map((x) =>
          x.id === msgId
            ? {
                ...x,
                busy: false,
                resultText: `Couldn’t apply: ${err instanceof Error ? err.message : 'request failed'}`,
              }
            : x,
        ),
      )
    }
  }

  const dismissChangeSet = (msgId) => {
    setMessages((m) =>
      m.map((x) => (x.id === msgId ? { ...x, changes: [], resultText: 'Dismissed.' } : x)),
    )
  }

  const setSuggestionStatus = (msgId, suggestionId, status) => {
    setMessages((m) =>
      m.map((x) =>
        x.id === msgId
          ? { ...x, suggestionStatus: { ...x.suggestionStatus, [suggestionId]: status } }
          : x,
      ),
    )
  }

  const applySuggestion = async (msgId, suggestionId, accepted) => {
    if (!accepted.length) return
    setSuggestionStatus(msgId, suggestionId, { busy: true })
    try {
      const { payload } = buildUpdatePayload(recipe, accepted)
      const updated = await updateRecipe(recipeId, payload)
      onApplied?.(updated)
      setSuggestionStatus(msgId, suggestionId, {
        busy: false,
        resultText: `Applied ${accepted.length} change${accepted.length === 1 ? '' : 's'}.`,
      })
    } catch (err) {
      setSuggestionStatus(msgId, suggestionId, {
        busy: false,
        resultText: `Couldn’t apply: ${err instanceof Error ? err.message : 'request failed'}`,
      })
    }
  }

  const dismissSuggestion = (msgId, suggestionId) => {
    setSuggestionStatus(msgId, suggestionId, { resultText: 'Dismissed.' })
  }

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close assistant"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-mise-950/60 focus-visible:outline-none"
        />
      )}
      <aside
        aria-hidden={!open}
        className={`fixed right-0 top-0 z-50 flex h-screen w-full flex-col border-l border-mise-800 bg-mise-950 transition-transform sm:w-[26rem] ${
          open ? 'translate-x-0' : 'translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-mise-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-ember" />
            <h2 className="font-display text-lg font-semibold text-mise-300">Recipe assistant</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded border border-mise-800 p-1.5 text-mise-500 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          >
            <X size={15} />
          </button>
        </div>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {messages.length === 0 && (
            <div className="text-sm text-mise-500">
              <p>
                Talk it through — nothing changes and no changes are suggested until you press Draft change. Then
                you accept or decline each one.
              </p>
              <ul className="mt-3 space-y-1.5">
                {EXAMPLES.map((ex) => (
                  <li key={ex}>
                    <button
                      type="button"
                      onClick={() => send(ex, true)}
                      className="text-left text-xs text-mise-400 underline-offset-2 transition hover:text-mise-200 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
                    >
                      “{ex}”
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id}>
              <div className={m.role === 'user' ? 'flex justify-end' : ''}>
                <div
                  className={`max-w-[85%] rounded border px-3 py-2 text-sm ${
                    m.role === 'user'
                      ? 'border-mise-700 bg-mise-800/60 text-mise-300'
                      : m.error
                        ? 'border-ember/40 bg-ember/5 text-mise-300'
                        : 'border-theme bg-mise-900 text-mise-400'
                  }`}
                >
                  {m.role === 'assistant' && !m.error ? <MarkdownText text={m.content} /> : m.content}
                  {m.error && m.content.toLowerCase().includes('key') && (
                    <span className="mt-1 block text-xs text-mise-500">Add one on the Settings page.</span>
                  )}
                </div>
              </div>
              {m.role === 'assistant' && !m.error && m.changes?.length > 0 && (
                <AiChangeCard
                  changes={m.changes}
                  busy={Boolean(m.busy)}
                  resultText={m.resultText}
                  onApply={(accepted) => applyChangeSet(m.id, accepted)}
                  onDismiss={() => dismissChangeSet(m.id)}
                />
              )}
              {m.role === 'assistant' && m.resultText && !m.changes?.length && (
                <p className="mt-1 text-xs text-mise-500">{m.resultText}</p>
              )}
              {m.role === 'assistant' &&
                !m.error &&
                m.suggestions?.map((s) =>
                  s.changes?.length > 0 ? (
                    <AiChangeCard
                      key={s.id}
                      title={s.title}
                      rationale={s.rationale}
                      changes={s.changes}
                      busy={Boolean(m.suggestionStatus?.[s.id]?.busy)}
                      resultText={m.suggestionStatus?.[s.id]?.resultText}
                      onApply={(accepted) => applySuggestion(m.id, s.id, accepted)}
                      onDismiss={() => dismissSuggestion(m.id, s.id)}
                    />
                  ) : (
                    <div key={s.id} className="mt-2 rounded border border-theme bg-mise-900 p-3">
                      <p className="text-sm font-medium text-mise-300">{s.title}</p>
                      {s.rationale && <p className="mt-0.5 text-[11px] text-mise-500">{s.rationale}</p>}
                    </div>
                  ),
                )}
            </div>
          ))}

          {sending && <p className="text-xs text-mise-500">Thinking…</p>}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault()
            send(input)
          }}
          className="border-t border-mise-800 p-3"
        >
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                send(input)
              }
            }}
            rows={2}
            placeholder="Ask or talk it through…"
            disabled={sending}
            className="w-full resize-none rounded border border-mise-800 bg-mise-950 px-3 py-2 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember disabled:opacity-50"
          />
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => send(input, true)}
              disabled={sending || !input.trim()}
              className="rounded border border-mise-700 px-3 py-1.5 text-xs font-semibold text-mise-300 transition hover:border-mise-600 hover:text-mise-200 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              Draft change
            </button>
            <button
              type="submit"
              disabled={sending || !input.trim()}
              className="rounded bg-ember px-3 py-1.5 text-xs font-semibold text-mise-950 transition hover:bg-ember-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              Send
            </button>
          </div>
        </form>
      </aside>
    </>
  )
}
