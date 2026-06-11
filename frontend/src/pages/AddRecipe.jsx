import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createIngredient, createRecipe, getIngredients, matchIngredients, parseRecipe, searchIngredients } from '../api/client.js'

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

// ─── markdown parser ─────────────────────────────────────────────────────────

function parseMarkdownRecipe(md) {
  const lines = md.split('\n')
  let title = ''
  let servings = 1
  let tags = []
  let notes = ''
  const ingredients = []
  const steps = []

  let section = null
  let notesLines = []
  let stepCounter = 0

  for (const raw of lines) {
    const line = raw.trimEnd()

    // Title
    if (/^#\s+/.test(line)) {
      title = line.replace(/^#\s+/, '').trim()
      continue
    }

    // Servings
    const servingsMatch = line.match(/^\*\*Servings:\*\*\s*(\d+)/i)
    if (servingsMatch) { servings = parseInt(servingsMatch[1], 10); continue }

    // Tags
    const tagsMatch = line.match(/^\*\*Tags:\*\*\s*(.+)/i)
    if (tagsMatch) {
      tags = tagsMatch[1].split(',').map((t) => t.trim()).filter(Boolean)
      continue
    }

    // Section headers
    if (/^##\s+Ingredients/i.test(line)) { section = 'ingredients'; continue }
    if (/^##\s+Steps/i.test(line)) { section = 'steps'; continue }
    if (/^##\s+Notes/i.test(line)) { section = 'notes'; continue }
    if (/^##\s+/.test(line)) { section = null; continue }

    if (section === 'ingredients') {
      // - 250g chicken breast  OR  - 2 eggs
      const ingMatch = line.match(/^-\s+(\d*\.?\d+)\s*g\s+(.+)/)
      if (ingMatch) {
        ingredients.push({
          id: `ing-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: ingMatch[2].trim(),
          amount: parseFloat(ingMatch[1]),
          unit: 'g',
        })
      } else {
        const bare = line.match(/^-\s+(.+)/)
        if (bare) {
          ingredients.push({
            id: `ing-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: bare[1].trim(),
            amount: 0,
            unit: 'g',
          })
        }
      }
    }

    if (section === 'steps') {
      const stepMatch = line.match(/^\d+\.\s+(.+)/)
      if (stepMatch) {
        stepCounter++
        steps.push({
          id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          title: `Step ${stepCounter}`,
          content: stepMatch[1].trim(),
          timer_seconds: null,
        })
      }
    }

    if (section === 'notes' && line.trim()) {
      notesLines.push(line.trim())
    }
  }

  notes = notesLines.join('\n').trim() || null

  return { title, servings, tags, ingredients, steps, notes }
}

// Split on --- separator, ignoring empty blocks
function splitMarkdownRecipes(md) {
  return md
    .split(/^---$/m)
    .map((s) => s.trim())
    .filter(Boolean)
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

// ─── IngredientSearchPanel ────────────────────────────────────────────────────
// Inline panel (not a dropdown) for searching USDA/OFF and adding an ingredient

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
        .then((d) => setResults(d?.results ?? []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }
    if (immediate) { execute(); return }
    timerRef.current = setTimeout(execute, 400)
  }

  // Fire search immediately on mount with the pre-filled name
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
    if (trimmed.length < 2) {
      return
    }
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
    if (trimmed.length < 2) {
      return
    }
    clearTimeout(timerRef.current)
    setError('')
    setSearchedExternal(true)
    setSearching(true)
    searchIngredients(trimmed, { externalSource: 'usda' })
      .then((d) => setResults(d?.results ?? []))
      .catch(() => setResults([]))
      .finally(() => setSearching(false))
  }

  const handleSearchOpenFoodFacts = async () => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      return
    }
    clearTimeout(timerRef.current)
    setError('')
    setSearchedExternal(true)
    setSearching(true)
    try {
      const url = new URL('https://us.openfoodfacts.org/cgi/search.pl')
      url.searchParams.set('search_terms', trimmed)
      url.searchParams.set('search_simple', '1')
      url.searchParams.set('action', 'process')
      url.searchParams.set('json', '1')
      url.searchParams.set('page_size', '15')
      const response = await fetch(url.toString())
      if (!response.ok) {
        throw new Error('Open Food Facts search failed.')
      }
      const data = await response.json()
      const products = Array.isArray(data?.products) ? data.products : []
      const offResults = products
        .map((product) => {
          const nutriments = product?.nutriments ?? {}
          const name = (product?.product_name || product?.generic_name || '').trim()
          if (!name) {
            return null
          }

          const servingText = product?.serving_size ?? ''
          const servingMatch = String(servingText).match(/([\d.]+)\s*g/i)
          const servingGrams = servingMatch ? Number.parseFloat(servingMatch[1]) : null
          const caloriesServing = nutriments['energy-kcal_serving']
          const proteinServing = nutriments.proteins_serving
          const carbsServing = nutriments.carbohydrates_serving
          const fatServing = nutriments.fat_serving
          const hasServingMacros =
            caloriesServing != null ||
            proteinServing != null ||
            carbsServing != null ||
            fatServing != null

          let calories100g = Number(nutriments['energy-kcal_100g'])
          if (!Number.isFinite(calories100g)) {
            calories100g = Number(nutriments['energy_100g']) / 4.184
          }
          const protein100g = Number(nutriments.proteins_100g)
          const carbs100g = Number(nutriments.carbohydrates_100g)
          const fat100g = Number(nutriments.fat_100g)

          let calories = 0
          let protein = 0
          let carbs = 0
          let fat = 0
          let unit = 'per 100g'

          if (hasServingMacros) {
            calories = Number(caloriesServing)
            protein = Number(proteinServing)
            carbs = Number(carbsServing)
            fat = Number(fatServing)
            if (servingGrams) {
              unit = `per ${servingGrams}g`
            }
          } else if (servingGrams) {
            const factor = servingGrams / 100
            calories = (Number.isFinite(calories100g) ? calories100g : 0) * factor
            protein = (Number.isFinite(protein100g) ? protein100g : 0) * factor
            carbs = (Number.isFinite(carbs100g) ? carbs100g : 0) * factor
            fat = (Number.isFinite(fat100g) ? fat100g : 0) * factor
            unit = `per ${servingGrams}g`
          } else {
            calories = Number.isFinite(calories100g) ? calories100g : 0
            protein = Number.isFinite(protein100g) ? protein100g : 0
            carbs = Number.isFinite(carbs100g) ? carbs100g : 0
            fat = Number.isFinite(fat100g) ? fat100g : 0
          }

          return {
            name,
            calories: Math.round(calories * 10) / 10,
            protein: Math.round(protein * 10) / 10,
            carbs: Math.round(carbs * 10) / 10,
            fat: Math.round(fat * 10) / 10,
            unit,
            source: 'openfoodfacts',
            serving_grams: Number.isFinite(servingGrams) ? servingGrams : null,
            barcode: String(product?.code ?? '').trim() || null,
          }
        })
        .filter(Boolean)
      setResults(offResults)
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
  }

  const handleSearchByBarcode = () => {
    clearTimeout(timerRef.current)
    setError('')
    setResults([])
    setSearchedExternal(false)
    setBarcodeMode(true)
  }

  const handleBarcodeChange = async (e) => {
    const next = e.target.value.replace(/\D/g, '')
    setQuery(next)
    setError('')
    setSearchedExternal(true)
    if (!next) {
      setResults([])
      return
    }
    setSearching(true)
    try {
      const response = await fetch(`https://us.openfoodfacts.org/api/v0/product/${next}.json`)
      if (!response.ok) {
        throw new Error('Barcode lookup failed.')
      }
      const data = await response.json()
      if (data?.status !== 1 || !data?.product) {
        setResults([])
        return
      }
      const product = data.product
      const nutriments = product?.nutriments ?? {}
      const name = (product?.product_name || product?.generic_name || '').trim()
      if (!name) {
        setResults([])
        return
      }
      const servingText = product?.serving_size ?? ''
      const servingMatch = String(servingText).match(/([\d.]+)\s*g/i)
      const servingGrams = servingMatch ? Number.parseFloat(servingMatch[1]) : null
      const caloriesServing = nutriments['energy-kcal_serving']
      const proteinServing = nutriments.proteins_serving
      const carbsServing = nutriments.carbohydrates_serving
      const fatServing = nutriments.fat_serving
      const hasServingMacros =
        caloriesServing != null ||
        proteinServing != null ||
        carbsServing != null ||
        fatServing != null

      let calories100g = Number(nutriments['energy-kcal_100g'])
      if (!Number.isFinite(calories100g)) {
        calories100g = Number(nutriments['energy_100g']) / 4.184
      }
      const protein100g = Number(nutriments.proteins_100g)
      const carbs100g = Number(nutriments.carbohydrates_100g)
      const fat100g = Number(nutriments.fat_100g)

      let calories = 0
      let protein = 0
      let carbs = 0
      let fat = 0
      let unit = 'per 100g'

      if (hasServingMacros) {
        calories = Number(caloriesServing)
        protein = Number(proteinServing)
        carbs = Number(carbsServing)
        fat = Number(fatServing)
        if (servingGrams) {
          unit = `per ${servingGrams}g`
        }
      } else if (servingGrams) {
        const factor = servingGrams / 100
        calories = (Number.isFinite(calories100g) ? calories100g : 0) * factor
        protein = (Number.isFinite(protein100g) ? protein100g : 0) * factor
        carbs = (Number.isFinite(carbs100g) ? carbs100g : 0) * factor
        fat = (Number.isFinite(fat100g) ? fat100g : 0) * factor
        unit = `per ${servingGrams}g`
      } else {
        calories = Number.isFinite(calories100g) ? calories100g : 0
        protein = Number.isFinite(protein100g) ? protein100g : 0
        carbs = Number.isFinite(carbs100g) ? carbs100g : 0
        fat = Number.isFinite(fat100g) ? fat100g : 0
      }

      setResults([{
        name,
        calories: Math.round(calories * 10) / 10,
        protein: Math.round(protein * 10) / 10,
        carbs: Math.round(carbs * 10) / 10,
        fat: Math.round(fat * 10) / 10,
        unit,
        source: 'openfoodfacts',
        serving_grams: Number.isFinite(servingGrams) ? servingGrams : null,
        barcode: String(product?.code ?? '').trim() || null,
      }])
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
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
      const matchedNow = await onSaved(saved)
      if (matchedNow) onClose()
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
            type={barcodeMode ? 'text' : 'text'}
            value={query}
            onChange={barcodeMode ? handleBarcodeChange : handleQueryChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (!barcodeMode) {
                  runSearch(query, { immediate: true })
                }
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

      {results.length > 0 && (
        <ul className="space-y-1">
          {results.map((r, i) => (
            <li key={i} className="flex items-center gap-3 rounded border border-mise-800 bg-mise-900/60 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-mise-300">{r.name}</span>
                  {r.source === 'usda' && (
                    <span className="rounded-full border border-sky-500/30 bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200">USDA</span>
                  )}
                  {r.source === 'openfoodfacts' && (
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">OFF</span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-mise-500">{formatServingMacroLabel(r)}</p>
              </div>
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

      {!searching && results.length === 0 && query.trim().length >= 2 && (
        searchedExternal ? (
          <p className="text-xs text-mise-500">No USDA or Open Food Facts results found.</p>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleSearchUsda}
                className="rounded border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 text-xs font-medium text-sky-200 transition hover:border-sky-400/60 hover:bg-sky-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              >
                Search USDA
              </button>
              <button
                type="button"
                onClick={handleSearchOpenFoodFacts}
                className="rounded border border-emerald-500/40 bg-emerald-500/10 px-3 py-1.5 text-xs font-medium text-emerald-200 transition hover:border-emerald-400/60 hover:bg-emerald-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              >
                Search Open Food Facts
              </button>
            </div>
            <button
              type="button"
              onClick={handleSearchByBarcode}
              className="text-left text-xs text-mise-400 underline-offset-2 transition hover:text-mise-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              Search by barcode
            </button>
          </div>
        )
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
  const [openSearch, setOpenSearch] = useState(null) // ingredient name with panel open
  const [acceptedIndexes, setAcceptedIndexes] = useState([])

  useEffect(() => {
    setAcceptedIndexes([])
  }, [matchResults])

  if (!matchResults) return null

  const unmatchedResults = matchResults
    .map((result, index) => ({ result, index }))
    .filter((entry) => !entry.result.match)
    .filter((entry) => !acceptedIndexes.includes(entry.index))

  if (unmatchedResults.length === 0) return null

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
        {unmatchedResults.map(({ result: r, index: i }) => {
          const isOpen = openSearch === r.name
          return (
            <li key={i}>
              <div className="flex items-center gap-3 rounded border border-theme bg-mise-950/50 px-3 py-2">
                <span className="text-sm">🔴</span>
                <span className="flex-1 text-sm text-mise-300">{r.name}</span>
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
                    if (matched) {
                      setAcceptedIndexes((prev) => (prev.includes(i) ? prev : [...prev, i]))
                    }
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

  const [stage, setStage] = useState('input')   // 'input' | 'editor'

  // Stage 1
  const [rawText, setRawText] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')

  // Stage 2 — editor
  const [tabs, setTabs] = useState([''])
  const [activeTab, setActiveTab] = useState(0)

  // Stage 2 — matching
  const [matching, setMatching] = useState(false)
  const [matchResults, setMatchResults] = useState(null) // per-tab: array indexed by tab

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // Ingredient database for @ autocomplete
  const [dbIngredients, setDbIngredients] = useState([])
  const [mentionQuery, setMentionQuery] = useState(null) // null = inactive
  const [mentionStart, setMentionStart] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionCoords, setMentionCoords] = useState({ top: 0, left: 0 })
  const [ingredientOverrides, setIngredientOverrides] = useState({}) // name → ingredient_id
  const textareaRef = useRef(null)

  const matchedOnceRef = useRef({})

  useEffect(() => {
    getIngredients()
      .then((data) => setDbIngredients(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null || !dbIngredients.length) return []
    const q = mentionQuery.toLowerCase()
    if (!q) return dbIngredients.slice(0, 8)
    return dbIngredients.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 8)
  }, [mentionQuery, dbIngredients])

  const handleParse = async () => {
    setParseError('')
    setParsing(true)
    try {
      const result = await parseRecipe({ text: rawText.trim(), url: sourceUrl.trim() || undefined })
      const blocks = splitMarkdownRecipes(result.markdown)
      setTabs(blocks.length ? blocks : [result.markdown])
      setActiveTab(0)
      setMatchResults(null)
      setSaveError('')
      setStage('editor')
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Couldn't parse the recipe — try rephrasing or check the format.")
    } finally {
      setParsing(false)
    }
  }

  const handleStartOver = () => {
    setStage('input')
    setRawText('')
    setSourceUrl('')
    setParseError('')
    setTabs([''])
    setActiveTab(0)
    setMatchResults(null)
    setSaveError('')
    setIngredientOverrides({})
    setMentionQuery(null)
  }

  const runMatching = async (tabIndex) => {
    const recipe = parseMarkdownRecipe(tabs[tabIndex])
    if (!recipe.ingredients.length) return
    setMatching(true)
    try {
      const data = await matchIngredients(
        recipe.ingredients.map((i) => ({ name: i.name, amount: i.amount, unit: i.unit }))
      )
      setMatchResults((prev) => {
        const next = prev ? [...prev] : Array(tabs.length).fill(null)
        next[tabIndex] = data.results
        return next
      })
    } catch {
      // matching failure is non-fatal
    } finally {
      setMatching(false)
    }
  }

  // Run matching whenever we enter the editor stage or switch tabs
  const handleTabChange = (i) => {
    setActiveTab(i)
    if (!matchResults?.[i]) runMatching(i)
  }

  const applyMatchesToRecipe = (recipe, tabIndex) => {
    const results = matchResults?.[tabIndex]
    return {
      ...recipe,
      ingredients: recipe.ingredients.map((ing, i) => ({
        ...ing,
        ingredient_id:
          ingredientOverrides[ing.name] ??
          results?.[i]?.match?.ingredient_id ??
          null,
      })),
    }
  }

  const saveOne = async (index) => {
    const recipe = applyMatchesToRecipe(parseMarkdownRecipe(tabs[index]), index)
    return createRecipe(recipe)
  }

  const handleSaveOne = async () => {
    setSaveError('')
    setSaving(true)
    try {
      const created = await saveOne(activeTab)
      if (tabs.length === 1) {
        navigate(`/recipe/${created.id}`)
      } else {
        const next = tabs.filter((_, i) => i !== activeTab)
        setTabs(next)
        setActiveTab(Math.min(activeTab, next.length - 1))
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save recipe.')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAll = async () => {
    setSaveError('')
    setSaving(true)
    try {
      const results = []
      for (let i = 0; i < tabs.length; i++) results.push(await saveOne(i))
      navigate(`/recipe/${results[0].id}`)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save recipes.')
    } finally {
      setSaving(false)
    }
  }

  const updateTab = (value) => {
    setTabs((prev) => prev.map((t, i) => i === activeTab ? value : t))
    // clear stale match results for this tab when markdown changes
    setMatchResults((prev) => {
      if (!prev) return prev
      const next = [...prev]
      next[activeTab] = null
      return next
    })
  }

  const selectMention = (ingredient) => {
    const value = tabs[activeTab] ?? ''
    // end of @query = @ position + 1 (for @) + query length — never read from DOM
    const endPos = mentionStart + 1 + (mentionQuery?.length ?? 0)
    const newValue = value.slice(0, mentionStart) + ingredient.name + value.slice(endPos)
    setTabs((prev) => prev.map((t, i) => (i === activeTab ? newValue : t)))
    setIngredientOverrides((prev) => ({ ...prev, [ingredient.name]: ingredient.id }))
    setMentionQuery(null)
    const newCursor = mentionStart + ingredient.name.length
    setTimeout(() => {
      if (textareaRef.current) {
        textareaRef.current.focus()
        textareaRef.current.setSelectionRange(newCursor, newCursor)
      }
    }, 0)
  }

  const handleEditorChange = (e) => {
    const value = e.target.value
    updateTab(value)

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

  const handleEditorKeyDown = (e) => {
    if (mentionQuery === null || mentionMatches.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setMentionIndex((i) => Math.min(i + 1, mentionMatches.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setMentionIndex((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault()
      selectMention(mentionMatches[mentionIndex])
    } else if (e.key === 'Escape') {
      setMentionQuery(null)
    }
  }

  // ── Stage 1: input ──────────────────────────────────────────────────────

  if (stage === 'input') {
    return (
      <section className="mx-auto flex min-h-[calc(100vh-12rem)] w-full max-w-3xl items-center">
        <div className="w-full rounded border border-theme bg-mise-900/70 p-6 sm:p-8">
          <header>
            <h1 className="font-display text-3xl font-semibold text-mise-300">Add Recipe</h1>
            <p className="mt-2 text-sm text-mise-500">
              Paste recipe text or a URL — AI will format it into clean markdown you can edit before saving.
            </p>
          </header>

          {parseError && (
            <div className="mt-4 rounded border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {parseError}
            </div>
          )}

          <div className="mt-6 space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-mise-400" htmlFor="raw-recipe-text">
                Recipe Text
              </label>
              <textarea
                id="raw-recipe-text"
                rows={12}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="Paste a recipe, ingredients list, or any text..."
                className={inputCls}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-mise-400" htmlFor="source-url">
                Source URL
              </label>
              <input
                id="source-url"
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleParse() } }}
                placeholder="https://example.com/recipe"
                className={inputCls}
              />
            </div>

            <button
              type="button"
              onClick={handleParse}
              disabled={parsing || (!rawText.trim() && !sourceUrl.trim())}
              className={`w-full py-3 text-base font-semibold ${primaryBtnCls}`}
            >
              {parsing ? 'Formatting recipe…' : 'Parse Recipe'}
            </button>
          </div>
        </div>
      </section>
    )
  }

  // ── Stage 2: markdown editor ────────────────────────────────────────────

  const multiTab = tabs.length > 1

  const tabLabel = (md, i) => {
    const titleLine = md.split('\n').find((l) => /^#\s+/.test(l))
    return titleLine ? titleLine.replace(/^#\s+/, '').trim().slice(0, 32) : `Recipe ${i + 1}`
  }

  // Kick off matching for the active tab when first entering the editor stage
  if (stage === 'editor' && !matchedOnceRef.current[activeTab] && !matching) {
    matchedOnceRef.current[activeTab] = true
    runMatching(activeTab)
  }

  return (
    <section className="mx-auto w-full max-w-5xl">
      <header>
        <h1 className="font-display text-3xl font-semibold text-mise-300">
          {multiTab ? 'Review Parsed Recipes' : 'Review Parsed Recipe'}
        </h1>
        <p className="mt-2 text-sm text-mise-500">
          Edit the markdown below, then save. Changes here are reflected when saved.
        </p>
      </header>

      {saveError && (
        <div className="mt-4 rounded border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {saveError}
        </div>
      )}

      {/* Tab strip */}
      {multiTab && (
        <div className="mt-6 flex gap-1 overflow-x-auto border-b border-mise-800 pb-px">
          {tabs.map((md, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleTabChange(i)}
              className={[
                'shrink-0 rounded-t border border-b-0 px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember',
                activeTab === i
                  ? 'border-mise-700 bg-mise-900 text-mise-300'
                  : 'border-transparent text-mise-500 hover:text-mise-300',
              ].join(' ')}
            >
              {tabLabel(md, i)}
            </button>
          ))}
        </div>
      )}

      {/* Markdown editor */}
      <div className={`${multiTab ? 'mt-0' : 'mt-6'} relative`}>
        <textarea
          ref={textareaRef}
          key={activeTab}
          value={tabs[activeTab] ?? ''}
          onChange={handleEditorChange}
          onKeyDown={handleEditorKeyDown}
          spellCheck={false}
          className="w-full rounded border border-mise-800 bg-mise-900 px-4 py-3 font-mono text-sm leading-relaxed text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          style={{ minHeight: '60vh', resize: 'vertical' }}
        />
        {mentionQuery !== null && mentionMatches.length > 0 && (
          <ul
            className="absolute z-30 max-h-48 w-72 overflow-y-auto rounded border border-mise-700 bg-mise-900 shadow-xl"
            style={{ top: mentionCoords.top, left: mentionCoords.left }}
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
                  <span className="shrink-0 text-xs text-mise-500">
                    {ing.calories} cal · {ing.protein}g p
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Ingredient matching panel */}
      {matching && (
        <p className="mt-3 text-xs text-mise-500">Matching ingredients…</p>
      )}
      <MatchedIngredientList
        matchResults={matchResults?.[activeTab] ?? null}
        onRerun={async (resultIndex, savedIngredient) => {
          if (resultIndex === undefined) {
            matchedOnceRef.current[activeTab] = false
            setMatchResults((prev) => { const n = prev ? [...prev] : []; n[activeTab] = null; return n })
            await runMatching(activeTab)
            return false
          }

          // If the caller already saved the ingredient and gave us its record,
          // directly stamp the match — no need to re-run fuzzy matching.
          if (savedIngredient?.id) {
            setMatchResults((prev) => {
              if (!prev?.[activeTab]) return prev
              const next = [...prev]
              const tabResults = [...next[activeTab]]
              tabResults[resultIndex] = {
                ...tabResults[resultIndex],
                match: { ingredient_id: savedIngredient.id, name: savedIngredient.name, confidence: 100, score: 100 },
              }
              next[activeTab] = tabResults
              return next
            })
            return true
          }

          const recipe = parseMarkdownRecipe(tabs[activeTab])
          const ingredient = recipe.ingredients[resultIndex]
          if (!ingredient) {
            return false
          }

          try {
            const data = await matchIngredients([
              { name: ingredient.name, amount: ingredient.amount, unit: ingredient.unit },
            ])

            const refreshed = data?.results?.[0]
            setMatchResults((prev) => {
              if (!prev?.[activeTab]) {
                return prev
              }

              const next = [...prev]
              const tabResults = [...next[activeTab]]
              tabResults[resultIndex] = refreshed ?? tabResults[resultIndex]
              next[activeTab] = tabResults
              return next
            })

            return Boolean(refreshed?.match)
          } catch {
            return false
          }
        }}
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {multiTab && (
          <button type="button" onClick={handleSaveAll} disabled={saving || matching} className={primaryBtnCls}>
            {saving ? 'Saving…' : `Save All (${tabs.length})`}
          </button>
        )}
        <button type="button" onClick={handleSaveOne} disabled={saving || matching} className={primaryBtnCls}>
          {saving ? 'Saving…' : multiTab ? 'Save This One' : 'Save Recipe'}
        </button>
        <button type="button" onClick={handleStartOver} className={secondaryBtnCls}>
          Start Over
        </button>
      </div>
    </section>
  )
}
