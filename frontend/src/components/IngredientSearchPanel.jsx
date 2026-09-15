import { useEffect, useRef, useState } from 'react'
import { blockIngredient, createIngredient, searchIngredients } from '../api/client.js'
import { toTitleCase } from '../utils/text.js'

const inputCls =
  'w-full rounded border border-mise-800 bg-mise-950 px-3 py-2 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember'

function formatServingMacroLabel(result) {
  const servingCandidate =
    result.serving_grams ??
    result.serving_size_g ??
    result.serving_size ??
    result.amount_grams ??
    100
  const numericServing = Number(servingCandidate)
  const servingG = Number.isFinite(numericServing) && numericServing > 0 ? numericServing : 100

  // Any unit other than "per 100g" (OFF serving-level macros, a custom local ingredient
  // stored per-serving) means the macros are already at that basis — scaling again would
  // double-count them.
  const isPreScaled = result.unit && result.unit !== 'per 100g'
  const scale = isPreScaled ? 1 : servingG / 100

  return `Per ${servingG}g: ${Math.round((Number(result.calories) || 0) * scale)} cal · ${Math.round((Number(result.protein) || 0) * scale)}g protein · ${Math.round((Number(result.carbs) || 0) * scale)}g carbs · ${Math.round((Number(result.fat) || 0) * scale)}g fat`
}

function formatOffServingText(result) {
  const servingCandidates = [
    result.serving_grams,
    result.serving_size_g,
    result.serving_size,
    result.amount_grams,
  ]

  for (const candidate of servingCandidates) {
    const numeric = Number(candidate)
    if (Number.isFinite(numeric) && numeric > 0) {
      return `Per serving: ${numeric}g`
    }
  }

  return 'Per 100g'
}

const emptyCustomForm = { name: '', calories: '', protein: '', carbs: '', fat: '', unit: 'per 100g', serving_quantity: '' }

/**
 * Search local/USDA/Open Food Facts ingredients, or add one by barcode or by hand.
 * `onSelect(saved)` receives `{ id, name }` for an existing local match or the full
 * created ingredient otherwise. It may return `false` to keep the panel open (e.g. when
 * a caller couldn't apply the selection) — anything else closes it.
 */
export default function IngredientSearchPanel({ ingredientName, onSelect, onClose }) {
  const [query, setQuery] = useState(ingredientName)
  const [barcodeMode, setBarcodeMode] = useState(false)
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchedExternal, setSearchedExternal] = useState(false)
  const [savingIndex, setSavingIndex] = useState(null)
  const [error, setError] = useState('')
  const timerRef = useRef(null)

  const [customMode, setCustomMode] = useState(false)
  const [customForm, setCustomForm] = useState(emptyCustomForm)
  const [savingCustom, setSavingCustom] = useState(false)

  const handleBlock = async (result, i) => {
    if (!result.source_id) return
    setResults((prev) => prev.filter((_, idx) => idx !== i))
    try {
      await blockIngredient({ name: result.name, source: result.source, source_id: result.source_id })
    } catch {
      // optimistic removal stands even on error
    }
  }

  const runSearch = (q, { immediate = false } = {}) => {
    clearTimeout(timerRef.current)
    setError('')
    setSearchedExternal(false)
    setBarcodeMode(false)
    if (q.trim().length < 2) {
      setResults([])
      return
    }
    const execute = () => {
      setSearching(true)
      searchIngredients(q, { includeExternal: false })
        .then((d) => {
          const raw = d?.results ?? []
          const qWords = q.trim().toLowerCase().split(/\s+/).filter(Boolean)
          const filtered = qWords.length === 0 ? raw : raw.filter((r) => {
            const name = r.name.toLowerCase()
            const matched = qWords.filter((w) => name.includes(w))
            return matched.length / qWords.length >= 0.5
          })
          setResults(filtered)
        })
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }
    if (immediate) { execute(); return }
    timerRef.current = setTimeout(execute, 400)
  }

  useEffect(() => {
    runSearch(ingredientName, { immediate: true })
    return () => clearTimeout(timerRef.current)
  }, [])

  const handleQueryChange = (e) => {
    const q = e.target.value
    setQuery(q)
    runSearch(q)
  }

  const handleSearchUsda = () => {
    const trimmed = query.trim()
    if (trimmed.length < 2) return
    clearTimeout(timerRef.current)
    setError('')
    setSearchedExternal(true)
    setSearching(true)
    searchIngredients(trimmed, { includeExternal: true, externalSource: 'usda' })
      .then((d) => setResults(d?.results ?? []))
      .catch(() => setResults([]))
      .finally(() => setSearching(false))
  }

  const handleSearchOpenFoodFacts = () => {
    const trimmed = query.trim()
    if (trimmed.length < 2) return
    clearTimeout(timerRef.current)
    setError('')
    setSearchedExternal(true)
    setSearching(true)
    searchIngredients(trimmed, { includeExternal: true, externalSource: 'openfoodfacts' })
      .then((d) => setResults(d?.results ?? []))
      .catch(() => setResults([]))
      .finally(() => setSearching(false))
  }

  const runBarcodeLookup = (rawValue) => {
    const next = String(rawValue ?? '').replace(/\D/g, '')
    setQuery(next)
    setError('')
    setSearchedExternal(true)
    if (!next) { setResults([]); return }
    setSearching(true)
    searchIngredients(next, { includeExternal: true, externalSource: 'openfoodfacts' })
      .then((d) => setResults(d?.results ?? []))
      .catch(() => setResults([]))
      .finally(() => setSearching(false))
  }

  const handleSearchByBarcode = () => {
    clearTimeout(timerRef.current)
    setBarcodeMode(true)
    runBarcodeLookup(query)
  }

  const handleBarcodeChange = (e) => {
    runBarcodeLookup(e.target.value)
  }

  const handleUse = async (result, index) => {
    setSavingIndex(index)
    setError('')
    try {
      let saved
      if (result.source === 'local') {
        saved = { id: result.ingredient_id, name: result.name }
      } else {
        saved = await createIngredient({
          name: result.name,
          calories: Number(result.calories) || 0,
          protein: Number(result.protein) || 0,
          carbs: Number(result.carbs) || 0,
          fat: Number(result.fat) || 0,
          unit: result.serving_grams ? `per ${result.serving_grams}g` : (result.unit || 'per 100g'),
          source: result.source === 'usda' ? 'usda' : 'off',
          barcode: result.source === 'openfoodfacts' ? (result.barcode || null) : null,
        })
      }
      const keepOpen = await onSelect(saved)
      if (keepOpen !== false) onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add ingredient.')
    } finally {
      setSavingIndex(null)
    }
  }

  const openCustomForm = () => {
    setCustomForm({ ...emptyCustomForm, name: query.trim() })
    setCustomMode(true)
  }

  const handleSaveCustom = async (e) => {
    e.preventDefault()
    const name = customForm.name.trim()
    if (!name) return
    setSavingCustom(true)
    setError('')
    try {
      const servingQty = parseInt(customForm.serving_quantity, 10)
      const saved = await createIngredient({
        name,
        calories: Number(customForm.calories) || 0,
        protein: Number(customForm.protein) || 0,
        carbs: Number(customForm.carbs) || 0,
        fat: Number(customForm.fat) || 0,
        unit: customForm.unit?.trim() || 'per 100g',
        source: 'local',
        ...(servingQty > 1 ? { serving_quantity: servingQty } : {}),
      })
      const keepOpen = await onSelect(saved)
      if (keepOpen !== false) onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save ingredient.')
    } finally {
      setSavingCustom(false)
    }
  }

  return (
    <div className="rounded border border-mise-700/60 bg-mise-950 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={query}
            onChange={barcodeMode ? handleBarcodeChange : handleQueryChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (!barcodeMode) runSearch(query, { immediate: true })
              }
            }}
            inputMode={barcodeMode ? 'numeric' : undefined}
            pattern={barcodeMode ? '[0-9]*' : undefined}
            placeholder={barcodeMode ? 'Enter barcode number…' : 'Search ingredient'}
            autoFocus
            className={inputCls}
          />
          {searching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-mise-500">Searching…</span>
          )}
          {!searching && (results.length > 0 || searchedExternal) && (
            <button
              type="button"
              onClick={() => { setQuery(''); setResults([]); setSearchedExternal(false); setError(''); setBarcodeMode(false) }}
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded px-1 text-xs text-mise-500 transition hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              aria-label="Clear search"
            >×</button>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded border border-mise-800 px-2.5 py-2 text-xs text-mise-500 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
        >
          Close
        </button>
      </div>

      {error && <p className="mb-2 text-xs text-rose-400">{error}</p>}

      {!searching && !barcodeMode && query.trim().length >= 2 && (
        <div className="space-y-2">
          {searchedExternal && results.length === 0 && (
            <p className="text-xs text-mise-500">No USDA or Open Food Facts results found.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleSearchUsda}
              className="rounded border border-sky-500/60 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-700 transition hover:border-sky-500 hover:bg-sky-500/20 dark:border-sky-500/40 dark:text-sky-200 dark:hover:border-sky-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              Search USDA
            </button>
            <button
              type="button"
              onClick={handleSearchOpenFoodFacts}
              className="rounded border border-emerald-500/60 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-700 transition hover:border-emerald-500 hover:bg-emerald-500/20 dark:border-emerald-500/40 dark:text-emerald-200 dark:hover:border-emerald-400/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              Search Open Food Facts
            </button>
          </div>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={handleSearchByBarcode}
              className="text-left text-xs text-mise-400 underline-offset-2 transition hover:text-mise-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              Search by barcode
            </button>
            <button
              type="button"
              onClick={openCustomForm}
              className="text-left text-xs text-mise-400 underline-offset-2 transition hover:text-mise-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              Add custom
            </button>
          </div>
        </div>
      )}

      {customMode && (
        <form onSubmit={handleSaveCustom} className="mt-2 space-y-2 rounded border border-mise-800 bg-mise-900/60 p-3">
          <p className="text-xs font-medium text-mise-500">Custom ingredient</p>
          <input
            type="text"
            value={customForm.name}
            onChange={(e) => setCustomForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Name"
            required
            className={inputCls}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              value={customForm.unit}
              onChange={(e) => setCustomForm((f) => ({ ...f, unit: e.target.value }))}
              placeholder="Unit (e.g. per 100g, per 45g)"
              className={inputCls}
            />
            <input
              type="number"
              min="1"
              step="1"
              value={customForm.serving_quantity}
              onChange={(e) => setCustomForm((f) => ({ ...f, serving_quantity: e.target.value }))}
              placeholder="Pieces per serving (e.g. 3)"
              className={inputCls}
            />
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[['calories', 'Cal'], ['protein', 'Protein'], ['carbs', 'Carbs'], ['fat', 'Fat']].map(([field, label]) => (
              <div key={field}>
                <label className="mb-1 block text-[10px] text-mise-500">{label}</label>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  value={customForm[field]}
                  onChange={(e) => setCustomForm((f) => ({ ...f, [field]: e.target.value }))}
                  placeholder="0"
                  className={inputCls}
                />
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={savingCustom || !customForm.name.trim()}
              className="rounded bg-ember px-3 py-1.5 text-xs font-semibold text-mise-950 transition hover:bg-ember-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              {savingCustom ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setCustomMode(false)}
              className="rounded border border-mise-800 px-3 py-1.5 text-xs text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {results.length > 0 && (
        <ul className="space-y-1">
          {results.map((r, i) => (
            <li key={i} className="flex items-center gap-3 rounded border border-mise-800 bg-mise-900/60 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-mise-300">{toTitleCase(r.name)}</span>
                  {r.source_url && (
                    <a href={r.source_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-mise-600 hover:text-mise-400" title="View source">
                      <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                    </a>
                  )}
                  {r.source === 'usda' && (
                    <span className="rounded-full border border-sky-500/40 bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-200">USDA</span>
                  )}
                  {r.source === 'openfoodfacts' && (
                    <span className="rounded-full border border-emerald-500/40 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-200">OFF</span>
                  )}
                </div>
                {r.source === 'openfoodfacts' && (
                  <p className="mt-0.5 text-[11px] text-mise-500">
                    <span>{formatOffServingText(r)}</span>
                    {r.barcode && <span className="ml-2 text-mise-600">Barcode: {r.barcode}</span>}
                  </p>
                )}
                <p className="mt-0.5 text-xs text-mise-500">{formatServingMacroLabel(r)}</p>
              </div>
              {r.source_id && (
                <button
                  type="button"
                  onClick={() => handleBlock(r, i)}
                  className="shrink-0 rounded border border-mise-800 px-2 py-1.5 text-[10px] text-mise-500 transition hover:border-rose-500/40 hover:text-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
                  title="Block this result"
                >
                  Block
                </button>
              )}
              <button
                type="button"
                disabled={savingIndex !== null}
                onClick={() => handleUse(r, i)}
                className="shrink-0 rounded bg-ember px-3 py-1.5 text-xs font-semibold text-mise-950 transition hover:bg-ember-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              >
                {savingIndex === i ? 'Adding…' : 'Add'}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
