import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createRecipe, getIngredients } from '../api/client.js'

const inputClassName =
 'w-full rounded border border-mise-800 bg-mise-900 px-3 py-2.5 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember'

const primaryButtonClassName =
 'rounded bg-ember px-4 py-2 text-sm font-semibold text-mise-950 transition hover:bg-ember-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember'

const secondaryButtonClassName =
 ' border border-mise-800 px-3 py-2 text-sm font-medium text-mise-300 transition hover:border-mise-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember'

const destructiveButtonClassName =
 ' px-3 py-2 text-sm font-medium text-rose-400 transition hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember'

function createIngredient(initialValues = {}) {
 return {
 id: `ing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
 name: initialValues.name ?? '',
 amount: initialValues.amount ?? '',
 unit: initialValues.unit ?? '',
 }
}

function createStep(initialValues = {}) {
 return {
 id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
 title: initialValues.title ?? '',
 content: initialValues.content ?? '',
 timerSeconds: initialValues.timerSeconds ?? '',
 }
}

function buildEmptyRecipeDraft() {
 return {
 title: '',
 servings: 1,
 tags: [],
 ingredients: [createIngredient()],
 steps: [createStep()],
 notes: '',
 }
}


function AddRecipe() {
  const navigate = useNavigate()
  const [stage, setStage] = useState('input')
  const [rawText, setRawText] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [tagInput, setTagInput] = useState('')
  const [recipeDraft, setRecipeDraft] = useState(() => buildEmptyRecipeDraft())
  const [ingredientNameSet, setIngredientNameSet] = useState(() => new Set())
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  useEffect(() => {
    let active = true

    async function loadIngredients() {
      try {
        const data = await getIngredients()
        if (!active) {
          return
        }

        setIngredientNameSet(
          new Set((Array.isArray(data) ? data : []).map((ingredient) => ingredient.name.trim().toLowerCase())),
        )
      } catch {
        if (active) {
          setIngredientNameSet(new Set())
        }
      }
    }

    void loadIngredients()

    return () => {
      active = false
    }
  }, [])

  const isIngredientMatched = (name) => ingredientNameSet.has(name.trim().toLowerCase())

  const updateDraftField = (field, value) => {
    setRecipeDraft((currentDraft) => ({ ...currentDraft, [field]: value }))
  }

 const updateIngredient = (ingredientId, field, value) => {
 setRecipeDraft((currentDraft) => ({
 ...currentDraft,
 ingredients: currentDraft.ingredients.map((ingredient) =>
 ingredient.id === ingredientId ? { ...ingredient, [field]: value } : ingredient,
 ),
 }))
 }

 const updateStep = (stepId, field, value) => {
 setRecipeDraft((currentDraft) => ({
 ...currentDraft,
 steps: currentDraft.steps.map((step) =>
 step.id === stepId ? { ...step, [field]: value } : step,
 ),
 }))
 }

 const addTag = (value) => {
 const normalizedTag = value.trim()
 if (!normalizedTag) {
 return
 }

 setRecipeDraft((currentDraft) => {
 const hasTag = currentDraft.tags.some((tag) => tag.toLowerCase() === normalizedTag.toLowerCase())
 if (hasTag) {
 return currentDraft
 }

 return {
 ...currentDraft,
 tags: [...currentDraft.tags, normalizedTag],
 }
 })

 setTagInput('')
 }

 const removeTag = (tagToRemove) => {
 setRecipeDraft((currentDraft) => ({
 ...currentDraft,
 tags: currentDraft.tags.filter((tag) => tag !== tagToRemove),
 }))
 }

  const handleParseRecipe = () => {
    const guessedTitle =
      rawText.trim().split(/\r?\n/).find(Boolean)?.slice(0, 80) || 'Untitled Recipe'

    setRecipeDraft((currentDraft) => ({
      ...currentDraft,
      title: currentDraft.title.trim() ? currentDraft.title : guessedTitle,
      notes: currentDraft.notes.trim() ? currentDraft.notes : rawText.trim(),
    }))
    setTagInput('')
    setSaveError('')
    setStage('review')
  }

  const handleStartOver = () => {
    setRawText('')
    setSourceUrl('')
    setTagInput('')
    setRecipeDraft(buildEmptyRecipeDraft())
    setSaveError('')
    setStage('input')
  }

  const handleSaveRecipe = async (event) => {
    event.preventDefault()
    setSaveError('')
    setSaving(true)

    const assembledRecipe = {
      title: recipeDraft.title.trim(),
      servings: Number(recipeDraft.servings) || 1,
      tags: recipeDraft.tags,
      ingredients: recipeDraft.ingredients
        .filter((ingredient) => ingredient.name.trim() || ingredient.amount || ingredient.unit.trim())
        .map((ingredient) => ({
          id: ingredient.id,
          name: ingredient.name.trim(),
          amount: Number(ingredient.amount) || 0,
          unit: ingredient.unit.trim(),
        })),
      steps: recipeDraft.steps
        .filter((step) => step.title.trim() || step.content.trim() || step.timerSeconds)
        .map((step) => ({
          id: step.id,
          title: step.title.trim(),
          content: step.content.trim(),
          timer_seconds: step.timerSeconds === '' ? null : Number(step.timerSeconds),
        })),
      notes: recipeDraft.notes.trim() || null,
    }

    try {
      const createdRecipe = await createRecipe(assembledRecipe)
      navigate(`/recipe/${createdRecipe.id}`)
    } catch (requestError) {
      setSaveError(requestError instanceof Error ? requestError.message : 'Failed to save recipe.')
    } finally {
      setSaving(false)
    }
  }

 if (stage === 'input') {
 return (
 <section className="mx-auto flex min-h-[calc(100vh-12rem)] w-full max-w-3xl items-center">
 <div className="w-full rounded border border-theme bg-mise-900/70 p-6 sm:p-8">
 <header>
 <h1 className="font-display text-3xl font-semibold text-mise-300">Add Recipe</h1>
 <p className="mt-2 text-sm text-mise-500">Paste recipe content or provide a source URL, then parse into an editable draft.</p>
 </header>

 <div className="mt-6 space-y-5">
 <div>
 <label className="mb-2 block text-sm font-medium text-mise-400" htmlFor="raw-recipe-text">
 Recipe Text
 </label>
 <textarea
 id="raw-recipe-text"
 rows={12}
 value={rawText}
 onChange={(event) => setRawText(event.target.value)}
 placeholder="Paste a recipe, ingredients list, or any text..."
 className={inputClassName}
 />
 </div>

 <div>
 <label className="mb-2 block text-sm font-medium text-mise-400" htmlFor="source-url">
 Source URL
 </label>
 <div className="flex flex-col gap-2 sm:flex-row">
 <input
 id="source-url"
 type="url"
 value={sourceUrl}
 onChange={(event) => setSourceUrl(event.target.value)}
 placeholder="https://example.com/recipe"
 className={inputClassName}
 />
 <button
 type="button"
 className={`${secondaryButtonClassName} whitespace-nowrap`}
 aria-label="Fetch recipe from URL"
 >
 Fetch
 </button>
 </div>
 </div>

 <button
 type="button"
 onClick={handleParseRecipe}
 className="w-full bg-ember px-5 py-3 text-base font-semibold text-mise-950 transition hover:bg-ember-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
 >
 Parse Recipe
 </button>
 </div>
 </div>
 </section>
 )
 }

 return (
 <section className="mx-auto w-full max-w-6xl">
 <header>
 <h1 className="font-display text-3xl font-semibold text-mise-300">Review Parsed Recipe</h1>
 <p className="mt-2 text-sm text-mise-500">Edit parsed fields inline before saving.</p>
 </header>

 {saveError && (
 <div className="mt-4 rounded border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
 {saveError}
 </div>
 )}

 <form onSubmit={handleSaveRecipe} className="mt-6 space-y-6">
 <div className="grid gap-4 md:grid-cols-2">
 <div className="md:col-span-2">
 <label className="mb-2 block text-sm font-medium text-mise-400" htmlFor="recipe-title">
 Title
 </label>
 <input
 id="recipe-title"
 type="text"
 value={recipeDraft.title}
 onChange={(event) => updateDraftField('title', event.target.value)}
 className={inputClassName}
 required
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
 value={recipeDraft.servings}
 onChange={(event) => updateDraftField('servings', event.target.value)}
 className={inputClassName}
 required
 />
 </div>

 <div>
 <span className="mb-2 block text-sm font-medium text-mise-400" id="recipe-tags-label">
 Tags
 </span>
 <div className="rounded border border-mise-800 bg-mise-900 p-3" aria-labelledby="recipe-tags-label">
 <div className="flex flex-wrap gap-2">
 {recipeDraft.tags.map((tag) => (
 <span
 key={`tag-${tag}`}
 className="inline-flex items-center gap-2 border rounded border-mise-800 bg-mise-800 px-2.5 py-1 text-xs font-medium text-mise-300"
 >
 {tag}
 <button
 type="button"
 onClick={() => removeTag(tag)}
 className="text-mise-500 transition hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
 aria-label={`Remove tag ${tag}`}
 >
 X
 </button>
 </span>
 ))}
 </div>

 <div className="mt-3 flex flex-col gap-2 sm:flex-row">
 <label className="sr-only" htmlFor="new-tag-input">
 Add tag
 </label>
 <input
 id="new-tag-input"
 type="text"
 value={tagInput}
 onChange={(event) => setTagInput(event.target.value)}
 onKeyDown={(event) => {
 if (event.key === 'Enter') {
 event.preventDefault()
 addTag(tagInput)
 }
 }}
 placeholder="Add a tag"
 className={inputClassName}
 />
 <button
 type="button"
 onClick={() => addTag(tagInput)}
 className={`${secondaryButtonClassName} whitespace-nowrap`}
 >
 Add Tag
 </button>
 </div>
 </div>
 </div>
 </div>

 <section className="rounded border border-theme bg-mise-900 p-4">
 <div className="mb-4 flex items-center justify-between">
 <h2 className="text-lg font-semibold text-mise-300">Ingredients</h2>
 <button
 type="button"
 onClick={() =>
 setRecipeDraft((currentDraft) => ({
 ...currentDraft,
 ingredients: [...currentDraft.ingredients, createIngredient()],
 }))
 }
 className={secondaryButtonClassName}
 >
 Add ingredient
 </button>
 </div>

 <div className="space-y-3">
 {recipeDraft.ingredients.map((ingredient, index) => {
 const matched = isIngredientMatched(ingredient.name)

 return (
 <div
 key={ingredient.id}
 className="grid gap-2 rounded border border-theme bg-mise-950/50 p-4 md:grid-cols-12"
 >
 <label htmlFor={`ingredient-name-${ingredient.id}`} className="sr-only">
 Ingredient {index + 1} name
 </label>
 <input
 id={`ingredient-name-${ingredient.id}`}
 type="text"
 value={ingredient.name}
 onChange={(event) => updateIngredient(ingredient.id, 'name', event.target.value)}
 placeholder="Ingredient name"
 className="rounded border border-mise-800 bg-mise-900 px-3 py-2.5 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember md:col-span-4"
 />
 <label htmlFor={`ingredient-amount-${ingredient.id}`} className="sr-only">
 Ingredient {index + 1} amount
 </label>
 <input
 id={`ingredient-amount-${ingredient.id}`}
 type="text"
 value={ingredient.amount}
 onChange={(event) => updateIngredient(ingredient.id, 'amount', event.target.value)}
 placeholder="Amount"
 className="rounded border border-mise-800 bg-mise-900 px-3 py-2.5 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember md:col-span-2"
 />
 <label htmlFor={`ingredient-unit-${ingredient.id}`} className="sr-only">
 Ingredient {index + 1} unit
 </label>
 <input
 id={`ingredient-unit-${ingredient.id}`}
 type="text"
 value={ingredient.unit}
 onChange={(event) => updateIngredient(ingredient.id, 'unit', event.target.value)}
 placeholder="Unit"
 className="rounded border border-mise-800 bg-mise-900 px-3 py-2.5 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember md:col-span-2"
 />

 <div className="flex items-center gap-2 md:col-span-3">
 <span
 className={[
 'inline-flex items-center rounded border px-2.5 py-1 text-xs font-semibold',
 matched
 ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-300'
 : 'border-rose-500/40 bg-rose-500/15 text-rose-300',
 ].join(' ')}
 >
 {matched ? '🟢 Matched' : '🔴 Unmatched'}
 </span>
 {!matched && (
 <button
 type="button"
 className="rounded border border-mise-800 bg-mise-900 px-2 py-1 text-xs font-medium text-mise-300 transition hover:border-mise-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
 aria-label={`Add ${ingredient.name || 'ingredient'} to database`}
 >
 Add to database
 </button>
 )}
 </div>

 <button
 type="button"
 onClick={() =>
 setRecipeDraft((currentDraft) => ({
 ...currentDraft,
 ingredients:
 currentDraft.ingredients.length === 1
 ? currentDraft.ingredients
 : currentDraft.ingredients.filter((current) => current.id !== ingredient.id),
 }))
 }
 className={`${destructiveButtonClassName} md:col-span-1`}
 aria-label={`Remove ingredient ${index + 1}`}
 >
 -
 </button>
 </div>
 )
 })}
 </div>
 </section>

 <section className="rounded border border-theme bg-mise-900 p-4">
 <div className="mb-4 flex items-center justify-between">
 <h2 className="text-lg font-semibold text-mise-300">Steps</h2>
 <button
 type="button"
 onClick={() =>
 setRecipeDraft((currentDraft) => ({
 ...currentDraft,
 steps: [...currentDraft.steps, createStep()],
 }))
 }
 className={secondaryButtonClassName}
 >
 Add step
 </button>
 </div>

 <div className="space-y-3">
 {recipeDraft.steps.map((step, index) => (
 <div key={step.id} className="rounded border border-theme bg-mise-950/50 p-4">
 <div className="grid gap-2 md:grid-cols-12">
 <label htmlFor={`step-title-${step.id}`} className="sr-only">
 Step {index + 1} title
 </label>
 <input
 id={`step-title-${step.id}`}
 type="text"
 value={step.title}
 onChange={(event) => updateStep(step.id, 'title', event.target.value)}
 placeholder="Step title"
 className="rounded border border-mise-800 bg-mise-900 px-3 py-2.5 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember md:col-span-6"
 />
 <label htmlFor={`step-timer-${step.id}`} className="sr-only">
 Step {index + 1} timer in seconds
 </label>
 <input
 id={`step-timer-${step.id}`}
 type="number"
 min="0"
 value={step.timerSeconds}
 onChange={(event) => updateStep(step.id, 'timerSeconds', event.target.value)}
 placeholder="Timer (seconds, optional)"
 className="rounded border border-mise-800 bg-mise-900 px-3 py-2.5 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember md:col-span-5"
 />
 <button
 type="button"
 onClick={() =>
 setRecipeDraft((currentDraft) => ({
 ...currentDraft,
 steps:
 currentDraft.steps.length === 1
 ? currentDraft.steps
 : currentDraft.steps.filter((current) => current.id !== step.id),
 }))
 }
 className={`${destructiveButtonClassName} md:col-span-1`}
 aria-label={`Remove step ${index + 1}`}
 >
 -
 </button>
 </div>

 <label htmlFor={`step-content-${step.id}`} className="sr-only">
 Step {index + 1} content
 </label>
 <textarea
 id={`step-content-${step.id}`}
 value={step.content}
 onChange={(event) => updateStep(step.id, 'content', event.target.value)}
 placeholder="Step instructions"
 rows={3}
 className="mt-2 w-full rounded border border-mise-800 bg-mise-900 px-3 py-2.5 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
 />
 </div>
 ))}
 </div>
 </section>

 <div>
 <label className="mb-2 block text-sm font-medium text-mise-400" htmlFor="recipe-notes">
 Notes
 </label>
 <textarea
 id="recipe-notes"
 value={recipeDraft.notes}
 onChange={(event) => updateDraftField('notes', event.target.value)}
 rows={4}
 className={inputClassName}
 placeholder="Any prep, storage, or serving notes"
 />
 </div>

 <div className="flex flex-wrap items-center gap-3">
 <button type="submit" disabled={saving} className={primaryButtonClassName}>
 {saving ? 'Saving...' : 'Save Recipe'}
 </button>
 <button type="button" onClick={handleStartOver} className={secondaryButtonClassName}>
 Start Over
 </button>
 </div>
 </form>
 </section>
 )
}

export default AddRecipe
