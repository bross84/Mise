import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Download, Pencil, Share2, Star, Trash2, X } from 'lucide-react'
import { MarkdownField, MarkdownText } from '../components/MarkdownText.jsx'
import {
  blockIngredient,
  createIngredient,
  deleteRecipe,
  getIngredients,
  getRecipe,
  getRecipeMacros,
  searchIngredients,
  updateRecipe,
} from '../api/client.js'

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

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api'

function RecipeHeroImage({ recipeId, title }) {
  const [imageUrl, setImageUrl] = useState(null)
  const [loadingImage, setLoadingImage] = useState(true)
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    if (!recipeId) return undefined
    let active = true

    async function loadImage() {
      try {
        if (active) setLoadingImage(true)

        const response = await fetch(`${API_BASE_URL}/recipes/${encodeURIComponent(recipeId)}/image`)
        if (!response.ok) throw new Error(`Image request failed with status ${response.status}`)

        const data = await response.json()
        if (active) setImageUrl(data?.image_url ?? null)
      } catch {
        if (active) setImageUrl(null)
      } finally {
        if (active) {
          setLoadingImage(false)
          setRefreshing(false)
        }
      }
    }

    void loadImage()
    return () => { active = false }
  }, [recipeId])

  const handleRefresh = () => {
    if (refreshing || loadingImage) return
    setRefreshing(true)

    let active = true
    async function doRefresh() {
      try {
        setLoadingImage(true)
        await fetch(`${API_BASE_URL}/recipes/${encodeURIComponent(recipeId)}/image/clear`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
        })

        const response = await fetch(`${API_BASE_URL}/recipes/${encodeURIComponent(recipeId)}/image`)
        if (!response.ok) throw new Error(`Image request failed with status ${response.status}`)

        const data = await response.json()
        if (active) setImageUrl(data?.image_url ?? null)
      } catch {
        if (active) setImageUrl(null)
      } finally {
        if (active) {
          setLoadingImage(false)
          setRefreshing(false)
        }
      }
    }

    void doRefresh()
    return () => { active = false }
  }

  return (
    <div className="relative mt-6 h-[240px] w-full overflow-hidden rounded border border-theme bg-mise-900">
      {loadingImage ? (
        <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-mise-800 via-mise-700/70 to-mise-800" />
      ) : imageUrl ? (
        <img
          src={imageUrl}
          alt={`Recipe image for ${title}`}
          className="h-full w-full object-cover"
          loading="lazy"
          onError={() => setImageUrl(null)}
        />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center bg-mise-900 text-5xl text-mise-500">
          <span aria-hidden="true">🍽️</span>
        </div>
      )}

      <button
        type="button"
        onClick={handleRefresh}
        disabled={loadingImage || refreshing}
        className="absolute right-2 top-2 rounded-full border border-mise-800/70 bg-mise-950/50 p-2 text-mise-400 shadow-sm backdrop-blur transition hover:border-mise-700 hover:bg-mise-950/70 hover:text-mise-200 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
        aria-label="Refresh recipe image"
      >
        <span aria-hidden="true">🔄</span>
      </button>
    </div>
  )
}

function formatServingMacroLabel(result) {
  const servingCandidate =
    result.serving_grams ??
    result.serving_size_g ??
    result.serving_size ??
    result.amount_grams ??
    100
  const numericServing = Number(servingCandidate)
  const servingG = Number.isFinite(numericServing) && numericServing > 0 ? numericServing : 100

  // When the backend already returns macros scaled to a specific serving size (unit = "per Ng"),
  // don't scale again — values are pre-scaled. Only scale when macros are per-100g baseline.
  const isPreScaled = result.unit && result.unit !== 'per 100g'
  const scale = isPreScaled ? 1 : servingG / 100

  return `Per ${servingG}g: ${Math.round((Number(result.calories) || 0) * scale)} cal · ${Math.round((Number(result.protein) || 0) * scale)}g protein · ${Math.round((Number(result.carbs) || 0) * scale)}g carbs · ${Math.round((Number(result.fat) || 0) * scale)}g fat`
}

function toTitleCase(str) {
  return String(str ?? '').replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
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

function IngredientSearchPanel({ ingredientName, onSelect, onClose }) {
  const [query, setQuery] = useState(ingredientName)
  const [barcodeMode, setBarcodeMode] = useState(false)
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchedExternal, setSearchedExternal] = useState(false)
  const [savingIndex, setSavingIndex] = useState(null)
  const [error, setError] = useState('')
  const timerRef = useRef(null)
  const [customMode, setCustomMode] = useState(false)
  const [customForm, setCustomForm] = useState({ name: '', calories: '', protein: '', carbs: '', fat: '' })
  const [savingCustom, setSavingCustom] = useState(false)

  const handleBlock = async (result, i) => {
    if (!result.source_id) return
    setResults((prev) => prev.filter((_, idx) => idx !== i))
    try {
      await blockIngredient({ name: result.name, source: result.source, source_id: result.source_id })
    } catch {
      // optimistic removal stands
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
        .then((d) => setResults(d?.results ?? []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }
    if (immediate) {
      execute()
      return
    }
    timerRef.current = setTimeout(execute, 400)
  }

  useEffect(() => {
    runSearch(ingredientName, { immediate: true })
    return () => clearTimeout(timerRef.current)
  }, [])

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
    searchIngredients(trimmed, { includeExternal: true, externalSource: 'usda' })
      .then((d) => setResults(d?.results ?? []))
      .catch(() => setResults([]))
      .finally(() => setSearching(false))
  }

  const handleSearchOpenFoodFacts = () => {
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      return
    }
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
    if (!next) {
      setResults([])
      return
    }
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
      const saved = await createIngredient({
        name: result.name,
        calories: Number(result.calories) || 0,
        protein: Number(result.protein) || 0,
        carbs: Number(result.carbs) || 0,
        fat: Number(result.fat) || 0,
        unit: result.serving_grams ? `per ${result.serving_grams}g` : (result.unit || 'per 100g'),
        source: result.source === 'usda' ? 'usda' : (result.source === 'openfoodfacts' ? 'off' : 'local'),
      })
      onSelect(saved)
      onClose()
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : 'Failed to use ingredient.')
    } finally {
      setSavingIndex(null)
    }
  }

  const openCustomForm = () => {
    setCustomForm({ name: query.trim(), calories: '', protein: '', carbs: '', fat: '' })
    setCustomMode(true)
  }

  const handleSaveCustom = async (e) => {
    e.preventDefault()
    const name = customForm.name.trim()
    if (!name) return
    setSavingCustom(true)
    setError('')
    try {
      const saved = await createIngredient({
        name,
        calories: Number(customForm.calories) || 0,
        protein: Number(customForm.protein) || 0,
        carbs: Number(customForm.carbs) || 0,
        fat: Number(customForm.fat) || 0,
        unit: 'per 100g',
        source: 'local',
      })
      onSelect(saved)
      onClose()
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
            onChange={barcodeMode ? handleBarcodeChange : (e) => {
              const q = e.target.value
              setQuery(q)
              runSearch(q)
            }}
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
            placeholder={barcodeMode ? 'Enter barcode number...' : 'Search ingredient'}
            autoFocus
            className={inputCls}
          />
          {searching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-mise-500">Searching...</span>
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
          <p className="text-xs font-medium text-mise-500">Custom ingredient <span className="font-normal">(macros per 100g)</span></p>
          <input
            type="text"
            value={customForm.name}
            onChange={(e) => setCustomForm((f) => ({ ...f, name: e.target.value }))}
            placeholder="Name"
            required
            className={inputCls}
          />
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
            <li
              key={i}
              className="flex items-center gap-3 rounded border border-mise-800 bg-mise-900/60 px-3 py-2"
            >
              <div className="min-w-0 flex-1 cursor-pointer" onClick={() => handleUse(r, i)}>
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
                  {savingIndex === i && (
                    <span className="text-[10px] text-mise-400">Selecting...</span>
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
                  onClick={(e) => { e.stopPropagation(); handleBlock(r, i) }}
                  className="shrink-0 rounded border border-mise-800 px-2 py-1.5 text-[10px] text-mise-500 transition hover:border-rose-500/40 hover:text-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
                  title="Block this result"
                >
                  Block
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function stepsToInstructions(steps) {
  if (!steps || steps.length === 0) return ''
  return steps.map((step, i) => {
    const title = step.title?.trim()
    const content = step.content?.trim()
    if (title && content) return `${i + 1}. ${title}\n${content}`
    return `${i + 1}. ${title || content || ''}`
  }).join('\n\n').trim()
}

function makeDraftIngredient(values = {}) {
  return {
    id: values.id ?? `ing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: values.name ?? '',
    amount: values.amount ?? '',
    unit: values.unit ?? '',
    ingredient_id: values.ingredient_id ?? null,
  }
}

function recipeToDraft(recipe) {
  return {
    title: recipe.title ?? '',
    servings: recipe.servings ?? 1,
    tags: Array.isArray(recipe.tags) ? [...recipe.tags] : [],
    notes: recipe.notes ?? '',
    instructions: recipe.instructions ?? stepsToInstructions(recipe.steps ?? []),
    source_url: recipe.source_url ?? '',
    ingredients: (recipe.ingredients ?? []).map(makeDraftIngredient),
  }
}

function buildRecipeJsonLd(recipe) {
  const ingredients = (recipe.ingredients ?? []).map((ingredient) => {
    const amount = ingredient.amount !== undefined && ingredient.amount !== null ? `${ingredient.amount} ` : ''
    const unit = ingredient.unit ? `${ingredient.unit} ` : ''
    return `${amount}${unit}${ingredient.name ?? ''}`.trim()
  })

  const instructions = (recipe.steps ?? []).map((step, index) => ({
    '@type': 'HowToStep',
    name: step.title?.trim() || `Step ${index + 1}`,
    text: step.content?.trim() || step.title?.trim() || '',
  }))

  const macros = recipe.macros ?? recipe.nutrition
  const nutrition = macros
    ? {
        '@type': 'NutritionInformation',
        calories: `${macros.calories} calories`,
        proteinContent: `${macros.protein}g`,
        carbohydrateContent: `${macros.carbs}g`,
        fatContent: `${macros.fat}g`,
      }
    : undefined

  return {
    '@context': 'https://schema.org',
    '@type': 'Recipe',
    name: recipe.title ?? '',
    recipeYield: recipe.servings === 1 ? '1 serving' : `${recipe.servings ?? 1} servings`,
    recipeIngredient: ingredients,
    recipeInstructions: instructions,
    ...(nutrition ? { nutrition } : {}),
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

  const [ingredientMap, setIngredientMap] = useState({})
  const [macros, setMacros] = useState(null)
  const [macroView, setMacroView] = useState('total')

  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(null)
  const [openIngredientSearchId, setOpenIngredientSearchId] = useState(null)
  const [tagInput, setTagInput] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')
  const [copyConfirmationVisible, setCopyConfirmationVisible] = useState(false)
  const copyConfirmationTimerRef = useRef(null)

  useEffect(() => {
    let active = true

    async function loadRecipe() {
      try {
        setLoading(true)
        setError('')
        const [data, ingredientList, macroData] = await Promise.all([
          getRecipe(id),
          getIngredients(),
          getRecipeMacros(id).catch(() => null),
        ])

        if (!active) {
          return
        }

        const map = {}
        for (const ing of (Array.isArray(ingredientList) ? ingredientList : [])) {
          map[ing.id] = ing.name
        }
        setIngredientMap(map)
        setMacros(macroData)
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

  useEffect(() => {
    if (!recipe) {
      return undefined
    }

    const scriptId = `recipe-json-ld-${recipe.id}`
    document.getElementById(scriptId)?.remove()

    const script = document.createElement('script')
    script.id = scriptId
    script.type = 'application/ld+json'
    script.textContent = JSON.stringify(buildRecipeJsonLd(recipe))
    document.head.appendChild(script)

    return () => {
      script.remove()
    }
  }, [recipe])

  useEffect(() => {
    return () => {
      if (copyConfirmationTimerRef.current) {
        window.clearTimeout(copyConfirmationTimerRef.current)
      }
    }
  }, [])

  const handleModeChange = (nextMode) => {
    setMode(nextMode)
    setServings(recipe?.servings ?? 1)
  }

  const ingredientFactor = useMemo(() => {
    if (!recipe || recipe.servings <= 0) return 1
    if (mode === 'per-serving') return 1
    return servings / recipe.servings
  }, [recipe, mode, servings])

  const displayMacros = useMemo(() => {
    if (!macros || macros.matched_count === 0) return null
    if (macroView === 'total') return macros.total
    const divisor = servings > 0 ? servings : 1
    return {
      calories: macros.total.calories / divisor,
      protein: macros.total.protein / divisor,
      carbs: macros.total.carbs / divisor,
      fat: macros.total.fat / divisor,
    }
  }, [macros, macroView, servings])

  const scaledIngredients = useMemo(() => {
    if (!recipe) return []
    const bdMap = {}
    for (const entry of (macros?.breakdown ?? [])) {
      if (entry.recipe_ingredient_id) bdMap[entry.recipe_ingredient_id] = entry
    }
    return (recipe.ingredients ?? []).map((ingredient) => ({
      ...ingredient,
      scaledAmount: formatScaledAmount(Number(ingredient.amount) * ingredientFactor),
      displayName:
        ingredient.ingredient_id && ingredientMap[ingredient.ingredient_id]
          ? ingredientMap[ingredient.ingredient_id]
          : ingredient.name,
      linkedToDb: Boolean(ingredient.ingredient_id),
      breakdown: bdMap[ingredient.id] ?? null,
    }))
  }, [recipe, ingredientFactor, ingredientMap, macros])

  const handleEnterEdit = () => {
    setDraft(recipeToDraft(recipe))
    setOpenIngredientSearchId(null)
    setTagInput('')
    setSaveError('')
    setEditing(true)
  }

  const handleCancelEdit = () => {
    setEditing(false)
    setDraft(null)
    setOpenIngredientSearchId(null)
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
      instructions: draft.instructions.trim() || null,
      source_url: draft.source_url.trim() || null,
      ingredients: draft.ingredients
        .filter((ing) => ing.name.trim() || ing.amount || ing.unit.trim())
        .map((ing) => ({
          id: ing.id,
          name: ing.name.trim(),
          amount: Number(ing.amount) || 0,
          unit: ing.unit.trim(),
          ingredient_id: ing.ingredient_id ?? null,
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

  const handleShareRecipeLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopyConfirmationVisible(true)

      if (copyConfirmationTimerRef.current) {
        window.clearTimeout(copyConfirmationTimerRef.current)
      }

      copyConfirmationTimerRef.current = window.setTimeout(() => {
        setCopyConfirmationVisible(false)
      }, 2000)
    } catch {
      window.alert('Failed to copy recipe link. Please try again.')
    }
  }

  return (
    <section className="mx-auto w-full max-w-5xl">
      <div className="sticky top-16 md:top-0 z-20 -mx-4 md:-mx-8 px-4 md:px-8 py-3 bg-mise-950/95 backdrop-blur border-b border-mise-800 flex items-center justify-between gap-3">
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
              <a
                href={`${API_BASE_URL}/recipes/${encodeURIComponent(id)}/export`}
                download
                className="inline-flex items-center gap-2 rounded border border-mise-800 px-3 py-2 text-sm font-medium text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
                aria-label="Export recipe as markdown"
              >
                <Download size={14} />
                Export
              </a>
              <button
                type="button"
                onClick={handleShareRecipeLink}
                title="Copy link to import into MacroFactor"
                aria-label="Copy link to import into MacroFactor"
                className="inline-flex items-center gap-2 rounded border border-mise-800 bg-mise-950/80 px-3 py-2 text-sm font-medium text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              >
                <Share2 size={14} />
                Share to MacroFactor
              </button>
              <span
                aria-live="polite"
                className={`text-xs text-mise-500 transition-opacity duration-300 ${copyConfirmationVisible ? 'opacity-100' : 'pointer-events-none opacity-0'}`}
              >
                Link copied!
              </span>
            </>
          )}
        </div>
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
          <>
            <h1 className="font-display text-3xl font-semibold text-mise-300">{recipe.title}</h1>
            <RecipeHeroImage recipeId={recipe.id} title={recipe.title} />
          </>
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

      {!editing && displayMacros && (
        <div className="mt-6 rounded border border-theme bg-mise-900 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-6">
              {[
                { label: 'Calories', value: displayMacros.calories, unit: '' },
                { label: 'Protein', value: displayMacros.protein, unit: 'g' },
                { label: 'Carbs', value: displayMacros.carbs, unit: 'g' },
                { label: 'Fat', value: displayMacros.fat, unit: 'g' },
              ].map(({ label, value, unit }) => (
                <div key={label}>
                  <p className="text-base font-semibold text-mise-300">
                    {Math.round(value)}{unit}
                  </p>
                  <p className="text-xs text-mise-500">{label}</p>
                </div>
              ))}
            </div>
            <div className="flex items-center rounded border border-mise-800 text-xs font-medium">
              {[
                { value: 'per-serving', label: 'Per Serving' },
                { value: 'total', label: 'Total' },
              ].map(({ value, label }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setMacroView(value)}
                  className={[
                    'px-3 py-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember first:rounded-l last:rounded-r',
                    macroView === value ? 'bg-mise-800 text-mise-300' : 'text-mise-500 hover:text-mise-300',
                  ].join(' ')}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {!editing && (
        <div className="mt-6 inline-flex items-center gap-4 rounded border border-theme bg-mise-900 px-4 py-3">
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
                    onFocus={() => setOpenIngredientSearchId(ing.id)}
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
                  {openIngredientSearchId === ing.id && (
                    <div className="col-span-12 mt-2">
                      <IngredientSearchPanel
                        ingredientName={ing.name}
                        onClose={() => setOpenIngredientSearchId(null)}
                        onSelect={(savedIngredient) => {
                          setDraft((current) => ({
                            ...current,
                            ingredients: current.ingredients.map((item) => (
                              item.id === ing.id
                                ? { ...item, name: savedIngredient.name, ingredient_id: savedIngredient.id }
                                : item
                            )),
                          }))
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* Notes editor */}
          <MarkdownField
            id="edit-notes"
            label="Notes"
            labelClassName="text-xs font-medium uppercase tracking-widest text-mise-500"
            value={draft.notes}
            onChange={(e) => setDraftField('notes', e.target.value)}
            rows={4}
            placeholder="Any prep, storage, or serving notes"
            textareaClassName={inputCls}
          />

          {/* Instructions editor */}
          <MarkdownField
            id="edit-instructions"
            label="Instructions"
            labelClassName="text-xs font-medium uppercase tracking-widest text-mise-500"
            value={draft.instructions}
            onChange={(e) => setDraftField('instructions', e.target.value)}
            rows={8}
            placeholder={'1. Step one\n2. Step two'}
            textareaClassName={inputCls}
          />

          {/* Source URL editor */}
          <div>
            <label className="mb-2 block text-xs font-medium uppercase tracking-widest text-mise-500" htmlFor="edit-source-url">
              Source URL
            </label>
            <input
              id="edit-source-url"
              type="url"
              value={draft.source_url}
              onChange={(e) => setDraftField('source_url', e.target.value)}
              placeholder="https://..."
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
                {scaledIngredients.map((ingredient) => {
                  const bd = ingredient.breakdown
                  const macroLine = bd
                    ? bd.matched
                      ? `Cal: ${Math.round(bd.calories)}  P: ${Math.round(bd.protein)}g  F: ${Math.round(bd.fat)}g  C: ${Math.round(bd.carbs)}g`
                      : '—'
                    : null
                  return (
                    <li
                      key={ingredient.id}
                      className="flex items-start justify-between gap-4 rounded border border-theme bg-mise-950/50 px-3 py-2"
                    >
                      <div className="min-w-0">
                        <span className="text-mise-400">
                          {toTitleCase(ingredient.displayName)}
                          {!ingredient.linkedToDb && (
                            <span className="ml-1 text-[10px] opacity-40" title="Not linked to ingredient database">🔴</span>
                          )}
                        </span>
                        {macroLine !== null && (
                          <p className="mt-0.5 text-[11px] text-mise-600">{macroLine}</p>
                        )}
                      </div>
                      <span className="shrink-0 text-sm font-medium text-mise-300">
                        {ingredient.scaledAmount} {ingredient.unit}
                      </span>
                    </li>
                  )
                })}
              </ul>
            </section>

            <section className="rounded border border-theme bg-mise-900 p-4">
              <h2 className="text-xs font-medium uppercase tracking-widest text-mise-500">Recipe Details</h2>
              <div className="mt-4 space-y-3">
                {recipe.notes && (
                  <div className="rounded border border-theme bg-mise-950/50 px-3 py-2">
                    <span className="block text-xs uppercase tracking-widest text-mise-500">Notes</span>
                    <div className="mt-1"><MarkdownText text={recipe.notes} /></div>
                  </div>
                )}
                {recipe.source_url && (
                  <div className="rounded border border-theme bg-mise-950/50 px-3 py-2">
                    <span className="block text-xs uppercase tracking-widest text-mise-500">Source</span>
                    <a
                      href={recipe.source_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-1 block truncate text-sm text-ember hover:underline"
                    >
                      {recipe.source_url}
                    </a>
                  </div>
                )}
                {tags.length > 0 && (
                  <div className="rounded border border-theme bg-mise-950/50 px-3 py-2">
                    <span className="block text-xs uppercase tracking-widest text-mise-500">Tags</span>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {tags.map((tag) => (
                        <span key={tag} className="rounded border border-theme bg-mise-800/40 px-2 py-0.5 text-xs text-mise-400">{tag}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>

          {recipe.instructions ? (
            <section className="mt-6 rounded border border-theme bg-mise-900 p-4">
              <h2 className="text-xs font-medium uppercase tracking-widest text-mise-500">Instructions</h2>
              <div className="mt-4"><MarkdownText text={recipe.instructions} /></div>
            </section>
          ) : steps.length > 0 ? (
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
          ) : null}
        </>
      )}
    </section>
  )
}

export default RecipeDetail
