import { useEffect, useId, useRef, useState } from 'react'
import { Check, ClipboardCopy, ExternalLink, Link2, Search, ShoppingCart, X } from 'lucide-react'
import { updateIngredient } from '../api/client.js'
import {
  SEND_TO_MISE_BOOKMARKLET,
  USERSCRIPT_PATH,
  WALMART_PICK_MESSAGE,
  isWalmartOrigin,
  openWalmartPicker,
  productTitle,
  walmartCartUrl,
  walmartProductUrl,
  walmartSearchUrl,
} from '../utils/walmart.js'

const smallButtonCls =
  'inline-flex items-center gap-1 rounded px-1.5 py-1 text-xs text-mise-500 transition hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember'

// The server's 422 for a bad address reads "Value error, Paste a Walmart…".
function cleanError(err) {
  const message = err instanceof Error ? err.message : 'Could not save the link.'
  return message.replace(/^Value error,\s*/i, '')
}

function LinkEditor({ item, onSaved, onCancel, onPick }) {
  const [value, setValue] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const inputId = useId()

  const save = async (nextValue) => {
    setSaving(true)
    setError('')
    try {
      const updated = await updateIngredient(item.ingredient_id, { walmart_item_id: nextValue })
      onSaved(updated.walmart_item_id ?? null)
    } catch (err) {
      setError(cleanError(err))
      setSaving(false)
    }
  }

  return (
    <form
      className="mt-2 flex flex-col gap-2"
      onSubmit={(e) => { e.preventDefault(); if (value.trim()) void save(value) }}
      onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel() } }}
    >
      <label htmlFor={inputId} className="text-xs text-mise-500">
        Paste the Walmart product page address for {item.name}
      </label>
      <div className="flex gap-2">
        <input
          id={inputId}
          type="text"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="walmart.com/ip/…"
          autoComplete="off"
          className="min-w-0 flex-1 rounded border border-mise-800 bg-mise-950 px-2.5 py-1.5 text-xs text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
        />
        <button
          type="submit"
          disabled={saving || !value.trim()}
          className="rounded bg-ember px-3 py-1.5 text-xs font-semibold text-mise-950 transition hover:bg-ember-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" onClick={onCancel} className={smallButtonCls}>Cancel</button>
      </div>
      <div className="flex flex-wrap gap-x-3">
        <button type="button" disabled={saving} onClick={onPick} className={smallButtonCls}>
          <Search size={12} aria-hidden="true" /> Pick on Walmart instead
        </button>
        {item.walmart_item_id && (
          <button type="button" disabled={saving} onClick={() => save('')} className={smallButtonCls}>
            Remove link
          </button>
        )}
      </div>
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </form>
  )
}

// React refuses javascript: URLs in href, so the bookmarklet's address is set on the element.
function BookmarkletLink() {
  const ref = useRef(null)
  useEffect(() => { ref.current?.setAttribute('href', SEND_TO_MISE_BOOKMARKLET) }, [])
  return (
    <a
      ref={ref}
      onClick={(e) => e.preventDefault()}
      className="inline-flex cursor-grab items-center rounded bg-ember px-2.5 py-1 text-xs font-semibold text-mise-950"
      title="Drag this to your bookmarks bar"
    >
      Send to Mise
    </a>
  )
}

function SetupHelp({ open, onToggle }) {
  return (
    <details open={open} onToggle={(e) => onToggle(e.currentTarget.open)} className="text-xs text-mise-500">
      <summary className="cursor-pointer select-none text-mise-400 hover:text-mise-300">
        Set up one-click linking
      </summary>
      <div className="mt-2 space-y-2 border-l-2 border-mise-800 pl-3">
        <p>
          Search opens Walmart in a window. Click into the product you want, then use <span className="text-mise-300">Send to Mise</span> to link it.
          Set that up once with either:
        </p>
        <p>
          <span className="text-mise-300">Userscript:</span> with Tampermonkey or Violentmonkey installed,{' '}
          <a href={USERSCRIPT_PATH} target="_blank" rel="noreferrer noopener" className="text-mise-300 underline underline-offset-2 hover:text-mise-200">
            install the Mise script
          </a>
          . A Send to Mise button then appears on product pages opened from here. In Chrome or Edge, also turn on
          “Allow User Scripts” in the extension’s details.
        </p>
        <p className="flex flex-wrap items-center gap-2">
          <span className="text-mise-300">Or bookmark:</span> drag <BookmarkletLink /> to your bookmarks bar and click it on the product page.
        </p>
      </div>
    </details>
  )
}

export default function ShoppingListModal({ items: initialItems, onClose }) {
  const [items, setItems] = useState(initialItems)
  const [editingIndex, setEditingIndex] = useState(null)
  // The ingredient waiting for a product from the Walmart popup: { ingredientId, name }.
  const [picking, setPicking] = useState(null)
  const [notice, setNotice] = useState(null) // { ingredientId, text, error }
  const [showSetup, setShowSetup] = useState(false)
  const [copied, setCopied] = useState(false)
  const titleId = useId()
  const timerRef = useRef(null)
  const pickerRef = useRef(null)
  // The message listener is registered once, so it reads the current target from a ref.
  const pickingRef = useRef(null)
  useEffect(() => { pickingRef.current = picking }, [picking])

  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [onClose])

  const handleSaved = (ingredientId, walmartItemId) => {
    setItems((current) => current.map((item) =>
      item.ingredient_id === ingredientId ? { ...item, walmart_item_id: walmartItemId } : item))
    setEditingIndex(null)
  }

  // A product sent back from the Walmart popup by the userscript or bookmarklet.
  useEffect(() => {
    const onMessage = async (event) => {
      if (!isWalmartOrigin(event.origin)) return
      if (pickerRef.current && event.source !== pickerRef.current) return
      const data = event.data
      if (data?.type !== WALMART_PICK_MESSAGE || typeof data.itemId !== 'string') return
      const target = pickingRef.current
      if (!target) return

      setPicking(null)
      try {
        const updated = await updateIngredient(target.ingredientId, { walmart_item_id: data.itemId })
        handleSaved(target.ingredientId, updated.walmart_item_id ?? null)
        const title = productTitle(data.title)
        setNotice({ ingredientId: target.ingredientId, text: title ? `Linked to ${title}` : 'Linked' })
        pickerRef.current?.close()
        pickerRef.current = null
        window.focus()
      } catch (err) {
        setNotice({ ingredientId: target.ingredientId, text: cleanError(err), error: true })
      }
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [])

  // Stop waiting if the Walmart window is closed without sending anything.
  useEffect(() => {
    if (!picking) return undefined
    const timer = setInterval(() => {
      if (!pickerRef.current || pickerRef.current.closed) {
        pickerRef.current = null
        setPicking(null)
      }
    }, 1000)
    return () => clearInterval(timer)
  }, [picking])

  // Returns false when the browser blocked the popup, so a plain link can open instead.
  const startPicking = (item) => {
    const popup = openWalmartPicker(walmartSearchUrl(item.name))
    if (!popup) return false
    pickerRef.current = popup
    setEditingIndex(null)
    setNotice(null)
    setPicking({ ingredientId: item.ingredient_id, name: item.name })
    return true
  }

  const cancelPicking = () => {
    pickerRef.current?.close()
    pickerRef.current = null
    setPicking(null)
  }

  const text = items.map((item) => item.line).join('\n')
  const linkedIds = items.map((item) => item.walmart_item_id).filter(Boolean)

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
    // No close-on-backdrop-click: linking a product means clicking away to Walmart, and a stray
    // click (or a text selection dragged past the edge) would close the list.
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="flex max-h-[90vh] w-full max-w-lg flex-col gap-4 rounded border border-mise-700 bg-mise-950 p-5 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 id={titleId} className="text-base font-semibold text-mise-300">Shopping List</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-mise-500 transition hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember">
            <X size={16} />
          </button>
        </div>

        {items.length === 0 ? (
          <p className="text-sm text-mise-500">No ingredients in these recipes.</p>
        ) : (
          <ul className="-mx-1 divide-y divide-mise-800 overflow-y-auto rounded border border-mise-800 bg-mise-900">
            {items.map((item, index) => {
              const linkable = item.ingredient_id != null
              const isPicking = linkable && picking?.ingredientId === item.ingredient_id
              const rowNotice = linkable && notice?.ingredientId === item.ingredient_id ? notice : null
              return (
                <li key={`${item.line}-${index}`} className="px-3 py-2">
                  <div className="flex items-center justify-between gap-3">
                    <p className="min-w-0 text-sm text-mise-300">
                      {item.name}
                      {item.amount && <span className="text-mise-500"> · {item.amount}</span>}
                    </p>
                    <div className="flex shrink-0 items-center gap-1">
                      {item.walmart_item_id ? (
                        <a
                          href={walmartProductUrl(item.walmart_item_id)}
                          target="_blank"
                          rel="noreferrer noopener"
                          className={`${smallButtonCls} text-emerald-600 dark:text-emerald-400`}
                          aria-label={`${item.name}: linked Walmart product (opens Walmart)`}
                        >
                          <Check size={12} aria-hidden="true" /> Linked
                        </a>
                      ) : (
                        <a
                          href={walmartSearchUrl(item.name)}
                          target="_blank"
                          rel="noreferrer noopener"
                          onClick={(e) => { if (linkable && startPicking(item)) e.preventDefault() }}
                          className={smallButtonCls}
                          aria-label={linkable ? `Search Walmart and pick a product for ${item.name}` : `Search Walmart for ${item.name}`}
                        >
                          <Search size={12} aria-hidden="true" /> Search
                        </a>
                      )}
                      {linkable && editingIndex !== index && (
                        <button
                          type="button"
                          onClick={() => { setNotice(null); setEditingIndex(index) }}
                          className={smallButtonCls}
                          aria-label={`${item.walmart_item_id ? 'Change' : 'Link'} the Walmart product for ${item.name}`}
                        >
                          <Link2 size={12} aria-hidden="true" /> {item.walmart_item_id ? 'Change' : 'Link'}
                        </button>
                      )}
                    </div>
                  </div>
                  {isPicking && (
                    <p className="mt-1.5 flex flex-wrap items-center gap-x-2 text-xs text-mise-400" role="status">
                      In the Walmart window, open the product you want and click Send to Mise.
                      <button type="button" onClick={() => setShowSetup(true)} className="underline underline-offset-2 hover:text-mise-300">Not set up?</button>
                      <button type="button" onClick={cancelPicking} className="underline underline-offset-2 hover:text-mise-300">Cancel</button>
                    </p>
                  )}
                  {rowNotice && (
                    <p className={`mt-1.5 text-xs ${rowNotice.error ? 'text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`} role="status">
                      {rowNotice.text}
                    </p>
                  )}
                  {editingIndex === index && (
                    <LinkEditor
                      item={item}
                      onSaved={(walmartItemId) => handleSaved(item.ingredient_id, walmartItemId)}
                      onCancel={() => setEditingIndex(null)}
                      onPick={() => startPicking(item)}
                    />
                  )}
                </li>
              )
            })}
          </ul>
        )}

        <SetupHelp open={showSetup} onToggle={setShowSetup} />

        <p className="text-xs text-mise-500">
          {linkedIds.length > 0
            ? 'Adds one of each linked product to your Walmart cart for you to review. Nothing is bought.'
            : 'Link items to Walmart products to send them to your cart in one go.'}
        </p>

        <div className="flex flex-wrap justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-mise-800 px-3 py-2 text-sm text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember">
            Close
          </button>
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center gap-2 rounded border border-mise-800 px-3 py-2 text-sm text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          >
            <ClipboardCopy size={14} />
            {copied ? 'Copied!' : 'Copy'}
          </button>
          {linkedIds.length > 0 ? (
            <a
              href={walmartCartUrl(linkedIds)}
              target="_blank"
              rel="noreferrer noopener"
              className="inline-flex items-center gap-2 rounded bg-ember px-4 py-2 text-sm font-semibold text-mise-950 transition hover:bg-ember-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              <ShoppingCart size={14} />
              Walmart cart ({linkedIds.length} of {items.length})
              <ExternalLink size={12} aria-hidden="true" />
            </a>
          ) : (
            <button
              type="button"
              disabled
              className="inline-flex items-center gap-2 rounded bg-ember px-4 py-2 text-sm font-semibold text-mise-950 opacity-50"
            >
              <ShoppingCart size={14} />
              Walmart cart (0 of {items.length})
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
