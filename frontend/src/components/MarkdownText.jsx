import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkBreaks from 'remark-breaks'

const mdComponents = {
  h1: ({ children }) => (
    <h2 className="text-base font-semibold text-mise-300">{children}</h2>
  ),
  h2: ({ children }) => (
    <h3 className="text-sm font-semibold text-mise-400">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="text-xs font-semibold uppercase tracking-widest text-mise-500">{children}</h4>
  ),
  p: ({ children }) => (
    <p className="text-sm text-mise-400">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="ml-4 list-disc space-y-1 text-sm text-mise-400">{children}</ul>
  ),
  ol: ({ start, children }) => (
    <ol start={start} className="ml-4 list-decimal space-y-1 text-sm text-mise-400">{children}</ol>
  ),
  li: ({ children }) => <li>{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-mise-300">{children}</strong>
  ),
  em: ({ children }) => <em>{children}</em>,
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="text-ember underline underline-offset-2 hover:text-ember-hover"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-mise-700 pl-3 text-mise-500 italic">
      {children}
    </blockquote>
  ),
  pre: ({ children }) => (
    <pre className="overflow-x-auto rounded border border-mise-800 bg-mise-950 px-3 py-2 text-xs text-mise-300">
      {children}
    </pre>
  ),
  code: ({ children }) => (
    <code className="rounded bg-mise-800 px-1 py-0.5 text-xs text-mise-300">{children}</code>
  ),
  hr: () => <hr className="border-mise-800" />,
}

// CommonMark setext headings: `text\n---` is an h2, not a thematic break.
// Insert a blank line before any hr-like line (---, ***, ___) that directly
// follows a non-blank line so the parser always sees a thematic break instead.
function normalizeHr(text) {
  return text.replace(
    /([^\n])\n([-*_]{3,}[ \t]*)(\n|$)/g,
    (_, before, rule, after) => `${before}\n\n${rule}${after}`,
  )
}

export function MarkdownText({ text }) {
  if (!text?.trim()) return null
  return (
    <div className="space-y-3">
      <ReactMarkdown remarkPlugins={[remarkBreaks]} components={mdComponents}>
        {normalizeHr(text)}
      </ReactMarkdown>
    </div>
  )
}

const tabCls = (active) =>
  [
    'px-2.5 py-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember first:rounded-l last:rounded-r',
    active ? 'bg-mise-800 text-mise-300' : 'text-mise-500 hover:text-mise-300',
  ].join(' ')

export function MarkdownField({
  id,
  label,
  labelClassName = 'text-sm font-medium text-mise-400',
  labelExtra,
  value,
  onChange,
  rows = 6,
  placeholder = '',
  textareaClassName,
}) {
  const [mode, setMode] = useState('write')
  const taCls = textareaClassName ??
    'w-full rounded border border-mise-800 bg-mise-900 px-3 py-2.5 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember'

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <label htmlFor={mode === 'write' ? id : undefined} className={`block ${labelClassName}`}>
          {label}
          {labelExtra && <span className="ml-1 font-normal text-mise-600">{labelExtra}</span>}
        </label>
        <div className="flex items-center rounded border border-mise-800 text-xs font-medium">
          <button type="button" onClick={() => setMode('write')} className={tabCls(mode === 'write')}>Write</button>
          <button type="button" onClick={() => setMode('preview')} className={tabCls(mode === 'preview')}>Preview</button>
        </div>
      </div>
      {mode === 'write' ? (
        <textarea
          id={id}
          rows={rows}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className={taCls}
        />
      ) : (
        <div
          className="rounded border border-mise-800 bg-mise-900 px-3 py-2.5"
          style={{ minHeight: `${rows * 1.6}rem` }}
        >
          {value?.trim() ? (
            <MarkdownText text={value} />
          ) : (
            <p className="text-sm italic text-mise-600">{placeholder || 'Nothing to preview.'}</p>
          )}
        </div>
      )}
    </div>
  )
}
