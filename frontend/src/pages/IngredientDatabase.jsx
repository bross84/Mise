import { useEffect, useMemo, useRef, useState } from 'react'
import { createIngredient, deleteIngredient, getIngredients, searchIngredients, updateIngredient } from '../api/client.js'

const secondaryButtonClassName =
  'rounded border border-mise-800 px-3 py-1.5 text-xs font-medium text-mise-300 transition hover:border-mise-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember'

const destructiveButtonClassName =
  'px-3 py-1.5 text-xs font-medium text-rose-400 transition hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember'

const fieldCls =
  'w-full rounded border border-mise-800 bg-mise-950 px-3 py-2 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember'

function getServingGrams(result) {
  const candidates = [
    result.serving_grams,
    result.servingGrams,
    result.serving_size_g,
    result.serving_size,
    result.amount_grams,
    result.amount,
  ]

  for (const value of candidates) {
    const numeric = Number(value)
    if (Number.isFinite(numeric) && numeric > 0) {
      return numeric
    }
  }

  return 100
}

function formatScaledValue(value) {
  const scaled = Number(value)
  if (!Number.isFinite(scaled)) {
    return '0'
  }
  const rounded = Math.round(scaled * 10) / 10
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
}

function formatServingMacroLabel(result) {
  if (result.source === 'openfoodfacts' && result.unit && /^per\s+\d/.test(String(result.unit))) {
    return `${String(result.unit).replace('per', 'Per')}: ${formatScaledValue(result.calories)} cal · ${formatScaledValue(result.protein)}g protein · ${formatScaledValue(result.carbs)}g carbs · ${formatScaledValue(result.fat)}g fat`
  }

  const servingGrams = getServingGrams(result)
  const factor = servingGrams / 100

  return `Per ${formatScaledValue(servingGrams)}g: ${formatScaledValue(result.calories * factor)} cal · ${formatScaledValue(result.protein * factor)}g protein · ${formatScaledValue(result.carbs * factor)}g carbs · ${formatScaledValue(result.fat * factor)}g fat`
}



function IngredientDatabase() {
  const [query, setQuery] = useState('')
  const [apiResults, setApiResults] = useState([])
  const [dropdownOpen, setDropdownOpen] = useState(false)
  const [searching, setSearching] = useState(false)

  // Inline add form state; null = hidden
  const [draft, setDraft] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState('')
  const [selectSaving, setSelectSaving] = useState(false)

  // Inline edit state
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState({})
  const [editSaving, setEditSaving] = useState(false)

  const [ingredients, setIngredients] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const timerRef = useRef(null)
  const containerRef = useRef(null)

  // Close dropdown on outside click
  useEffect(() => {
    function handleOutside(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setDropdownOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  // Initial load
  useEffect(() => {
    let active = true
    async function load() {
      try {
        setLoading(true)
        setLoadError('')
        const data = await getIngredients()
        if (active) setIngredients(Array.isArray(data) ? data : [])
      } catch (err) {
        if (active) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load ingredients.')
          setIngredients([])
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => { active = false }
  }, [])

  const reloadIngredients = async () => {
    const data = await getIngredients()
    setIngredients(Array.isArray(data) ? data : [])
  }

  // Local table filter — runs against the saved list, not API results
  const filteredIngredients = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return ingredients
    return ingredients.filter((i) => i.name.toLowerCase().includes(q))
  }, [ingredients, query])

  const runSearch = (q, { immediate = false } = {}) => {
    clearTimeout(timerRef.current)

    if (q.trim().length < 2) {
      setApiResults([])
      setDropdownOpen(false)
      return
    }

    const execute = () => {
      setSearching(true)
      searchIngredients(q)
        .then((data) => {
          setApiResults(data?.results ?? [])
          setDropdownOpen(true)
        })
        .catch(() => setApiResults([]))
        .finally(() => setSearching(false))
    }

    if (immediate) {
      execute()
      return
    }

    timerRef.current = setTimeout(execute, 400)
  }

  const handleQueryChange = (e) => {
    const q = e.target.value
    setQuery(q)
    runSearch(q)
  }

  useEffect(() => {
    if (query.trim().length >= 2) {
      runSearch(query, { immediate: true })
    }
  }, [])

  useEffect(() => () => {
    clearTimeout(timerRef.current)
  }, [])

  const handleSelectResult = async (result) => {
    setDropdownOpen(false)
    setQuery(result.name)
    setApiResults([])

    if (result.source === 'local') {
      // Already in the local DB — just update the table filter
      return
    }

    // External result: auto-save to local DB immediately
    setSelectSaving(true)
    setActionError('')
    try {
      await createIngredient({
        name: result.name,
        calories: result.calories,
        protein: result.protein,
        carbs: result.carbs,
        fat: result.fat,
        unit: result.unit || (result.serving_grams ? `per ${result.serving_grams}g` : 'per 100g'),
        source: result.source === 'usda' ? 'usda' : 'off',
        barcode: result.source === 'openfoodfacts' ? (result.barcode || null) : null,
      })
      await reloadIngredients()
      setQuery('')
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to save ingredient.')
      await reloadIngredients()
    } finally {
      setSelectSaving(false)
    }
  }

  const handleAddManually = () => {
    setDropdownOpen(false)
    setDraft({ name: query.trim(), calories: '', protein: '', carbs: '', fat: '', unit: 'per 100g' })
  }

  const handleClearDraft = () => {
    setDraft(null)
    setQuery('')
    setApiResults([])
    setActionError('')
  }

  const handleSave = async (e) => {
    e.preventDefault()
    setActionError('')
    setSubmitting(true)
    try {
      await createIngredient({
        name: draft.name.trim(),
        calories: Number(draft.calories) || 0,
        protein: Number(draft.protein) || 0,
        carbs: Number(draft.carbs) || 0,
        fat: Number(draft.fat) || 0,
        unit: draft.unit?.trim() || 'per 100g',
      })
      handleClearDraft()
      await reloadIngredients()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to save ingredient.')
    } finally {
      setSubmitting(false)
    }
  }

  const handleStartEdit = (ingredient) => {
    setEditingId(ingredient.id)
    setEditDraft({
      name: ingredient.name,
      calories: String(ingredient.calories),
      protein: String(ingredient.protein),
      carbs: String(ingredient.carbs),
      fat: String(ingredient.fat),
    })
    setActionError('')
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditDraft({})
  }

  const handleSaveEdit = async () => {
    setEditSaving(true)
    setActionError('')
    try {
      await updateIngredient(editingId, {
        name: editDraft.name.trim(),
        calories: Number(editDraft.calories) || 0,
        protein: Number(editDraft.protein) || 0,
        carbs: Number(editDraft.carbs) || 0,
        fat: Number(editDraft.fat) || 0,
      })
      setEditingId(null)
      setEditDraft({})
      await reloadIngredients()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to update ingredient.')
    } finally {
      setEditSaving(false)
    }
  }

  const handleDeleteIngredient = async (ingredientId) => {
    setActionError('')
    try {
      await deleteIngredient(ingredientId)
      await reloadIngredients()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Failed to delete ingredient.')
    }
  }

  return (
    <section className="mx-auto w-full max-w-7xl">
      <header>
        <h1 className="font-display text-3xl font-semibold text-mise-300">Ingredient Database</h1>
        <p className="mt-2 text-sm text-mise-500">Search your local database first, or find ingredients from USDA / Open Food Facts — selecting an external result saves it locally.</p>
      </header>

      {/* Persistent search / add bar */}
      <div ref={containerRef} className="relative mt-6">
        <label htmlFor="ingredient-add-search" className="sr-only">Search or add ingredient</label>
        <input
          id="ingredient-add-search"
          type="text"
          value={query}
          onChange={handleQueryChange}
          onFocus={() => apiResults.length > 0 && setDropdownOpen(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              if (query.trim().length >= 2) {
                runSearch(query, { immediate: true })
              } else if (!dropdownOpen && query.trim()) {
                handleAddManually()
              }
            }
            if (e.key === 'Escape') setDropdownOpen(false)
          }}
          placeholder="Search or add ingredient…"
          autoComplete="off"
          className="w-full rounded border border-mise-800 bg-mise-900 px-4 py-3 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
        />
        {(searching || selectSaving) && (
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-mise-500">
            {selectSaving ? 'Saving…' : 'Searching…'}
          </span>
        )}

        {/* API results dropdown */}
        {dropdownOpen && (apiResults.length > 0 || query.trim().length >= 2) && (
          <ul className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded border border-mise-800 bg-mise-900 shadow-xl">
            {apiResults.map((result, i) => (
              <li key={i} className="border-b border-mise-800 last:border-none">
                <button
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => handleSelectResult(result)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-mise-800/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
                >
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <span className="text-sm text-mise-300">{result.name}</span>
                    {result.source === 'usda' && (
                      <span className="shrink-0 rounded border border-sky-500/30 bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200">USDA</span>
                    )}
                    {result.source === 'openfoodfacts' && (
                      <span className="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/20 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">OFF</span>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-mise-500">
                    {formatServingMacroLabel(result)}
                  </span>
                </button>
              </li>
            ))}
            {searching && apiResults.length === 0 && (
              <li className="px-4 py-3 text-xs text-mise-500">Searching…</li>
            )}
            {!searching && apiResults.length === 0 && query.trim().length >= 2 && (
              <li className="px-4 py-3 text-xs text-mise-500">No results found.</li>
            )}
            <li className="border-t border-mise-800">
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={handleAddManually}
                className="flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition hover:bg-mise-800/60 focus-visible:outline-none"
              >
                <span className="text-mise-400">+ Add custom ingredient</span>
                {query.trim() && <span className="text-mise-500">&ldquo;{query.trim()}&rdquo;</span>}
              </button>
            </li>
          </ul>
        )}
      </div>

      {/* Inline pre-fill form */}
      {draft !== null && (
        <form
          onSubmit={handleSave}
          className="mt-3 rounded border border-mise-700/50 bg-mise-900 p-4"
        >
          <p className="mb-3 text-xs font-medium uppercase tracking-widest text-mise-500">New Ingredient</p>
          {actionError && (
            <p className="mb-3 text-xs text-rose-400">{actionError}</p>
          )}
          <div className="grid gap-3 sm:grid-cols-6">
            <div className="sm:col-span-2">
              <label htmlFor="draft-name" className="mb-1 block text-xs text-mise-500">Name</label>
              <input
                id="draft-name"
                type="text"
                value={draft.name}
                onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))}
                placeholder="Name"
                className={fieldCls}
                required
              />
            </div>
            <div>
              <label htmlFor="draft-calories" className="mb-1 block text-xs text-mise-500">Calories</label>
              <input
                id="draft-calories"
                type="number"
                step="any"
                min="0"
                value={draft.calories}
                onChange={(e) => setDraft((d) => ({ ...d, calories: e.target.value }))}
                placeholder="kcal"
                className={fieldCls}
                required
              />
            </div>
            <div>
              <label htmlFor="draft-protein" className="mb-1 block text-xs text-mise-500">Protein (g)</label>
              <input
                id="draft-protein"
                type="number"
                step="any"
                min="0"
                value={draft.protein}
                onChange={(e) => setDraft((d) => ({ ...d, protein: e.target.value }))}
                placeholder="g"
                className={fieldCls}
                required
              />
            </div>
            <div>
              <label htmlFor="draft-carbs" className="mb-1 block text-xs text-mise-500">Carbs (g)</label>
              <input
                id="draft-carbs"
                type="number"
                step="any"
                min="0"
                value={draft.carbs}
                onChange={(e) => setDraft((d) => ({ ...d, carbs: e.target.value }))}
                placeholder="g"
                className={fieldCls}
                required
              />
            </div>
            <div>
              <label htmlFor="draft-fat" className="mb-1 block text-xs text-mise-500">Fat (g)</label>
              <input
                id="draft-fat"
                type="number"
                step="any"
                min="0"
                value={draft.fat}
                onChange={(e) => setDraft((d) => ({ ...d, fat: e.target.value }))}
                placeholder="g"
                className={fieldCls}
                required
              />
            </div>
          </div>
          <div className="mt-3">
            <label htmlFor="draft-unit" className="mb-1 block text-xs text-mise-500">Serving Size</label>
            <input
              id="draft-unit"
              type="text"
              value={draft.unit ?? 'per 100g'}
              onChange={(e) => setDraft((d) => ({ ...d, unit: e.target.value }))}
              placeholder="e.g. per 100g, per 1 cup"
              className={`${fieldCls} max-w-xs`}
            />
          </div>
          <div className="mt-3 flex items-center gap-3">
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-ember px-4 py-2 text-sm font-semibold text-mise-950 transition hover:bg-ember-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={handleClearDraft}
              className="rounded border border-mise-800 px-3 py-2 text-sm text-mise-500 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              Clear
            </button>
          </div>
        </form>
      )}

      {loadError && (
        <div className="mt-4 rounded border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {loadError}
        </div>
      )}

      <div className="mt-6 overflow-x-auto rounded border border-theme bg-mise-900">
        <table className="min-w-full divide-y divide-mise-800 text-left text-sm">
          <thead className="bg-mise-950/60 text-xs uppercase tracking-wide text-mise-500">
            <tr>
              <th scope="col" className="px-4 py-3 font-medium">Name</th>
              <th scope="col" className="px-4 py-3 font-medium">Calories</th>
              <th scope="col" className="px-4 py-3 font-medium">Protein</th>
              <th scope="col" className="px-4 py-3 font-medium">Carbs</th>
              <th scope="col" className="px-4 py-3 font-medium">Fat</th>
              <th scope="col" className="px-4 py-3 font-medium">Unit</th>
              <th scope="col" className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-mise-800 text-mise-300">
            {loading ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-mise-500">Loading ingredients…</td>
              </tr>
            ) : filteredIngredients.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-mise-500">
                  {query.trim() ? `No saved ingredients match "${query}".` : 'No ingredients yet.'}
                </td>
              </tr>
            ) : (
              filteredIngredients.map((ingredient) => (
                ingredient.id === editingId ? (
                  <tr key={ingredient.id} className="bg-mise-800/20">
                    <td className="px-2 py-1.5">
                      <input
                        type="text"
                        value={editDraft.name}
                        onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                        className={fieldCls}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={editDraft.calories}
                        onChange={(e) => setEditDraft((d) => ({ ...d, calories: e.target.value }))}
                        className={fieldCls}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={editDraft.protein}
                        onChange={(e) => setEditDraft((d) => ({ ...d, protein: e.target.value }))}
                        className={fieldCls}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={editDraft.carbs}
                        onChange={(e) => setEditDraft((d) => ({ ...d, carbs: e.target.value }))}
                        className={fieldCls}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="number"
                        step="any"
                        min="0"
                        value={editDraft.fat}
                        onChange={(e) => setEditDraft((d) => ({ ...d, fat: e.target.value }))}
                        className={fieldCls}
                      />
                    </td>
                    <td className="whitespace-nowrap px-4 py-2 text-mise-400">{ingredient.unit}</td>
                    <td className="whitespace-nowrap px-4 py-2">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={handleSaveEdit}
                          disabled={editSaving}
                          className="rounded bg-ember px-3 py-1.5 text-xs font-semibold text-mise-950 transition hover:bg-ember-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
                        >
                          {editSaving ? 'Saving…' : 'Save'}
                        </button>
                        <button
                          type="button"
                          onClick={handleCancelEdit}
                          className={secondaryButtonClassName}
                        >
                          Cancel
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={ingredient.id} className="hover:bg-mise-800/30">
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-2">
                        {ingredient.source === 'off' && ingredient.barcode ? (
                          <a
                            href={`https://world.openfoodfacts.org/product/${ingredient.barcode}`}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="font-medium text-mise-300 underline-offset-2 hover:text-mise-200 hover:underline"
                          >
                            {ingredient.name}
                          </a>
                        ) : (
                          <span className="font-medium text-mise-300">{ingredient.name}</span>
                        )}
                        {ingredient.source === 'usda' && (
                          <span className="rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-400">USDA</span>
                        )}
                        {ingredient.source === 'off' && (
                          <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">OFF</span>
                        )}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3">{ingredient.calories}</td>
                    <td className="whitespace-nowrap px-4 py-3">{ingredient.protein}</td>
                    <td className="whitespace-nowrap px-4 py-3">{ingredient.carbs}</td>
                    <td className="whitespace-nowrap px-4 py-3">{ingredient.fat}</td>
                    <td className="whitespace-nowrap px-4 py-3 text-mise-400">{ingredient.unit}</td>
                    <td className="whitespace-nowrap px-4 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => handleStartEdit(ingredient)}
                          className={secondaryButtonClassName}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDeleteIngredient(ingredient.id)}
                          className={destructiveButtonClassName}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default IngredientDatabase
