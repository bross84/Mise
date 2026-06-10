import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Pencil, Star, Trash2, X } from 'lucide-react'
import { deleteRecipe, getRecipe, updateRecipe } from '../api/client.js'

const tagHeaderTheme = {
  beef: 'from-rose-900/60 via-slate-900 to-slate-950 bg-rose-900/30',
  mexican: 'from-amber-900/60 via-slate-900 to-slate-950 bg-amber-900/25',
  'high protein': 'from-sky-900/60 via-slate-900 to-slate-950 bg-sky-900/25',
  fish: 'from-cyan-900/60 via-slate-900 to-slate-950 bg-cyan-900/25',
  mediterranean: 'from-emerald-900/60 via-slate-900 to-slate-950 bg-emerald-900/25',
  'meal prep': 'from-indigo-900/60 via-slate-900 to-slate-950 bg-indigo-900/25',
  vegetarian: 'from-lime-900/60 via-slate-900 to-slate-950 bg-lime-900/25',
  indian: 'from-orange-900/60 via-slate-900 to-slate-950 bg-orange-900/25',
  'one pot': 'from-violet-900/60 via-slate-900 to-slate-950 bg-violet-900/25',
  turkey: 'from-red-900/60 via-slate-900 to-slate-950 bg-red-900/25',
  breakfast: 'from-yellow-900/60 via-slate-900 to-slate-950 bg-yellow-900/20',
}

function getHeaderTheme(firstTag) {
  if (!firstTag) {
    return 'from-slate-800 via-slate-900 to-slate-950 bg-mise-800/40'
  }

  return tagHeaderTheme[firstTag.toLowerCase()] || 'from-slate-800 via-slate-900 to-slate-950 bg-mise-800/40'
}

function formatScaledAmount(amount) {
  if (Number.isInteger(amount)) {
    return amount
  }

  const rounded = Number(amount.toFixed(2))
  return Number.isInteger(rounded) ? rounded : rounded
}

function formatTimerLabel(timerSeconds) {
  if (timerSeconds < 60) {
    return `${timerSeconds} sec`
  }

  return `${Math.round(timerSeconds / 60)} min`
}

function StarRating() {
  const [rating, setRating] = useState(0)
  const [hovered, setHovered] = useState(0)

  const handleClick = (star) => {
    setRating((current) => (current === star ? 0 : star))
  }

  const displayed = hovered || rating

  return (
    <div className="mt-4 flex items-center gap-1" role="group" aria-label="Star rating">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          onClick={() => handleClick(star)}
          onMouseEnter={() => setHovered(star)}
          onMouseLeave={() => setHovered(0)}
          aria-label={`Rate ${star} star${star !== 1 ? 's' : ''}`}
          aria-pressed={rating === star}
          className="rounded text-amber-400 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
        >
          <Star
            size={20}
            className={star <= displayed ? 'fill-amber-400 text-amber-400' : 'fill-none text-mise-600'}
          />
        </button>
      ))}
    </div>
  )
}

const inputCls =
  'w-full rounded border border-mise-800 bg-mise-950 px-3 py-2 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember'

function makeDraftIngredient(values = {}) {
  return {
    id: values.id ?? `ing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: values.name ?? '',
    amount: values.amount ?? '',
    unit: values.unit ?? '',
  }
}

function makeDraftStep(values = {}) {
  return {
    id: values.id ?? `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    title: values.title ?? '',
    content: values.content ?? '',
    timerSeconds: values.timer_seconds != null ? String(values.timer_seconds) : '',
  }
}

function recipeToDraft(recipe) {
  return {
    title: recipe.title ?? '',
    servings: recipe.servings ?? 1,
    tags: Array.isArray(recipe.tags) ? [...recipe.tags] : [],
    notes: recipe.notes ?? '',
    ingredients: (recipe.ingredients ?? []).map(makeDraftIngredient),
    steps: (recipe.steps ?? []).map(makeDraftStep),
  }
}

function RecipeDetail() {
  const navigate = useNavigate()
  const { id } = useParams()
  const [recipe, setRecipe] = useState(null)
  const [mode, setMode] = useState('per-serving')
  const [servings, setServings] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    let active = true

    async function loadRecipe() {
      try {
        setLoading(true)
        setError('')
        const data = await getRecipe(id)

        if (!active) {
          return
        }

        setRecipe(data)
        setServings(data?.servings ?? 1)
      } catch (requestError) {
        if (!active) {
          return
        }

        setRecipe(null)
        setError(requestError instanceof Error ? requestError.message : 'Failed to load recipe.')
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadRecipe()

    return () => {
      active = false
    }
  }, [id])

  const headerTheme = getHeaderTheme(recipe?.tags?.[0])

  const handleModeChange = (nextMode) => {
    setMode(nextMode)
    setServings(recipe?.servings ?? 1)
  }

  const ingredientFactor = useMemo(() => {
    if (!recipe || recipe.servings <= 0) return 1
    if (mode === 'per-serving') return 1
    return servings / recipe.servings
  }, [recipe, mode, servings])

  const scaledIngredients = useMemo(() => {
    if (!recipe) return []

    return (recipe.ingredients ?? []).map((ingredient) => ({
      ...ingredient,
      scaledAmount: formatScaledAmount(Number(ingredient.amount) * ingredientFactor),
    }))
  }, [recipe, ingredientFactor])

  const handleEnterEdit = () => {
    setDraft(recipeToDraft(recipe))
    setTagInput('')
    setSaveError('')
    setEditing(true)
  }

  const handleCancelEdit = () => {
    setEditing(false)
    setDraft(null)
    setSaveError('')
  }

  const handleSaveEdit = async () => {
    setSaving(true)
    setSaveError('')

    const payload = {
      title: draft.title.trim(),
      servings: Number(draft.servings) || 1,
      tags: draft.tags,
      notes: draft.notes.trim() || null,
      ingredients: draft.ingredients
        .filter((ing) => ing.name.trim() || ing.amount || ing.unit.trim())
        .map((ing) => ({
          id: ing.id,
          name: ing.name.trim(),
          amount: Number(ing.amount) || 0,
          unit: ing.unit.trim(),
        })),
      steps: draft.steps
        .filter((step) => step.title.trim() || step.content.trim() || step.timerSeconds)
        .map((step) => ({
          id: step.id,
          title: step.title.trim(),
          content: step.content.trim(),
          timer_seconds: step.timerSeconds === '' ? null : Number(step.timerSeconds),
        })),
    }

    try {
      const updated = await updateRecipe(id, payload)
      setRecipe(updated)
      setServings(updated?.servings ?? 1)
      setEditing(false)
      setDraft(null)
    } catch (requestError) {
      setSaveError(requestError instanceof Error ? requestError.message : 'Failed to save recipe.')
    } finally {
      setSaving(false)
    }
  }

  const setDraftField = (field, value) => {
    setDraft((current) => ({ ...current, [field]: value }))
  }

  const updateDraftIngredient = (ingId, field, value) => {
    setDraft((current) => ({
      ...current,
      ingredients: current.ingredients.map((ing) =>
        ing.id === ingId ? { ...ing, [field]: value } : ing,
      ),
    }))
  }

  const updateDraftStep = (stepId, field, value) => {
    setDraft((current) => ({
      ...current,
      steps: current.steps.map((step) =>
        step.id === stepId ? { ...step, [field]: value } : step,
      ),
    }))
  }

  const addTag = (value) => {
    const normalized = value.trim()
    if (!normalized) return
    setDraft((current) => {
      if (current.tags.some((t) => t.toLowerCase() === normalized.toLowerCase())) return current
      return { ...current, tags: [...current.tags, normalized] }
    })
    setTagInput('')
  }

  const removeTag = (tag) => {
    setDraft((current) => ({ ...current, tags: current.tags.filter((t) => t !== tag) }))
  }

  if (loading) {
    return (
      <section className="mx-auto w-full max-w-4xl">
        <Link
          to="/"
          className="inline-flex items-center rounded border border-mise-800 px-3 py-2 text-sm text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
        >
          Back to recipes
        </Link>
        <div className="mt-6 rounded border border-theme bg-mise-900 p-6 text-mise-500">
          Loading recipe...
        </div>
      </section>
    )
  }

  if (error || !recipe) {
    return (
      <section className="mx-auto w-full max-w-4xl">
        <Link
          to="/"
          className="inline-flex items-center rounded border border-mise-800 px-3 py-2 text-sm text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
        >
          Back to recipes
        </Link>
        <div className="mt-6 rounded border border-theme bg-mise-900 p-6">
          <h1 className="text-2xl font-semibold tracking-tight text-mise-300">Recipe unavailable</h1>
          <p className="mt-2 text-mise-500">{error || 'The recipe you requested does not exist.'}</p>
        </div>
      </section>
    )
  }

  const tags = Array.isArray(recipe.tags) ? recipe.tags : []
  const steps = Array.isArray(recipe.steps) ? recipe.steps : []

  const handleDeleteRecipe = async () => {
    if (!window.confirm('Delete this recipe?')) {
      return
    }

    try {
      await deleteRecipe(id)
      navigate('/')
    } catch {
      window.alert('Failed to delete recipe. Please try again.')
    }
  }

  return (
    <section className="mx-auto w-full max-w-5xl">
      <div className="flex items-center justify-between gap-3">
        <Link
          to="/"
          className="inline-flex items-center rounded border border-mise-800 px-3 py-2 text-sm text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
        >
          Back to recipes
        </Link>
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              {saveError && (
                <span className="text-xs text-rose-400">{saveError}</span>
              )}
              <button
                type="button"
                onClick={handleCancelEdit}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded border border-mise-800 px-3 py-2 text-sm font-medium text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={saving}
                className="inline-flex items-center gap-2 rounded bg-ember px-3 py-2 text-sm font-semibold text-mise-950 transition hover:bg-ember-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={handleEnterEdit}
                className="inline-flex items-center gap-2 rounded border border-mise-800 px-3 py-2 text-sm font-medium text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              >
                <Pencil size={14} />
                Edit
              </button>
              <button
                type="button"
                onClick={handleDeleteRecipe}
                className="inline-flex items-center gap-2 rounded border border-rose-500/40 bg-transparent px-3 py-2 text-sm font-medium text-rose-300 transition hover:border-rose-400 hover:text-rose-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"
              >
                <Trash2 size={15} />
                Delete Recipe
              </button>
            </>
          )}
        </div>
      </div>

      <div
        className={`relative mt-6 h-56 w-full overflow-hidden rounded border border-theme bg-gradient-to-br md:h-72 ${editing ? getHeaderTheme(draft.tags?.[0]) : headerTheme}`}
        aria-hidden="true"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_25%,rgba(255,255,255,0.1),transparent_40%),radial-gradient(circle_at_80%_75%,rgba(255,255,255,0.08),transparent_45%)]" />
      </div>

      <header className="mt-6">
        {editing ? (
          <input
            type="text"
            value={draft.title}
            onChange={(e) => setDraftField('title', e.target.value)}
            placeholder="Recipe title"
            className="font-display w-full rounded border border-mise-800 bg-mise-950 px-3 py-2 text-3xl font-semibold text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          />
        ) : (
          <h1 className="font-display text-3xl font-semibold text-mise-300">{recipe.title}</h1>
        )}

        <div className="mt-3">
          {editing ? (
            <div className="rounded border border-mise-800 bg-mise-950 p-3">
              <div className="flex flex-wrap gap-2">
                {draft.tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1.5 rounded border border-mise-800 bg-mise-800/60 px-2.5 py-1 text-xs font-medium text-mise-300"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      aria-label={`Remove tag ${tag}`}
                      className="text-mise-500 transition hover:text-mise-300 focus-visible:outline-none"
                    >
                      <X size={11} />
                    </button>
                  </span>
                ))}
              </div>
              <div className="mt-2 flex gap-2">
                <input
                  type="text"
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addTag(tagInput)
                    }
                  }}
                  placeholder="Add a tag"
                  className={inputCls}
                />
                <button
                  type="button"
                  onClick={() => addTag(tagInput)}
                  className="rounded border border-mise-800 px-3 py-2 text-sm text-mise-300 transition hover:border-mise-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
                >
                  Add
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {tags.map((tag) => (
                <span
                  key={`${recipe.id}-${tag}`}
                  className="rounded border border-theme bg-mise-800/40 px-2.5 py-1 text-xs font-medium text-mise-500"
                >
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>

        {editing ? (
          <div className="mt-4 flex items-center gap-3">
            <label className="text-sm text-mise-500">Servings</label>
            <input
              type="number"
              min="1"
              value={draft.servings}
              onChange={(e) => setDraftField('servings', e.target.value)}
              className="w-24 rounded border border-mise-800 bg-mise-950 px-3 py-1.5 text-sm text-mise-300 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            />
          </div>
        ) : (
          <p className="mt-4 text-sm text-mise-500">Servings: {recipe.servings}</p>
        )}

        <StarRating />
      </header>

      {!editing && (
        <div className="mt-8 inline-flex items-center gap-4 rounded border border-theme bg-mise-900 px-4 py-3">
          <div className="flex items-center gap-4" role="radiogroup" aria-label="Serving mode">
            {[
              { value: 'per-serving', label: 'Per Serving' },
              { value: 'scale', label: 'Scale Recipe' },
            ].map(({ value, label }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={mode === value}
                onClick={() => handleModeChange(value)}
                className="flex items-center gap-1.5 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              >
                <span
                  className={[
                    'flex h-4 w-4 items-center justify-center rounded-sm border text-[10px] font-bold',
                    mode === value
                      ? 'border-ember bg-ember text-white'
                      : 'border-mise-700 text-transparent',
                  ].join(' ')}
                  aria-hidden="true"
                >
                  ✓
                </span>
                <span className={mode === value ? 'text-mise-300' : 'text-mise-500'}>{label}</span>
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 border-l border-theme pl-4">
            <button
              type="button"
              onClick={() => setServings((current) => Math.max(1, current - 1))}
              className="h-7 w-7 rounded border border-mise-800 text-base text-mise-300 transition hover:border-mise-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              aria-label="Decrease servings"
            >
              −
            </button>
            <p className="min-w-8 text-center text-sm font-semibold text-mise-300" aria-live="polite">
              {servings}
            </p>
            <button
              type="button"
              onClick={() => setServings((current) => current + 1)}
              className="h-7 w-7 rounded border border-mise-800 text-base text-mise-300 transition hover:border-mise-700 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              aria-label="Increase servings"
            >
              +
            </button>
            <p className="text-xs text-mise-500">servings</p>
          </div>
        </div>
      )}

      {editing ? (
        <div className="mt-6 space-y-6">
          {/* Ingredients editor */}
          <section className="rounded border border-theme bg-mise-900 p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xs font-medium uppercase tracking-widest text-mise-500">Ingredients</h2>
              <button
                type="button"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    ingredients: [...current.ingredients, makeDraftIngredient()],
                  }))
                }
                className="rounded border border-mise-800 px-3 py-1.5 text-sm text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              >
                Add row
              </button>
            </div>
            <div className="space-y-2">
              {draft.ingredients.map((ing, index) => (
                <div key={ing.id} className="grid grid-cols-12 gap-2 rounded border border-theme bg-mise-950/50 p-3">
                  <label htmlFor={`edit-ing-name-${ing.id}`} className="sr-only">Ingredient {index + 1} name</label>
                  <input
                    id={`edit-ing-name-${ing.id}`}
                    type="text"
                    value={ing.name}
                    onChange={(e) => updateDraftIngredient(ing.id, 'name', e.target.value)}
                    placeholder="Name"
                    className={`${inputCls} col-span-5`}
                  />
                  <label htmlFor={`edit-ing-amount-${ing.id}`} className="sr-only">Amount</label>
                  <input
                    id={`edit-ing-amount-${ing.id}`}
                    type="text"
                    value={ing.amount}
                    onChange={(e) => updateDraftIngredient(ing.id, 'amount', e.target.value)}
                    placeholder="Amount"
                    className={`${inputCls} col-span-3`}
                  />
                  <label htmlFor={`edit-ing-unit-${ing.id}`} className="sr-only">Unit</label>
                  <input
                    id={`edit-ing-unit-${ing.id}`}
                    type="text"
                    value={ing.unit}
                    onChange={(e) => updateDraftIngredient(ing.id, 'unit', e.target.value)}
                    placeholder="Unit"
                    className={`${inputCls} col-span-3`}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((current) => ({
                        ...current,
                        ingredients:
                          current.ingredients.length === 1
                            ? current.ingredients
                            : current.ingredients.filter((i) => i.id !== ing.id),
                      }))
                    }
                    aria-label={`Remove ingredient ${index + 1}`}
                    className="col-span-1 flex items-center justify-center text-rose-400 transition hover:text-rose-300 focus-visible:outline-none"
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Steps editor */}
          <section className="rounded border border-theme bg-mise-900 p-4">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-xs font-medium uppercase tracking-widest text-mise-500">Steps</h2>
              <button
                type="button"
                onClick={() =>
                  setDraft((current) => ({
                    ...current,
                    steps: [...current.steps, makeDraftStep()],
                  }))
                }
                className="rounded border border-mise-800 px-3 py-1.5 text-sm text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              >
                Add row
              </button>
            </div>
            <div className="space-y-3">
              {draft.steps.map((step, index) => (
                <div key={step.id} className="rounded border border-theme bg-mise-950/50 p-3">
                  <div className="grid grid-cols-12 gap-2">
                    <label htmlFor={`edit-step-title-${step.id}`} className="sr-only">Step {index + 1} title</label>
                    <input
                      id={`edit-step-title-${step.id}`}
                      type="text"
                      value={step.title}
                      onChange={(e) => updateDraftStep(step.id, 'title', e.target.value)}
                      placeholder="Step title"
                      className={`${inputCls} col-span-7`}
                    />
                    <label htmlFor={`edit-step-timer-${step.id}`} className="sr-only">Timer seconds</label>
                    <input
                      id={`edit-step-timer-${step.id}`}
                      type="number"
                      min="0"
                      value={step.timerSeconds}
                      onChange={(e) => updateDraftStep(step.id, 'timerSeconds', e.target.value)}
                      placeholder="Timer (sec)"
                      className={`${inputCls} col-span-4`}
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...current,
                          steps:
                            current.steps.length === 1
                              ? current.steps
                              : current.steps.filter((s) => s.id !== step.id),
                        }))
                      }
                      aria-label={`Remove step ${index + 1}`}
                      className="col-span-1 flex items-center justify-center text-rose-400 transition hover:text-rose-300 focus-visible:outline-none"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <label htmlFor={`edit-step-content-${step.id}`} className="sr-only">Step {index + 1} content</label>
                  <textarea
                    id={`edit-step-content-${step.id}`}
                    value={step.content}
                    onChange={(e) => updateDraftStep(step.id, 'content', e.target.value)}
                    placeholder="Step instructions"
                    rows={3}
                    className={`${inputCls} mt-2`}
                  />
                </div>
              ))}
            </div>
          </section>

          {/* Notes editor */}
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-widest text-mise-500" htmlFor="edit-notes">
              Notes
            </label>
            <textarea
              id="edit-notes"
              value={draft.notes}
              onChange={(e) => setDraftField('notes', e.target.value)}
              rows={4}
              placeholder="Any prep, storage, or serving notes"
              className={inputCls}
            />
          </div>
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
            <section className="rounded border border-theme bg-mise-900 p-4">
              <h2 className="text-xs font-medium uppercase tracking-widest text-mise-500">Ingredients</h2>
              <ul className="mt-4 space-y-2">
                {scaledIngredients.map((ingredient) => (
                  <li
                    key={ingredient.id}
                    className="flex items-baseline justify-between gap-4 rounded border border-theme bg-mise-950/50 px-3 py-2"
                  >
                    <span className="text-mise-400">{ingredient.name}</span>
                    <span className="text-sm font-medium text-mise-300">
                      {ingredient.scaledAmount} {ingredient.unit}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded border border-theme bg-mise-900 p-4">
              <h2 className="text-xs font-medium uppercase tracking-widest text-mise-500">Recipe Details</h2>
              <div className="mt-4 space-y-3 text-sm text-mise-400">
                <div className="rounded border border-theme bg-mise-950/50 px-3 py-2">
                  <span className="block text-xs uppercase tracking-widest text-mise-500">Notes</span>
                  <p className="mt-1">{recipe.notes || 'No notes provided.'}</p>
                </div>
                <div className="rounded border border-theme bg-mise-950/50 px-3 py-2">
                  <span className="block text-xs uppercase tracking-widest text-mise-500">Steps</span>
                  <p className="mt-1">{steps.length} step{steps.length === 1 ? '' : 's'}</p>
                </div>
                <div className="rounded border border-theme bg-mise-950/50 px-3 py-2">
                  <span className="block text-xs uppercase tracking-widest text-mise-500">Tags</span>
                  <p className="mt-1">{tags.length ? tags.join(', ') : 'No tags'}</p>
                </div>
              </div>
            </section>
          </div>

          <section className="mt-6 rounded border border-theme bg-mise-900 p-4">
            <h2 className="text-xs font-medium uppercase tracking-widest text-mise-500">Steps</h2>
            <ol className="mt-4 space-y-3">
              {steps.map((step, index) => (
                <li key={step.id} className="rounded border border-theme bg-mise-950/50 px-4 py-3">
                  <p className="text-sm font-medium text-mise-500">Step {index + 1}</p>
                  <div className="mt-1 flex items-center gap-2">
                    <p className="text-base font-semibold text-mise-300">{step.title}</p>
                    {step.timer_seconds !== null && step.timer_seconds !== undefined && (
                      <span className="rounded border border-ember/40 bg-ember/20 px-2 py-0.5 text-xs font-medium text-ember">
                        {formatTimerLabel(step.timer_seconds)}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-mise-400">{step.content}</p>
                </li>
              ))}
            </ol>
          </section>
        </>
      )}
    </section>
  )
}

export default RecipeDetail
