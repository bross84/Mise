import { useEffect, useRef, useState } from 'react'
import { blockIngredient, createIngredient, searchIngredients } from '../api/client.js'
import { toTitleCase } from '../utils/text.js'
import NutritionFields, { CalorieMismatchNotice } from './NutritionFields.jsx'
import { emptyNutritionForm, isCalorieMismatch, nutritionFormToPayload } from '../utils/nutrition.js'

const inputCls =
  'w-full rounded border border-mise-800 bg-mise-950 px-3 py-2 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember'

// Results are stored and shown per 100 g. Local rows saved under an older unit keep their own
// label ("Per 45g") and are never rescaled.
function formatMacroLine(result) {
  const basis = String(result.unit || 'per 100g').replace(/^per\s+/i, '')
  const round = (n) => Math.round(Number(n) || 0)
  const grams = (n) => Math.round((Number(n) || 0) * 10) / 10
  return `Per ${basis}: ${round(result.calories)} cal · ${grams(result.protein)}g protein · ${grams(result.carbs)}g carbs · ${grams(result.fat)}g fat`
}

function formatServingLine(result) {
  const standard = !result.unit || result.unit === 'per 100g'
  const grams = Number(result.serving_grams)
  if (!standard || !(grams > 0)) return null
  const line = `Serving ${grams} g = ${Math.round(((Number(result.calories) || 0) * grams) / 100)} cal`
  return result.converted_from_serving ? `${line}. Converted from per-serving values.` : line
}

const emptyCustomForm = { name: '', barcode: '', ...emptyNutritionForm }

// Ties a calorie warning to the result it came from, so it never shows on a different list.
const resultKey = (result) => `${result.source}:${result.source_id ?? result.name}`

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
  const [customWarning, setCustomWarning] = useState(null)
  const [addWarning, setAddWarning] = useState(null) // { key, detail } for one search result

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

  const handleUse = async (result, index, override = false) => {
    setSavingIndex(index)
    setError('')
    try {
      let saved
      if (result.source === 'local') {
        saved = { id: result.ingredient_id, name: result.name }
      } else {
        // External results are always per 100 g; the server re-checks calories before saving.
        saved = await createIngredient({
          name: result.name,
          calories: Number(result.calories),
          protein: Number(result.protein),
          carbs: Number(result.carbs),
          fat: Number(result.fat),
          nutrition_basis: 'per_100g',
          serving_grams: result.serving_grams ?? null,
          source: result.source === 'usda' ? 'usda' : 'off',
          barcode: result.source === 'openfoodfacts' ? (result.barcode || null) : null,
          override_calorie_check: override,
        })
      }
      setAddWarning(null)
      const keepOpen = await onSelect(saved)
      if (keepOpen !== false) onClose()
    } catch (err) {
      if (isCalorieMismatch(err)) {
        setAddWarning({ key: resultKey(result), detail: err.detail })
      } else {
        setError(err instanceof Error ? err.message : 'Failed to add ingredient.')
      }
    } finally {
      setSavingIndex(null)
    }
  }

  const openCustomForm = (prefill = {}) => {
    setCustomWarning(null)
    setCustomForm({
      ...emptyCustomForm,
      name: prefill.name ?? query.trim(),
      barcode: prefill.barcode ?? '',
      serving_grams: prefill.serving_grams ? String(prefill.serving_grams) : '',
    })
    setCustomMode(true)
  }

  const updateCustomForm = (next) => {
    setCustomWarning(null)
    setCustomForm(next)
  }

  const saveCustom = async (override = false) => {
    const name = customForm.name.trim()
    if (!name) return
    setSavingCustom(true)
    setError('')
    try {
      const saved = await createIngredient({
        name,
        ...nutritionFormToPayload(customForm),
        source: 'local',
        barcode: customForm.barcode || null,
        override_calorie_check: override,
      })
      const keepOpen = await onSelect(saved)
      if (keepOpen !== false) onClose()
    } catch (err) {
      if (isCalorieMismatch(err)) {
        setCustomWarning(err.detail)
      } else {
        setError(err instanceof Error ? err.message : 'Failed to save ingredient.')
      }
    } finally {
      setSavingCustom(false)
    }
  }

  const handleSaveCustom = (e) => {
    e.preventDefault()
    void saveCustom(false)
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
              onClick={() => openCustomForm()}
              className="text-left text-xs text-mise-400 underline-offset-2 transition hover:text-mise-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              Add custom
            </button>
          </div>
        </div>
      )}

      {customMode && (
        <form onSubmit={handleSaveCustom} className="mt-2 space-y-3 rounded border border-mise-800 bg-mise-900/60 p-3">
          <p className="text-xs font-medium text-mise-500">Custom ingredient</p>
          <input
            type="text"
            value={customForm.name}
            onChange={(e) => updateCustomForm({ ...customForm, name: e.target.value })}
            placeholder="Name"
            aria-label="Ingredient name"
            required
            className={inputCls}
          />
          <NutritionFields form={customForm} onChange={updateCustomForm} idPrefix="custom-nutrition" />
          <CalorieMismatchNotice detail={customWarning} busy={savingCustom} onConfirm={() => saveCustom(true)} />
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
          {results.map((r, i) => {
            const complete = r.nutrition_complete !== false
            const servingLine = complete ? formatServingLine(r) : null
            return (
              <li key={i} className="rounded border border-mise-800 bg-mise-900/60">
                <div className="flex items-center gap-3 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm text-mise-300">{toTitleCase(r.name)}</span>
                      {r.source_url && (
                        <a href={r.source_url} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} className="text-mise-600 hover:text-mise-400" title="View source">
                          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                        </a>
                      )}
                      {(r.source === 'usda' || r.source === 'openfoodfacts') && (
                        <a
                          href={`https://www.startpage.com/sp/search?query=${encodeURIComponent(`${r.name} nutrition facts`)}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          className="text-mise-600 hover:text-mise-400"
                          title="Verify nutrition facts"
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        </a>
                      )}
                      {r.source === 'usda' && (
                        <span className="rounded-full border border-sky-500/40 bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-700 dark:text-sky-200">USDA</span>
                      )}
                      {r.source === 'openfoodfacts' && (
                        <span className="rounded-full border border-emerald-500/40 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-200">OFF</span>
                      )}
                    </div>
                    {r.source === 'openfoodfacts' && r.barcode && (
                      <p className="mt-0.5 text-[11px] text-mise-600">Barcode: {r.barcode}</p>
                    )}
                    {complete ? (
                      <>
                        <p className="mt-0.5 text-xs text-mise-500">{formatMacroLine(r)}</p>
                        {servingLine && <p className="mt-0.5 text-[11px] text-mise-500">{servingLine}</p>}
                      </>
                    ) : (
                      <p className="mt-0.5 text-xs text-mise-400">
                        {r.incomplete_reason || 'Nutrition values are incomplete'}. Enter the values manually.
                      </p>
                    )}
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
                  {complete ? (
                    <button
                      type="button"
                      disabled={savingIndex !== null}
                      onClick={() => handleUse(r, i)}
                      className="shrink-0 rounded bg-ember px-3 py-1.5 text-xs font-semibold text-mise-950 transition hover:bg-ember-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
                    >
                      {savingIndex === i ? 'Adding…' : 'Add'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => openCustomForm({ name: r.name, barcode: r.barcode, serving_grams: r.serving_grams })}
                      className="shrink-0 rounded border border-mise-700 px-3 py-1.5 text-xs font-semibold text-mise-300 transition hover:border-mise-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
                    >
                      Enter manually
                    </button>
                  )}
                </div>
                {addWarning?.key === resultKey(r) && (
                  <div className="px-3 pb-2">
                    <CalorieMismatchNotice
                      detail={addWarning.detail}
                      confirmLabel="Add anyway"
                      busy={savingIndex === i}
                      onConfirm={() => handleUse(r, i, true)}
                    />
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
