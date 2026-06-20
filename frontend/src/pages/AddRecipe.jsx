import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { blockIngredient, createIngredient, createRecipe, getCookbooks, getIngredients, matchIngredients, parseIngredients, searchIngredients } from '../api/client.js'
import { MarkdownField } from '../components/MarkdownText.jsx'

const inputCls =
  'w-full rounded border border-mise-800 bg-mise-900 px-3 py-2.5 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember'

const primaryBtnCls =
  'rounded bg-ember px-4 py-2 text-sm font-semibold text-mise-950 transition hover:bg-ember-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember'

const secondaryBtnCls =
  'rounded border border-mise-800 px-3 py-2 text-sm font-medium text-mise-300 transition hover:border-mise-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember'

// ─── caret coordinate helper ────────────────────────────────────────────────

function getCaretCoords(el, index) {
  const style = window.getComputedStyle(el)
  const mirror = document.createElement('div')

  for (const prop of [
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'lineHeight',
    'letterSpacing', 'whiteSpace', 'wordWrap', 'width', 'tabSize',
  ]) {
    mirror.style[prop] = style[prop]
  }

  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.wordBreak = 'break-word'
  mirror.style.boxSizing = 'border-box'
  mirror.style.top = '0'
  mirror.style.left = '0'

  const text = document.createTextNode(el.value.slice(0, index))
  const marker = document.createElement('span')
  marker.textContent = '​'
  mirror.appendChild(text)
  mirror.appendChild(marker)

  document.body.appendChild(mirror)

  const lineH = parseFloat(style.lineHeight) || 20
  const coords = {
    top: marker.offsetTop - el.scrollTop + lineH,
    left: Math.min(marker.offsetLeft, el.clientWidth - 288),
  }

  document.body.removeChild(mirror)
  return coords
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function parseAmount(str) {
  if (!str) return 0
  const s = String(str).trim()
  const fraction = s.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (fraction) return parseInt(fraction[1]) / parseInt(fraction[2])
  const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/)
  if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3])
  const range = s.match(/^([\d.]+)\s*[-–]/)
  if (range) return parseFloat(range[1])
  return parseFloat(s) || 0
}

function toTitleCase(str) {
  return String(str ?? '').replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
}

function formatServingMacroLabel(result) {
  if (result.source === 'openfoodfacts' && result.unit && /^per\s+\d/.test(String(result.unit))) {
    return `${result.unit.replace('per', 'Per')}: ${Math.round(Number(result.calories) || 0)} cal · ${Math.round(Number(result.protein) || 0)}g protein · ${Math.round(Number(result.carbs) || 0)}g carbs · ${Math.round(Number(result.fat) || 0)}g fat`
  }

  const servingCandidate =
    result.serving_grams ??
    result.serving_size_g ??
    result.serving_size ??
    result.amount_grams ??
    100
  const numericServing = Number(servingCandidate)
  const servingG = Number.isFinite(numericServing) && numericServing > 0 ? numericServing : 100
  const scale = servingG / 100

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

// ─── IngredientSearchPanel ────────────────────────────────────────────────────

function IngredientSearchPanel({ ingredientName, onSaved, onClose }) {
  const [query, setQuery] = useState(ingredientName)
  const [barcodeMode, setBarcodeMode] = useState(false)
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchedExternal, setSearchedExternal] = useState(false)
  const [savingIndex, setSavingIndex] = useState(null)
  const [error, setError] = useState('')
  const [customDraft, setCustomDraft] = useState(null)
  const [customSaving, setCustomSaving] = useState(false)
  const timerRef = useRef(null)

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

  const handleSearchExternal = () => {
    const trimmed = query.trim()
    if (trimmed.length < 2) return
    clearTimeout(timerRef.current)
    setError('')
    setSearchedExternal(true)
    setSearching(true)
    searchIngredients(trimmed)
      .then((d) => setResults(d?.results ?? []))
      .catch(() => setResults([]))
      .finally(() => setSearching(false))
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

  const handleAdd = async (result, index) => {
    setSavingIndex(index)
    setError('')
    try {
      let saved
      if (result.source === 'local') {
        saved = { id: result.ingredient_id, name: result.name }
      } else {
        saved = await createIngredient({
          name: result.name,
          calories: result.calories,
          protein: result.protein,
          carbs: result.carbs,
          fat: result.fat,
          unit: result.unit || (result.serving_grams ? `per ${result.serving_grams}g` : 'per 100g'),
          source: result.source === 'usda' ? 'usda' : 'off',
          barcode: result.source === 'openfoodfacts' ? (result.barcode || null) : null,
        })
      }
      await onSaved(saved)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add ingredient.')
    } finally {
      setSavingIndex(null)
    }
  }

  return (
    <div className="mt-2 rounded border border-mise-700/60 bg-mise-950 p-3">
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
            className="w-full rounded border border-mise-800 bg-mise-900 px-3 py-2 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
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
              onClick={() => setCustomDraft({ name: query.trim(), calories: '', protein: '', carbs: '', fat: '', unit: 'per 100g' })}
              className="text-left text-xs text-mise-400 underline-offset-2 transition hover:text-mise-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              Add custom
            </button>
          </div>
        </div>
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
                    <span className="rounded-full border border-sky-500/30 bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200">USDA</span>
                  )}
                  {r.source === 'openfoodfacts' && (
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">OFF</span>
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
                onClick={() => handleAdd(r, i)}
                className="shrink-0 rounded bg-ember px-3 py-1.5 text-xs font-semibold text-mise-950 transition hover:bg-ember-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              >
                {savingIndex === i ? 'Adding…' : 'Add'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {customDraft === null ? (
        <button
          type="button"
          onClick={() => setCustomDraft({ name: query.trim(), calories: '', protein: '', carbs: '', fat: '', unit: 'per 100g' })}
          className="mt-2 flex w-full items-center gap-2 rounded border border-mise-800 px-3 py-2 text-left text-sm text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
        >
          + Add custom ingredient
        </button>
      ) : (
        <div className="mt-2 rounded border border-mise-700/60 bg-mise-900/60 p-3">
          <p className="mb-2 text-xs font-medium uppercase tracking-widest text-mise-500">Custom Ingredient</p>
          {error && <p className="mb-2 text-xs text-rose-400">{error}</p>}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <div className="col-span-2 sm:col-span-3">
              <label className="mb-1 block text-xs text-mise-500">Name</label>
              <input
                type="text"
                value={customDraft.name}
                onChange={(e) => setCustomDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Name"
                className="w-full rounded border border-mise-800 bg-mise-950 px-2 py-1.5 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              />
            </div>
            {[['calories', 'Calories'], ['protein', 'Protein (g)'], ['carbs', 'Carbs (g)'], ['fat', 'Fat (g)']].map(([field, label]) => (
              <div key={field}>
                <label className="mb-1 block text-xs text-mise-500">{label}</label>
                <input
                  type="number"
                  step="any"
                  min="0"
                  value={customDraft[field]}
                  onChange={(e) => setCustomDraft((d) => ({ ...d, [field]: e.target.value }))}
                  className="w-full rounded border border-mise-800 bg-mise-950 px-2 py-1.5 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
                />
              </div>
            ))}
            <div>
              <label className="mb-1 block text-xs text-mise-500">Serving Size</label>
              <input
                type="text"
                value={customDraft.unit}
                onChange={(e) => setCustomDraft((d) => ({ ...d, unit: e.target.value }))}
                placeholder="per 100g"
                className="w-full rounded border border-mise-800 bg-mise-950 px-2 py-1.5 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              />
            </div>
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              disabled={customSaving || !customDraft.name.trim()}
              onClick={async () => {
                setCustomSaving(true)
                setError('')
                try {
                  const saved = await createIngredient({
                    name: customDraft.name.trim(),
                    calories: Number(customDraft.calories) || 0,
                    protein: Number(customDraft.protein) || 0,
                    carbs: Number(customDraft.carbs) || 0,
                    fat: Number(customDraft.fat) || 0,
                    unit: customDraft.unit?.trim() || 'per 100g',
                  })
                  const matchedNow = await onSaved(saved)
                  if (matchedNow) onClose()
                  else setCustomDraft(null)
                } catch (err) {
                  setError(err instanceof Error ? err.message : 'Failed to save ingredient.')
                } finally {
                  setCustomSaving(false)
                }
              }}
              className="rounded bg-ember px-3 py-1.5 text-xs font-semibold text-mise-950 transition hover:bg-ember-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              {customSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => setCustomDraft(null)}
              className="rounded border border-mise-800 px-3 py-1.5 text-xs text-mise-500 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── MatchedIngredientList ────────────────────────────────────────────────────

function MatchedIngredientList({ matchResults, onRerun }) {
  const [openSearch, setOpenSearch] = useState(null)
  const [acceptedIndexes, setAcceptedIndexes] = useState([])
  const [skippedIndexes, setSkippedIndexes] = useState([])

  useEffect(() => {
    // Only reset on a full match reset (null), not on partial per-ingredient updates from onRerun
    if (matchResults === null) {
      setAcceptedIndexes([])
      setSkippedIndexes([])
    }
  }, [matchResults])

  if (!matchResults) return null

  const unmatchedResults = matchResults
    .map((result, index) => ({ result, index }))
    .filter((entry) => !entry.result.match)
    .filter((entry) => !acceptedIndexes.includes(entry.index))
    .filter((entry) => !skippedIndexes.includes(entry.index))

  if (unmatchedResults.length === 0) return null

  // Build display items with group name headers
  const displayItems = []
  let lastGroup = undefined
  unmatchedResults.forEach(({ result: r, index: i }) => {
    if (r.group_name !== lastGroup) {
      lastGroup = r.group_name
      if (r.group_name) {
        displayItems.push({ type: 'group', key: `group-${r.group_name}-${i}`, name: r.group_name })
      }
    }
    displayItems.push({ type: 'ingredient', key: i, result: r, index: i })
  })

  return (
    <div className="mt-4 rounded border border-theme bg-mise-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-widest text-mise-500">Ingredient Matches</h3>
        <button type="button" onClick={onRerun}
          className="rounded border border-mise-800 px-2.5 py-1 text-xs text-mise-400 transition hover:border-mise-700 hover:text-mise-300">
          Re-run matching
        </button>
      </div>
      <ul className="space-y-2">
        {displayItems.map((item) => {
          if (item.type === 'group') {
            return (
              <li key={item.key} className="pt-1 text-[10px] font-semibold uppercase tracking-widest text-mise-600">
                {item.name}
              </li>
            )
          }
          const { result: r, index: i } = item
          const isOpen = openSearch === r.name
          return (
            <li key={item.key}>
              <div className="flex items-center gap-3 rounded border border-theme bg-mise-950/50 px-3 py-2">
                <span className="text-sm">🔴</span>
                <span className="flex-1 text-sm text-mise-300">{toTitleCase(r.name)}</span>
                <button
                  type="button"
                  onClick={() => setSkippedIndexes((prev) => prev.includes(i) ? prev : [...prev, i])}
                  className="rounded border border-mise-800 px-2.5 py-1 text-xs text-mise-400 transition hover:border-mise-700 hover:text-mise-300"
                >
                  Skip
                </button>
                <button
                  type="button"
                  onClick={() => setOpenSearch(isOpen ? null : r.name)}
                  className="rounded border border-mise-800 px-2.5 py-1 text-xs text-mise-400 transition hover:border-mise-700 hover:text-mise-300"
                >
                  {isOpen ? 'Cancel' : 'Search & Add'}
                </button>
              </div>
              {isOpen && (
                <IngredientSearchPanel
                  ingredientName={r.name}
                  onClose={() => setOpenSearch(null)}
                  onSaved={async (saved) => {
                    const matched = await onRerun(i, saved)
                    setAcceptedIndexes((prev) => (prev.includes(i) ? prev : [...prev, i]))
                    return matched
                  }}
                />
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ─── AddRecipe ───────────────────────────────────────────────────────────────

export default function AddRecipe() {
  const navigate = useNavigate()
  const location = useLocation()

  const prefill = location.state?.prefill ?? null

  const [stage, setStage] = useState('input') // 'input' | 'review'

  // Form fields
  const [title, setTitle] = useState(prefill?.title ?? '')
  const [servingsStr, setServingsStr] = useState(prefill ? String(prefill.servings ?? 1) : '1')
  const [ingredientsText, setIngredientsText] = useState(prefill?.ingredients_text ?? '')
  const [instructions, setInstructions] = useState(prefill?.instructions ?? '')
  const [notes, setNotes] = useState(prefill?.notes ?? '')
  const [tagsText, setTagsText] = useState(prefill?.tags?.join(', ') ?? '')
  const [sourceUrl, setSourceUrl] = useState(prefill?.source_url ?? '')
  const [cookbook, setCookbook] = useState('')
  const [cookbooks, setCookbooks] = useState([])

  // AI parsing
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [parsedIngredients, setParsedIngredients] = useState([]) // [{raw, name, amount, unit, group_name}]

  // Matching
  const [matching, setMatching] = useState(false)
  const [matchResults, setMatchResults] = useState(null) // [{name, amount, unit, match, group_name}]

  // Saving
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // @ autocomplete
  const [dbIngredients, setDbIngredients] = useState([])
  const [mentionQuery, setMentionQuery] = useState(null)
  const [mentionStart, setMentionStart] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionCoords, setMentionCoords] = useState({ top: 0, left: 0 })
  const [ingredientOverrides, setIngredientOverrides] = useState({})
  const ingredientsRef = useRef(null)

  useEffect(() => {
    getCookbooks().then((d) => setCookbooks(Array.isArray(d) ? d : [])).catch(() => {})
    getIngredients().then((d) => setDbIngredients(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null || !dbIngredients.length) return []
    const q = mentionQuery.toLowerCase()
    if (!q) return dbIngredients.slice(0, 8)
    return dbIngredients.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 8)
  }, [mentionQuery, dbIngredients])

  const selectMention = (ingredient) => {
    const endPos = mentionStart + 1 + (mentionQuery?.length ?? 0)
    const newValue = ingredientsText.slice(0, mentionStart) + ingredient.name + ingredientsText.slice(endPos)
    setIngredientsText(newValue)
    setIngredientOverrides((prev) => ({ ...prev, [ingredient.name]: ingredient.id }))
    setMentionQuery(null)
    const newCursor = mentionStart + ingredient.name.length
    setTimeout(() => {
      if (ingredientsRef.current) {
        ingredientsRef.current.focus()
        ingredientsRef.current.setSelectionRange(newCursor, newCursor)
      }
    }, 0)
  }

  const handleIngredientsChange = (e) => {
    const value = e.target.value
    setIngredientsText(value)
    const pos = e.target.selectionStart
    const textBefore = value.slice(0, pos)
    const atIndex = textBefore.lastIndexOf('@')
    if (
      atIndex !== -1 &&
      !textBefore.slice(atIndex + 1).includes('\n') &&
      !textBefore.slice(atIndex + 1).includes(' ')
    ) {
      setMentionQuery(textBefore.slice(atIndex + 1))
      setMentionStart(atIndex)
      setMentionIndex(0)
      setMentionCoords(getCaretCoords(e.target, atIndex))
    } else {
      setMentionQuery(null)
    }
  }

  const handleIngredientsKeyDown = (e) => {
    if (mentionQuery === null || mentionMatches.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex((prev) => Math.min(prev + 1, mentionMatches.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex((prev) => Math.max(prev - 1, 0)) }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectMention(mentionMatches[mentionIndex]) }
    else if (e.key === 'Escape') { setMentionQuery(null) }
  }

  const runMatching = async (parsed) => {
    if (!parsed.length) return
    setMatching(true)
    try {
      const items = parsed.map((p) => ({ name: p.name, amount: parseAmount(p.amount), unit: p.unit || '' }))
      const data = await matchIngredients(items)
      const enriched = (data.results || []).map((r, i) => ({ ...r, group_name: parsed[i]?.group_name ?? null }))
      setMatchResults(enriched)
    } catch {
      // matching failure is non-fatal
    } finally {
      setMatching(false)
    }
  }

  const handleParseAndContinue = async () => {
    if (!ingredientsText.trim()) { setParseError('Please enter some ingredients.'); return }
    setParseError('')
    setSaveError('')
    setParsing(true)
    try {
      const data = await parseIngredients(ingredientsText.trim(), title.trim() || undefined)
      const parsed = data.ingredients || []
      setParsedIngredients(parsed)
      // Auto-fill tags only if the user has not already typed anything
      if (!tagsText.trim() && Array.isArray(data.suggested_tags) && data.suggested_tags.length > 0) {
        setTagsText(data.suggested_tags.join(', '))
      }
      setMatchResults(null)
      setStage('review')
      await runMatching(parsed)
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse ingredients.')
    } finally {
      setParsing(false)
    }
  }

  const handleStartOver = () => {
    setStage('input')
    setTitle('')
    setServingsStr('1')
    setIngredientsText('')
    setInstructions('')
    setNotes('')
    setTagsText('')
    setSourceUrl('')
    setParseError('')
    setParsedIngredients([])
    setMatchResults(null)
    setSaveError('')
    setIngredientOverrides({})
    setMentionQuery(null)
  }

  const handleSave = async () => {
    if (!title.trim()) { setSaveError('Recipe name is required.'); return }
    setSaveError('')
    setSaving(true)
    try {
      const tags = tagsText.split(',').map((t) => t.trim()).filter(Boolean)
      const ingredients = parsedIngredients.map((p, i) => ({
        id: `ing-${Date.now()}-${i}`,
        name: p.name,
        amount: parseAmount(p.amount),
        unit: p.unit || '',
        ingredient_id: ingredientOverrides[p.name] ?? matchResults?.[i]?.match?.ingredient_id ?? null,
        group_name: p.group_name ?? null,
      }))
      const recipe = await createRecipe({
        title: title.trim(),
        servings: parseInt(servingsStr, 10) || 1,
        tags,
        ingredients,
        instructions: instructions.trim() || null,
        notes: notes.trim() || null,
        source_url: sourceUrl.trim() || null,
        cookbook: cookbook.trim() || null,
        steps: [],
      })
      navigate(`/recipe/${recipe.id}`)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save recipe.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mx-auto w-full max-w-3xl">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-mise-300">
            {stage === 'input' ? (prefill ? 'Import Recipe' : 'Add Recipe') : 'Review & Save'}
          </h1>
          <p className="mt-2 text-sm text-mise-500">
            {stage === 'input'
              ? prefill
                ? 'Fields pre-filled from import — review and edit before parsing ingredients.'
                : 'Fill in the recipe details, then parse your ingredient list.'
              : 'Fix any unmatched ingredients below, then save.'}
          </p>
        </div>
        {stage === 'review' && (
          <button type="button" onClick={handleStartOver} className={`shrink-0 ${secondaryBtnCls}`}>
            Start Over
          </button>
        )}
      </header>

      {(parseError || saveError) && (
        <div className="mt-4 rounded border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {parseError || saveError}
        </div>
      )}

      <div className="mt-6 space-y-5">
        {/* Title + Servings */}
        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <div>
            <label className="mb-2 block text-sm font-medium text-mise-400" htmlFor="recipe-title">
              Recipe Name
            </label>
            <input
              id="recipe-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Beef Tacos"
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-mise-400" htmlFor="recipe-servings">
              Servings
            </label>
            <input
              id="recipe-servings"
              type="number"
              min="1"
              value={servingsStr}
              onChange={(e) => setServingsStr(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        {/* Tags + Source URL + Cookbook */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium text-mise-400" htmlFor="recipe-tags">
              Tags <span className="font-normal text-mise-600">(comma-separated)</span>
            </label>
            <input
              id="recipe-tags"
              type="text"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="high protein, meal prep"
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-mise-400" htmlFor="recipe-source">
              Source URL <span className="font-normal text-mise-600">(optional)</span>
            </label>
            <input
              id="recipe-source"
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://..."
              className={inputCls}
            />
          </div>
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-mise-400" htmlFor="recipe-cookbook">
            Cookbook <span className="font-normal text-mise-600">(optional)</span>
          </label>
          <input
            id="recipe-cookbook"
            type="text"
            list="cookbook-suggestions"
            value={cookbook}
            onChange={(e) => setCookbook(e.target.value)}
            placeholder="e.g. Salt Fat Acid Heat"
            className={inputCls}
            autoComplete="off"
          />
          <datalist id="cookbook-suggestions">
            {cookbooks.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>

        {/* Ingredients with @ autocomplete */}
        <div className="relative">
          <label className="mb-2 block text-sm font-medium text-mise-400" htmlFor="recipe-ingredients">
            Ingredients
            <span className="ml-2 text-xs font-normal text-mise-600">Type @ to link to ingredient database</span>
          </label>
          <textarea
            id="recipe-ingredients"
            ref={ingredientsRef}
            rows={8}
            value={ingredientsText}
            onChange={handleIngredientsChange}
            onKeyDown={handleIngredientsKeyDown}
            placeholder={'1 cup flour\n2 eggs\n1/2 tsp salt'}
            className={inputCls}
          />
          {mentionQuery !== null && mentionMatches.length > 0 && (
            <ul
              className="absolute z-30 max-h-48 w-72 overflow-y-auto rounded border border-mise-700 bg-mise-900 shadow-xl"
              style={{ top: mentionCoords.top + 32, left: mentionCoords.left }}
            >
              {mentionMatches.map((ing, i) => (
                <li key={ing.id} className="border-b border-mise-800 last:border-none">
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); selectMention(ing) }}
                    className={[
                      'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition focus-visible:outline-none',
                      i === mentionIndex ? 'bg-mise-800/60' : 'hover:bg-mise-800/40',
                    ].join(' ')}
                  >
                    <span className="flex-1 text-mise-300">{ing.name}</span>
                    <span className="shrink-0 text-xs text-mise-500">{ing.calories} cal · {ing.protein}g p</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Instructions */}
        <MarkdownField
          id="recipe-instructions"
          label="Instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={8}
          placeholder={'1. Preheat oven to 375°F\n2. Mix dry ingredients\n3. Add wet ingredients and stir until combined'}
          textareaClassName={inputCls}
        />

        {/* Notes */}
        <MarkdownField
          id="recipe-notes"
          label="Notes"
          labelExtra="(optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Meal prep tips, storage, substitutions..."
          textareaClassName={inputCls}
        />
      </div>

      {/* Review stage: ingredient match panel */}
      {stage === 'review' && (
        <>
          {matching && <p className="mt-4 text-xs text-mise-500">Matching ingredients…</p>}
          <MatchedIngredientList
            matchResults={matchResults}
            onRerun={async (resultIndex, savedIngredient) => {
              if (resultIndex === undefined) {
                await runMatching(parsedIngredients)
                return false
              }
              if (savedIngredient?.id) {
                setMatchResults((prev) => {
                  if (!prev) return prev
                  const next = [...prev]
                  next[resultIndex] = {
                    ...next[resultIndex],
                    match: { ingredient_id: savedIngredient.id, name: savedIngredient.name, confidence: 100, score: 100 },
                  }
                  return next
                })
                return true
              }
              const p = parsedIngredients[resultIndex]
              if (!p) return false
              try {
                const data = await matchIngredients([{ name: p.name, amount: parseAmount(p.amount), unit: p.unit || '' }])
                const r = data?.results?.[0]
                if (r) {
                  setMatchResults((prev) => {
                    if (!prev) return prev
                    const next = [...prev]
                    next[resultIndex] = { ...next[resultIndex], ...r }
                    return next
                  })
                  return Boolean(r?.match)
                }
              } catch {
                // non-fatal
              }
              return false
            }}
          />
        </>
      )}

      {/* Action buttons */}
      <div className="mt-6 flex gap-3">
        {stage === 'input' ? (
          <button
            type="button"
            onClick={handleParseAndContinue}
            disabled={parsing || !ingredientsText.trim()}
            className={`flex-1 py-3 text-base font-semibold ${primaryBtnCls}`}
          >
            {parsing ? 'Parsing Ingredients…' : 'Parse Ingredients & Continue →'}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !title.trim()}
              className={`flex-1 py-3 text-base font-semibold ${primaryBtnCls}`}
            >
              {saving ? 'Saving Recipe…' : 'Save Recipe'}
            </button>
            <button
              type="button"
              onClick={handleParseAndContinue}
              disabled={parsing || !ingredientsText.trim()}
              className={secondaryBtnCls}
              title="Re-parse ingredients after editing"
            >
              {parsing ? 'Parsing…' : 'Re-parse'}
            </button>
          </>
        )}
      </div>
    </section>
  )
}
