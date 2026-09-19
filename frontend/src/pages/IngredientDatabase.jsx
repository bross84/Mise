import { useEffect, useMemo, useRef, useState } from 'react'
import { createIngredient, deleteIngredient, getIngredientAudit, getIngredients, updateIngredient } from '../api/client.js'
import NutritionFields, { CalorieMismatchNotice } from '../components/NutritionFields.jsx'
import {
  emptyNutritionForm,
  isCalorieMismatch,
  isNutritionFormComplete,
  isStandardUnit,
  nutritionFormFromIngredient,
  nutritionFormToPayload,
} from '../utils/nutrition.js'

const secondaryButtonClassName =
  'rounded border border-mise-800 px-3 py-1.5 text-xs font-medium text-mise-300 transition hover:border-mise-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember'

const destructiveButtonClassName =
  'px-3 py-1.5 text-xs font-medium text-rose-400 transition hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember'

const fieldCls =
  'w-full rounded border border-mise-800 bg-mise-950 px-3 py-2 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember'



// Lists returned by GET /ingredients/audit, as filters for the table.
const REVIEW_FILTERS = [
  { key: 'calorie_mismatch', label: 'fail the calorie check' },
  { key: 'non_standard_basis', label: 'not saved per 100 g' },
  { key: 'missing_serving_weight', label: 'missing serving weight' },
]

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

  // Calorie-check warnings from the server; the save can be repeated with the override.
  const [draftWarning, setDraftWarning] = useState(null)
  const [editWarning, setEditWarning] = useState(null)

  const [audit, setAudit] = useState(null)
  const [reviewFilter, setReviewFilter] = useState(null)

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
        getIngredientAudit().then((d) => { if (active) setAudit(d) }).catch(() => {})
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
    getIngredientAudit().then(setAudit).catch(() => {})
  }

  // Why each flagged food needs review, keyed by ingredient id
  const reviewFlags = useMemo(() => {
    const flags = {}
    const add = (id, text) => { (flags[id] = flags[id] || []).push(text) }
    audit?.calorie_mismatch.forEach((i) => add(
      i.id,
      i.expected_calories > 0
        ? `Calories are ${Math.abs(i.delta_pct)}% ${i.delta_pct > 0 ? 'above' : 'below'} what the macros add up to (${i.expected_calories} cal).`
        : `Calories are ${i.calories} but the macros add up to 0.`,
    ))
    audit?.non_standard_basis.forEach((i) => add(i.id, `Saved as “${i.unit}” instead of per 100 g.`))
    audit?.missing_serving_weight.forEach((i) => add(i.id, `${i.serving_quantity} pieces per serving, but no serving weight.`))
    return flags
  }, [audit])

  // A filter that no longer matches anything (after fixing the last one) switches itself off
  const activeFilter = reviewFilter && audit?.[reviewFilter]?.length > 0 ? reviewFilter : null

  // Local table filter — runs against the saved list, not API results
  const filteredIngredients = useMemo(() => {
    const q = query.trim().toLowerCase()
    const reviewIds = activeFilter ? new Set(audit[activeFilter].map((i) => i.id)) : null
    return ingredients.filter((i) => (!reviewIds || reviewIds.has(i.id)) && (!q || i.name.toLowerCase().includes(q)))
  }, [ingredients, query, activeFilter, audit])

  useEffect(() => () => { clearTimeout(timerRef.current) }, [])

  const updateDraft = (next) => {
    setDraftWarning(null)
    setDraft(next)
  }

  const updateEditDraft = (next) => {
    setEditWarning(null)
    setEditDraft(next)
  }

  const handleAddManually = () => {
    setDraftWarning(null)
    setDraft({ name: query.trim(), ...emptyNutritionForm })
  }

  const handleClearDraft = () => {
    setDraft(null)
    setDraftWarning(null)
    setQuery('')
    setActionError('')
  }

  const saveDraft = async (override = false) => {
    setActionError('')
    setSubmitting(true)
    try {
      await createIngredient({
        name: draft.name.trim(),
        ...nutritionFormToPayload(draft),
        source: 'local',
        override_calorie_check: override,
      })
      handleClearDraft()
      await reloadIngredients()
    } catch (err) {
      if (isCalorieMismatch(err)) {
        setDraftWarning(err.detail)
      } else {
        setActionError(err instanceof Error ? err.message : 'Failed to save ingredient.')
      }
    } finally {
      setSubmitting(false)
    }
  }

  const handleSave = (e) => {
    e.preventDefault()
    void saveDraft(false)
  }

  const handleStartEdit = (ingredient) => {
    setEditingId(ingredient.id)
    setEditWarning(null)
    setEditDraft({
      name: ingredient.name,
      ...nutritionFormFromIngredient(ingredient),
      legacyUnit: isStandardUnit(ingredient.unit) ? null : ingredient.unit,
    })
    setActionError('')
  }

  const handleCancelEdit = () => {
    setEditingId(null)
    setEditDraft({})
    setEditWarning(null)
  }

  const saveEdit = async (override = false) => {
    setActionError('')
    if (!isNutritionFormComplete(editDraft)) {
      setActionError('Fill in calories, protein, carbs and fat, and the serving weight when values are per serving.')
      return
    }
    setEditSaving(true)
    try {
      await updateIngredient(editingId, {
        name: editDraft.name.trim(),
        ...nutritionFormToPayload(editDraft),
        override_calorie_check: override,
      })
      setEditingId(null)
      setEditDraft({})
      setEditWarning(null)
      await reloadIngredients()
    } catch (err) {
      if (isCalorieMismatch(err)) {
        setEditWarning(err.detail)
      } else {
        setActionError(err instanceof Error ? err.message : 'Failed to update ingredient.')
      }
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

      {audit && Object.keys(reviewFlags).length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-mise-500">Needs review</span>
          {REVIEW_FILTERS.map(({ key, label }) => audit[key].length > 0 && (
            <button
              key={key}
              type="button"
              aria-pressed={activeFilter === key}
              onClick={() => setReviewFilter(activeFilter === key ? null : key)}
              className={`rounded border px-2.5 py-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember ${
                activeFilter === key
                  ? 'border-mise-700 bg-mise-800 text-mise-300'
                  : 'border-mise-800 text-mise-400 hover:border-mise-700 hover:text-mise-300'
              }`}
            >
              {audit[key].length} {label}
            </button>
          ))}
        </div>
      )}

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
          <div>
            <label htmlFor="draft-name" className="mb-1 block text-xs text-mise-500">Name</label>
            <input
              id="draft-name"
              type="text"
              value={draft.name}
              onChange={(e) => updateDraft({ ...draft, name: e.target.value })}
              placeholder="Name"
              className={`${fieldCls} sm:max-w-md`}
              required
            />
          </div>
          <div className="mt-4">
            <NutritionFields form={draft} onChange={updateDraft} idPrefix="draft-nutrition" />
          </div>
          {draftWarning && (
            <div className="mt-3">
              <CalorieMismatchNotice detail={draftWarning} busy={submitting} onConfirm={() => saveDraft(true)} />
            </div>
          )}
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
              <th scope="col" className="px-4 py-3 font-medium">Calories per 100 g</th>
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
                        <div>
                          <label htmlFor="edit-name" className="mb-1 block text-xs text-mise-500">Name</label>
                          <input
                            id="edit-name"
                            type="text"
                            value={editDraft.name}
                            onChange={(e) => updateEditDraft({ ...editDraft, name: e.target.value })}
                            className={`${fieldCls} sm:max-w-md`}
                          />
                        </div>
                        <div className="mt-4">
                          <NutritionFields
                            form={editDraft}
                            onChange={updateEditDraft}
                            idPrefix="edit-nutrition"
                            legacyUnit={editDraft.legacyUnit}
                          />
                        </div>
                        {editWarning && (
                          <div className="mt-3">
                            <CalorieMismatchNotice detail={editWarning} busy={editSaving} onConfirm={() => saveEdit(true)} />
                          </div>
                        )}
                        <div className="mt-3 flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => saveEdit(false)}
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
                        <td className={`whitespace-nowrap border-l-2 p-0 cursor-pointer ${reviewFlags[ingredient.id] ? 'border-l-ember' : 'border-l-transparent'}`}>
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
                              <div className="flex flex-wrap gap-x-8 gap-y-1">
                                <div>Protein: <span className="font-medium text-mise-400">{ingredient.protein}g</span></div>
                                <div>Carbs: <span className="font-medium text-mise-400">{ingredient.carbs}g</span></div>
                                <div>Fat: <span className="font-medium text-mise-400">{ingredient.fat}g</span></div>
                              </div>
                              {ingredient.per_serving ? (
                                <p>
                                  One serving ({Math.round(ingredient.grams_per_piece * (ingredient.serving_quantity || 1) * 10) / 10} g):{' '}
                                  <span className="font-medium text-mise-400">{Math.round(ingredient.per_serving.calories)} cal</span>
                                  {ingredient.serving_quantity > 1 && (
                                    <>
                                      {'. '}One piece ({ingredient.grams_per_piece} g):{' '}
                                      <span className="font-medium text-mise-400">{Math.round(ingredient.per_piece.calories)} cal</span>
                                    </>
                                  )}
                                </p>
                              ) : (
                                <p>No serving weight set, so pieces and servings can’t be converted.</p>
                              )}
                              {(reviewFlags[ingredient.id] ?? []).map((reason) => (
                                <p key={reason} className="border-l-2 border-ember pl-3 text-mise-300">{reason}</p>
                              ))}
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
