import { useMemo, useState } from 'react'
import { lineDiff } from './aiChanges.js'

const DIFF_FIELDS = new Set(['instructions', 'notes'])

function formatValue(value) {
  if (value == null) return '—'
  if (Array.isArray(value)) return value.join(', ') || '—'
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([k, v]) => `${k}: ${v}`)
      .join(', ')
  }
  return String(value)
}

function TextDiff({ before, after }) {
  const rows = useMemo(() => lineDiff(before, after), [before, after])
  return (
    <pre className="mt-2 overflow-x-auto rounded border border-theme bg-mise-950 p-2 text-[11px] leading-relaxed text-mise-500">
      {rows.map((row, i) => (
        <div
          key={i}
          className={
            row.type === 'add'
              ? 'border-l-2 border-ember pl-2 text-mise-300'
              : row.type === 'remove'
                ? 'border-l-2 border-mise-700 pl-2 text-mise-600 line-through'
                : 'border-l-2 border-transparent pl-2'
          }
        >
          {row.text || ' '}
        </div>
      ))}
    </pre>
  )
}

function InlineDelta({ before, after }) {
  return (
    <p className="mt-1 text-xs">
      <span className="text-mise-600 line-through">{formatValue(before)}</span>
      <span className="mx-1.5 text-mise-600">→</span>
      <span className="text-mise-300">{formatValue(after)}</span>
    </p>
  )
}

function opLabel(op) {
  if (op === 'add') return { text: 'Add', cls: 'border-mise-700 text-mise-400' }
  if (op === 'remove') return { text: 'Remove', cls: 'border-ember/40 text-ember' }
  return { text: 'Change', cls: 'border-mise-700 text-mise-500' }
}

export default function AiChangeCard({ changes, busy, resultText, onApply, onDismiss }) {
  const [selected, setSelected] = useState(() => new Set(changes.map((c) => c.id)))
  const locked = Boolean(resultText) || busy

  const toggle = (id) => {
    if (locked) return
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const acceptedCount = selected.size

  return (
    <div className="mt-2 rounded border border-theme bg-mise-900 p-3">
      <ul className="space-y-2">
        {changes.map((change) => {
          const isSelected = selected.has(change.id)
          const badge = opLabel(change.op)
          const showDiff =
            change.op === 'update' && DIFF_FIELDS.has(change.field) && typeof change.after === 'string'
          const showInline =
            change.op === 'update' && !DIFF_FIELDS.has(change.field) && change.field !== 'ingredients'
          return (
            <li
              key={change.id}
              className={`rounded border px-3 py-2 transition ${
                isSelected ? 'border-theme bg-mise-950/50' : 'border-mise-800 bg-mise-950/20 opacity-60'
              }`}
            >
              <div className="flex items-start gap-3">
                <button
                  type="button"
                  onClick={() => toggle(change.id)}
                  disabled={locked}
                  role="checkbox"
                  aria-checked={isSelected}
                  aria-label={change.label}
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border text-[10px] font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember disabled:cursor-default ${
                    isSelected ? 'border-ember bg-ember text-white' : 'border-mise-700 text-transparent'
                  }`}
                >
                  ✓
                </button>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <span className="text-sm text-mise-300">{change.label}</span>
                    <span
                      className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${badge.cls}`}
                    >
                      {badge.text}
                    </span>
                  </div>
                  {change.why && <p className="mt-0.5 text-[11px] text-mise-500">{change.why}</p>}
                  {showInline && <InlineDelta before={change.before} after={change.after} />}
                  {showDiff && <TextDiff before={change.before} after={change.after} />}
                </div>
              </div>
            </li>
          )
        })}
      </ul>

      {resultText ? (
        <p className="mt-3 text-xs text-mise-400">{resultText}</p>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => onApply(changes.filter((c) => selected.has(c.id)))}
            disabled={busy || acceptedCount === 0}
            className="rounded bg-ember px-3 py-1.5 text-xs font-semibold text-mise-950 transition hover:bg-ember-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          >
            {busy ? 'Applying…' : `Apply ${acceptedCount} change${acceptedCount === 1 ? '' : 's'}`}
          </button>
          <button
            type="button"
            onClick={onDismiss}
            disabled={busy}
            className="rounded border border-mise-800 px-3 py-1.5 text-xs text-mise-400 transition hover:border-mise-700 hover:text-mise-300 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  )
}
