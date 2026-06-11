import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { Pencil, Share2, Star, Trash2, X } from 'lucide-react'
import {
  createIngredient,
  deleteRecipe,
  getIngredients,
  getRecipe,
  getRecipeMacros,
  searchIngredients,
  updateRecipe,
} from '../api/client.js'

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

function formatServingMacroLabel(result) {
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

function IngredientSearchPanel({ ingredientName, onSelect, onClose }) {
  const [query, setQuery] = useState(ingredientName)
  const [barcodeMode, setBarcodeMode] = useState(false)
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [searchedExternal, setSearchedExternal] = useState(false)
  const [savingIndex, setSavingIndex] = useState(null)
  const [error, setError] = useState('')
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
          return {
            name,
            calories: Number(nutriments['energy-kcal_100g'] ?? ((nutriments['energy_100g'] ?? 0) / 4.184)) || 0,
            protein: Number(nutriments['proteins_100g'] ?? 0) || 0,
            carbs: Number(nutriments['carbohydrates_100g'] ?? 0) || 0,
            fat: Number(nutriments['fat_100g'] ?? 0) || 0,
            source: 'openfoodfacts',
            serving_grams: Number.isFinite(servingGrams) ? servingGrams : null,
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
      setResults([{
        name,
        calories: Number(nutriments['energy-kcal_100g'] ?? ((nutriments['energy_100g'] ?? 0) / 4.184)) || 0,
        protein: Number(nutriments['proteins_100g'] ?? 0) || 0,
        carbs: Number(nutriments['carbohydrates_100g'] ?? 0) || 0,
        fat: Number(nutriments['fat_100g'] ?? 0) || 0,
        source: 'openfoodfacts',
        serving_grams: Number.isFinite(servingGrams) ? servingGrams : null,
      }])
    } catch {
      setResults([])
    } finally {
      setSearching(false)
    }
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
            <li
              key={i}
              onClick={() => handleUse(r, i)}
              disabled={savingIndex !== null}
              className="flex items-center gap-3 rounded border border-mise-800 bg-mise-900/60 px-3 py-2 cursor-pointer transition hover:bg-mise-900 hover:border-mise-700 disabled:opacity-50"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-mise-300">{r.name}</span>
                  {r.source === 'usda' && (
                    <span className="rounded-full border border-sky-500/30 bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200">USDA</span>
                  )}
                  {r.source === 'openfoodfacts' && (
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">OFF</span>
                  )}
                  {savingIndex === i && (
                    <span className="text-[10px] text-mise-400">Selecting...</span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-mise-500">{formatServingMacroLabel(r)}</p>
              </div>
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
    </div>
  )
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
  const [macroView, setMacroView] = useState('per-serving')

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

    return (recipe.ingredients ?? []).map((ingredient) => ({
      ...ingredient,
      scaledAmount: formatScaledAmount(Number(ingredient.amount) * ingredientFactor),
      displayName:
        ingredient.ingredient_id && ingredientMap[ingredient.ingredient_id]
          ? ingredientMap[ingredient.ingredient_id]
          : ingredient.name,
      linkedToDb: Boolean(ingredient.ingredient_id),
    }))
  }, [recipe, ingredientFactor, ingredientMap])

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
      ingredients: draft.ingredients
        .filter((ing) => ing.name.trim() || ing.amount || ing.unit.trim())
        .map((ing) => ({
          id: ing.id,
          name: ing.name.trim(),
          amount: Number(ing.amount) || 0,
          unit: ing.unit.trim(),
          ingredient_id: ing.ingredient_id ?? null,
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
                    <span className="text-mise-400">
                      {ingredient.displayName}
                      {!ingredient.linkedToDb && (
                        <span className="ml-1 text-[10px] opacity-40" title="Not linked to ingredient database">🔴</span>
                      )}
                    </span>
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
