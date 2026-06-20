import { useEffect, useRef, useState } from 'react'
import { ClipboardCopy, X } from 'lucide-react'

export default function ShoppingListModal({ text, onClose }) {
  const [copied, setCopied] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [onClose])

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="flex w-full max-w-lg flex-col gap-4 rounded border border-mise-700 bg-mise-950 p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-mise-300">Shopping List</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-mise-500 transition hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember">
            <X size={16} />
          </button>
        </div>

        <textarea
          readOnly
          value={text}
          rows={Math.min(text.split('\n').length + 1, 18)}
          className="w-full rounded border border-mise-800 bg-mise-900 px-3 py-2.5 font-mono text-xs text-mise-300 focus:outline-none resize-none"
        />

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-mise-800 px-3 py-2 text-sm text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember">
            Close
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-2 rounded bg-ember px-4 py-2 text-sm font-semibold text-mise-950 transition hover:bg-ember-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          >
            <ClipboardCopy size={14} />
            {copied ? 'Copied!' : 'Copy to Clipboard'}
          </button>
        </div>
      </div>
    </div>
  )
}
