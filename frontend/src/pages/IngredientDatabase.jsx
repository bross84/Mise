import { useEffect, useMemo, useRef, useState } from 'react'
import { createIngredient, deleteIngredient, getIngredients, updateIngredient } from '../api/client.js'

const secondaryButtonClassName =
  'rounded border border-mise-800 px-3 py-1.5 text-xs font-medium text-mise-300 transition hover:border-mise-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember'

const destructiveButtonClassName =
  'px-3 py-1.5 text-xs font-medium text-rose-400 transition hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember'

const fieldCls =
  'w-full rounded border border-mise-800 bg-mise-950 px-3 py-2 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember'



function IngredientDatabase() {
  const [query, setQuery] = useState('')

  // Inline add form state; null = hidden
  const [draft, setDraft] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const [actionError, setActionError] = useState('')

  // Inline edit state
  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState({})
  const [editSaving, setEditSaving] = useState(false)

  // Macro details expansion state — only one row expanded at a time
  const [expandedId, setExpandedId] = useState(null)

  const [ingredients, setIngredients] = useState([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')

  const timerRef = useRef(null)

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

  useEffect(() => () => { clearTimeout(timerRef.current) }, [])

  const handleAddManually = () => {
    setDraft({ name: query.trim(), calories: '', protein: '', carbs: '', fat: '', unit: 'per 100g' })
  }

  const handleClearDraft = () => {
    setDraft(null)
    setQuery('')
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
      unit: ingredient.unit || 'per 100g',
      serving_quantity: ingredient.serving_quantity > 1 ? String(ingredient.serving_quantity) : '',
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
      const servingQty = parseInt(editDraft.serving_quantity, 10)
      await updateIngredient(editingId, {
        name: editDraft.name.trim(),
        calories: Number(editDraft.calories) || 0,
        protein: Number(editDraft.protein) || 0,
        carbs: Number(editDraft.carbs) || 0,
        fat: Number(editDraft.fat) || 0,
        unit: editDraft.unit?.trim() || 'per 100g',
        serving_quantity: servingQty > 1 ? servingQty : 1,
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
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-mise-300">Ingredient Database</h1>
          <p className="mt-2 text-sm text-mise-500">Your saved ingredients.</p>
        </div>
        <button
          type="button"
          onClick={handleAddManually}
          className="shrink-0 inline-flex items-center gap-2 rounded border border-mise-800 px-3 py-2 text-sm font-medium text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
        >
          + Add ingredient
        </button>
      </header>

      <div className="mt-6">
        <label htmlFor="ingredient-search" className="sr-only">Filter ingredients</label>
        <input
          id="ingredient-search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter ingredients…"
          autoComplete="off"
          className="w-full rounded border border-mise-800 bg-mise-900 px-4 py-3 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
        />
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
              <th scope="col" className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-mise-800 text-mise-300">
            {loading ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-mise-500">Loading ingredients…</td>
              </tr>
            ) : filteredIngredients.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-mise-500">
                  {query.trim() ? `No saved ingredients match "${query}".` : 'No ingredients yet.'}
                </td>
              </tr>
            ) : (
              filteredIngredients.map((ingredient) => (
                <>
                  {ingredient.id === editingId ? (
                    <tr key={ingredient.id} className="bg-mise-800/20">
                      <td colSpan={3} className="px-4 py-3">
                        <div className="grid gap-3 sm:grid-cols-6">
                          <div className="sm:col-span-2">
                            <label className="mb-1 block text-xs text-mise-500">Name</label>
                            <input
                              type="text"
                              value={editDraft.name}
                              onChange={(e) => setEditDraft((d) => ({ ...d, name: e.target.value }))}
                              className={fieldCls}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-mise-500">Calories</label>
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={editDraft.calories}
                              onChange={(e) => setEditDraft((d) => ({ ...d, calories: e.target.value }))}
                              className={fieldCls}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-mise-500">Protein (g)</label>
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={editDraft.protein}
                              onChange={(e) => setEditDraft((d) => ({ ...d, protein: e.target.value }))}
                              className={fieldCls}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-mise-500">Carbs (g)</label>
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={editDraft.carbs}
                              onChange={(e) => setEditDraft((d) => ({ ...d, carbs: e.target.value }))}
                              className={fieldCls}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-mise-500">Fat (g)</label>
                            <input
                              type="number"
                              step="any"
                              min="0"
                              value={editDraft.fat}
                              onChange={(e) => setEditDraft((d) => ({ ...d, fat: e.target.value }))}
                              className={fieldCls}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-mise-500">Unit</label>
                            <input
                              type="text"
                              value={editDraft.unit ?? ingredient.unit}
                              onChange={(e) => setEditDraft((d) => ({ ...d, unit: e.target.value }))}
                              className={fieldCls}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-xs text-mise-500">Pieces per serving</label>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={editDraft.serving_quantity}
                              onChange={(e) => setEditDraft((d) => ({ ...d, serving_quantity: e.target.value }))}
                              placeholder="1"
                              className={fieldCls}
                            />
                          </div>
                        </div>
                        <div className="mt-3 flex items-center gap-2">
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
                    <>
                      <tr key={ingredient.id} className="hover:bg-mise-800/30">
                        <td className="whitespace-nowrap p-0 cursor-pointer">
                          <button
                            type="button"
                            onClick={() => setExpandedId(expandedId === ingredient.id ? null : ingredient.id)}
                            className="flex w-full items-center gap-2 px-4 py-3 text-left font-medium text-mise-300 transition hover:text-mise-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
                          >
                            {ingredient.source === 'off' && ingredient.barcode ? (
                              <a
                                href={`https://world.openfoodfacts.org/product/${ingredient.barcode}`}
                                target="_blank"
                                rel="noreferrer noopener"
                                onClick={(e) => e.stopPropagation()}
                                className="text-mise-300 underline-offset-2 hover:text-mise-200 hover:underline"
                              >
                                {ingredient.name}
                              </a>
                            ) : (
                              <span>{ingredient.name}</span>
                            )}
                            {ingredient.source === 'usda' && (
                              <span className="rounded border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-400">USDA</span>
                            )}
                            {ingredient.source === 'off' && (
                              <span className="rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-400">OFF</span>
                            )}
                          </button>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3">{ingredient.calories}</td>
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
                      {expandedId === ingredient.id && (
                        <tr className="bg-mise-800/10 hover:bg-mise-800/20">
                          <td colSpan={3} className="px-4 py-3">
                            <div className="space-y-1.5 text-xs text-mise-500">
                              <div className="flex gap-8">
                                <div>Protein: <span className="font-medium text-mise-400">{ingredient.protein}g</span></div>
                                <div>Carbs: <span className="font-medium text-mise-400">{ingredient.carbs}g</span></div>
                                <div>Fat: <span className="font-medium text-mise-400">{ingredient.fat}g</span></div>
                                <div>Unit: <span className="font-medium text-mise-400">{ingredient.unit}</span></div>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </>
                  )}
                </>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default IngredientDatabase
