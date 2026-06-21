import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarCheck, CalendarPlus, Download, Grid2X2, LayoutGrid, LayoutList, Plus, ShoppingCart, Shuffle, ThumbsDown, ThumbsUp, Trash2, Upload, X } from 'lucide-react'
import { deleteRecipe, generateShoppingList, getRecipes, importMarkdown } from '../api/client.js'
import { useMealPlan } from '../context/MealPlanContext.jsx'
import ShoppingListModal from '../components/ShoppingListModal.jsx'

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
  if (!firstTag) return 'from-slate-800 via-slate-900 to-slate-950 bg-mise-800/40'
  return tagHeaderTheme[firstTag.toLowerCase()] || 'from-slate-800 via-slate-900 to-slate-950 bg-mise-800/40'
}

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api'

const SORT_OPTIONS = [
  { value: 'name-asc', label: 'Name (A–Z)' },
  { value: 'name-desc', label: 'Name (Z–A)' },
  { value: 'created', label: 'Recently Added' },
  { value: 'updated', label: 'Recently Updated' },
]

const VIEW_KEY = 'mise-recipe-view'

const IMAGE_HOST = import.meta.env.VITE_API_URL
  ? import.meta.env.VITE_API_URL.replace('/api', '')
  : 'http://localhost:8001'

function resolveImageUrl(imageUrl) {
  if (!imageUrl) return null
  return imageUrl.startsWith('/uploads/') ? `${IMAGE_HOST}${imageUrl}` : imageUrl
}

// ── Large card (existing style) ────────────────────────────────────────────────

function MealPlanButton({ recipeId, size = 14, className = '' }) {
  const { recipeIds, add } = useMealPlan()
  const isOnPlan = recipeIds.has(recipeId)
  const [adding, setAdding] = useState(false)

  const handleClick = async (e) => {
    e.stopPropagation()
    if (isOnPlan || adding) return
    setAdding(true)
    try { await add(recipeId) } catch { /* ignore */ } finally { setAdding(false) }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={isOnPlan ? 'On meal plan' : 'Add to meal plan'}
      title={isOnPlan ? 'On meal plan' : 'Add to meal plan'}
      disabled={adding}
      className={`rounded p-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember disabled:opacity-40 ${isOnPlan ? 'text-ember' : 'text-mise-600 hover:text-mise-300'} ${className}`}
    >
      {isOnPlan ? <CalendarCheck size={size} /> : <CalendarPlus size={size} />}
    </button>
  )
}

function LargeCard({ recipe, rating, onOpen, onRate, onDelete, selectMode, selected, onToggleSelect }) {
  const imageUrl = resolveImageUrl(recipe.image_url)
  const tags = Array.isArray(recipe.tags) ? recipe.tags : []
  const ingredientCount = Array.isArray(recipe.ingredients) ? recipe.ingredients.length : 0
  const stepCount = Array.isArray(recipe.steps) ? recipe.steps.length : 0
  const headerTheme = getHeaderTheme(recipe.tags?.[0])

  const handleCardClick = () => {
    if (selectMode) { onToggleSelect(recipe.id); return }
    onOpen()
  }

  return (
    <article
      onClick={handleCardClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCardClick() } }}
      role="button"
      tabIndex={0}
      aria-label={`Open recipe ${recipe.title}`}
      className={[
        'group flex flex-col overflow-hidden rounded border bg-mise-900 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember',
        selected ? 'border-ember bg-ember/5' : 'border-mise-800 hover:border-mise-700 hover:bg-mise-900/80',
      ].join(' ')}
    >
      <div className="relative h-40 w-full border-b border-mise-800 bg-mise-900" aria-hidden="true">
        {imageUrl ? (
          <img src={imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" onError={() => {}} />
        ) : (
          <div className={`absolute inset-0 flex items-center justify-center bg-gradient-to-br ${headerTheme} text-4xl text-mise-500`}>
            <span aria-hidden="true">🍽️</span>
          </div>
        )}

        {selectMode && (
          <div className="absolute left-2 top-2">
            <span className={[
              'flex h-5 w-5 items-center justify-center rounded border text-[10px] font-bold',
              selected ? 'border-ember bg-ember text-white' : 'border-mise-500 bg-mise-900/70 text-transparent',
            ].join(' ')}>✓</span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-mise-300 transition group-hover:text-mise-200">
            {recipe.title}
          </h2>
          <span className="shrink-0 rounded border border-mise-800 px-2 py-1 text-xs text-mise-500">
            {recipe.servings} servings
          </span>
        </div>

        <p className="mt-3 line-clamp-3 text-sm text-mise-500">
          {recipe.notes || 'No notes available for this recipe.'}
        </p>

        <div className="mt-4 flex flex-wrap gap-2 pb-4">
          {tags.map((tag) => (
            <span key={`${recipe.id}-${tag}`} className="rounded border border-theme bg-mise-800/40 px-2.5 py-1 text-xs font-medium text-mise-500">
              {tag}
            </span>
          ))}
        </div>

        <div className="mt-auto grid grid-cols-3 gap-2 border-t border-theme pt-4 text-xs">
          <div><p className="text-mise-500">Ingredients</p><p className="mt-1 font-semibold text-mise-300">{ingredientCount}</p></div>
          <div><p className="text-mise-500">Steps</p><p className="mt-1 font-semibold text-mise-300">{stepCount}</p></div>
          <div>
            <p className="text-mise-500">Updated</p>
            <p className="mt-1 font-semibold text-mise-300">
              {recipe.updated_at ? new Date(recipe.updated_at).toLocaleDateString() : 'New'}
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between gap-2 border-t border-theme pt-4">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(recipe) }}
            className="rounded p-1.5 text-mise-600 transition hover:text-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            aria-label={`Delete ${recipe.title}`}
          >
            <Trash2 size={14} />
          </button>
          <div className="flex items-center gap-2">
            <MealPlanButton recipeId={recipe.id} size={14} />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRate(recipe.id, 'up') }}
              onKeyDown={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 border border-mise-800 px-2.5 py-1.5 text-xs font-medium text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              aria-label="Thumbs up"
              aria-pressed={rating === 'up'}
            >
              <ThumbsUp size={14} className={rating === 'up' ? 'fill-current text-ember' : 'text-mise-500'} />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRate(recipe.id, 'down') }}
              onKeyDown={(e) => e.stopPropagation()}
              className="inline-flex items-center gap-1.5 border border-mise-800 px-2.5 py-1.5 text-xs font-medium text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              aria-label="Thumbs down"
              aria-pressed={rating === 'down'}
            >
              <ThumbsDown size={14} className={rating === 'down' ? 'fill-current text-rose-300' : 'text-mise-500'} />
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}

// ── Small card ─────────────────────────────────────────────────────────────────

function SmallCard({ recipe, rating, onOpen, onRate, onDelete, selectMode, selected, onToggleSelect }) {
  const imageUrl = resolveImageUrl(recipe.image_url)
  const headerTheme = getHeaderTheme(recipe.tags?.[0])

  const handleCardClick = () => {
    if (selectMode) { onToggleSelect(recipe.id); return }
    onOpen()
  }

  return (
    <article
      onClick={handleCardClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCardClick() } }}
      role="button"
      tabIndex={0}
      aria-label={`Open recipe ${recipe.title}`}
      className={[
        'group flex flex-col overflow-hidden rounded border bg-mise-900 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember',
        selected ? 'border-ember bg-ember/5' : 'border-mise-800 hover:border-mise-700 hover:bg-mise-900/80',
      ].join(' ')}
    >
      <div className="relative h-24 w-full border-b border-mise-800 bg-mise-900" aria-hidden="true">
        {imageUrl ? (
          <img src={imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" onError={() => {}} />
        ) : (
          <div className={`absolute inset-0 flex items-center justify-center bg-gradient-to-br ${headerTheme} text-2xl text-mise-500`}>
            <span aria-hidden="true">🍽️</span>
          </div>
        )}
        {selectMode && (
          <div className="absolute left-1.5 top-1.5">
            <span className={[
              'flex h-4 w-4 items-center justify-center rounded border text-[9px] font-bold',
              selected ? 'border-ember bg-ember text-white' : 'border-mise-500 bg-mise-900/70 text-transparent',
            ].join(' ')}>✓</span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-3">
        <h2 className="line-clamp-2 text-sm font-semibold text-mise-300 transition group-hover:text-mise-200">
          {recipe.title}
        </h2>
        <div className="mt-auto flex items-center justify-between pt-2">
          <span className="text-[10px] text-mise-600">{recipe.servings} srv</span>
          <div className="flex items-center gap-1">
            <MealPlanButton recipeId={recipe.id} size={12} />
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onDelete(recipe) }}
              className="rounded p-1 text-mise-600 transition hover:text-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              aria-label={`Delete ${recipe.title}`}
            >
              <Trash2 size={12} />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRate(recipe.id, 'up') }}
              onKeyDown={(e) => e.stopPropagation()}
              className="rounded p-1 text-mise-600 transition hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              aria-label="Thumbs up"
            >
              <ThumbsUp size={12} className={rating === 'up' ? 'fill-current text-ember' : ''} />
            </button>
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onRate(recipe.id, 'down') }}
              onKeyDown={(e) => e.stopPropagation()}
              className="rounded p-1 text-mise-600 transition hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              aria-label="Thumbs down"
            >
              <ThumbsDown size={12} className={rating === 'down' ? 'fill-current text-rose-300' : ''} />
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}

// ── List row ───────────────────────────────────────────────────────────────────

function ListRow({ recipe, rating, onOpen, onRate, onDelete, selectMode, selected, onToggleSelect }) {
  const imageUrl = resolveImageUrl(recipe.image_url)
  const headerTheme = getHeaderTheme(recipe.tags?.[0])
  const tags = Array.isArray(recipe.tags) ? recipe.tags : []

  const handleRowClick = () => {
    if (selectMode) { onToggleSelect(recipe.id); return }
    onOpen()
  }

  return (
    <article
      onClick={handleRowClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRowClick() } }}
      role="button"
      tabIndex={0}
      aria-label={`Open recipe ${recipe.title}`}
      className={[
        'group flex items-center gap-3 rounded border bg-mise-900 px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember',
        selected ? 'border-ember bg-ember/5' : 'border-mise-800 hover:border-mise-700 hover:bg-mise-900/80',
      ].join(' ')}
    >
      {selectMode && (
        <span className={[
          'flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[9px] font-bold',
          selected ? 'border-ember bg-ember text-white' : 'border-mise-600 text-transparent',
        ].join(' ')}>✓</span>
      )}

      <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded border border-mise-800" aria-hidden="true">
        {imageUrl ? (
          <img src={imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" onError={() => {}} />
        ) : (
          <div className={`absolute inset-0 flex items-center justify-center bg-gradient-to-br ${headerTheme} text-lg`}>
            <span aria-hidden="true">🍽️</span>
          </div>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold text-mise-300 transition group-hover:text-mise-200">
          {recipe.title}
        </p>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-mise-600">{recipe.servings} servings</span>
          {tags.slice(0, 3).map((tag) => (
            <span key={tag} className="rounded border border-mise-800 bg-mise-800/40 px-1.5 py-0.5 text-[10px] text-mise-500">
              {tag}
            </span>
          ))}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        <span className="hidden text-xs text-mise-600 sm:block">
          {recipe.updated_at ? new Date(recipe.updated_at).toLocaleDateString() : 'New'}
        </span>
        <MealPlanButton recipeId={recipe.id} size={13} />
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRate(recipe.id, 'up') }}
          onKeyDown={(e) => e.stopPropagation()}
          className="rounded p-1.5 text-mise-600 transition hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          aria-label="Thumbs up"
        >
          <ThumbsUp size={13} className={rating === 'up' ? 'fill-current text-ember' : ''} />
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRate(recipe.id, 'down') }}
          onKeyDown={(e) => e.stopPropagation()}
          className="rounded p-1.5 text-mise-600 transition hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          aria-label="Thumbs down"
        >
          <ThumbsDown size={13} className={rating === 'down' ? 'fill-current text-rose-300' : ''} />
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(recipe) }}
          className="rounded p-1.5 text-mise-600 transition hover:text-rose-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          aria-label={`Delete ${recipe.title}`}
        >
          <Trash2 size={13} />
        </button>
      </div>
    </article>
  )
}

// ── Import modal ───────────────────────────────────────────────────────────────

function ImportModal({ onClose, onImported }) {
  const [markdown, setMarkdown] = useState('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef(null)

  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => setMarkdown(evt.target.result ?? '')
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleSubmit = async () => {
    if (!markdown.trim()) { setError('Paste or load a markdown file first.'); return }
    setError('')
    setImporting(true)
    try {
      const data = await importMarkdown(markdown.trim())
      onImported(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.')
    } finally {
      setImporting(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="flex w-full max-w-xl flex-col gap-4 rounded border border-mise-700 bg-mise-950 p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-mise-300">Import from Markdown</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-mise-500 transition hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember">
            <X size={16} />
          </button>
        </div>

        <p className="text-xs text-mise-500">
          Paste a recipe in markdown format, or load a <code className="text-mise-400">.md</code> file.
          All fields will be pre-filled for review before saving.
        </p>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-xs font-medium text-mise-500">Markdown content</label>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="inline-flex items-center gap-1.5 rounded border border-mise-800 px-2.5 py-1 text-xs text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              <Upload size={11} />
              Load file
            </button>
            <input ref={fileRef} type="file" accept=".md,.markdown,text/markdown,text/plain" className="hidden" onChange={handleFile} />
          </div>
          <textarea
            rows={12}
            value={markdown}
            onChange={(e) => setMarkdown(e.target.value)}
            placeholder={'# My Recipe\n\n## Ingredients\n- 2 cups flour\n- 1 egg\n\n## Instructions\n1. Mix everything together.'}
            className="w-full rounded border border-mise-800 bg-mise-900 px-3 py-2.5 font-mono text-xs text-mise-300 placeholder:text-mise-600 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          />
        </div>

        {error && (
          <p className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-mise-800 px-3 py-2 text-sm text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={importing || !markdown.trim()}
            className="rounded bg-ember px-4 py-2 text-sm font-semibold text-mise-950 transition hover:bg-ember-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          >
            {importing ? 'Importing…' : 'Import →'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Browser ────────────────────────────────────────────────────────────────────

function RecipeBrowser() {
  const navigate = useNavigate()
  const [recipes, setRecipes] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [ratingsByRecipeId, setRatingsByRecipeId] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [sortBy, setSortBy] = useState('updated')
  const [view, setView] = useState(() => localStorage.getItem(VIEW_KEY) ?? 'large')
  const [selectMode, setSelectMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState(new Set())
  const [batchDeleting, setBatchDeleting] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [exportingAll, setExportingAll] = useState(false)
  const [shoppingListText, setShoppingListText] = useState(null)
  const [generatingList, setGeneratingList] = useState(false)
  const [activeTag, setActiveTag] = useState(null)

  useEffect(() => {
    let active = true

    async function loadRecipes() {
      try {
        setLoading(true)
        setError('')
        const data = await getRecipes()
        if (!active) return
        setRecipes(Array.isArray(data) ? data : [])
      } catch (err) {
        if (!active) return
        setError(err instanceof Error ? err.message : 'Failed to load recipes.')
        setRecipes([])
      } finally {
        if (active) setLoading(false)
      }
    }

    void loadRecipes()
    return () => { active = false }
  }, [])

  const switchView = (next) => {
    setView(next)
    localStorage.setItem(VIEW_KEY, next)
  }

  const toggleSelectMode = () => {
    setSelectMode((v) => !v)
    setSelectedIds(new Set())
  }

  const toggleSelect = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const handleDelete = async (recipe) => {
    if (!window.confirm(`Delete "${recipe.title}"?`)) return
    try {
      await deleteRecipe(recipe.id)
      setRecipes((prev) => prev.filter((r) => r.id !== recipe.id))
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(recipe.id); return next })
    } catch {
      window.alert('Failed to delete recipe. Please try again.')
    }
  }

  const handleGenerateShoppingList = async () => {
    if (selectedIds.size === 0) return
    setGeneratingList(true)
    try {
      const text = await generateShoppingList([...selectedIds])
      setShoppingListText(text)
    } catch {
      window.alert('Failed to generate shopping list. Please try again.')
    } finally {
      setGeneratingList(false)
    }
  }

  const handleBatchDelete = async () => {
    const count = selectedIds.size
    if (count === 0) return
    if (!window.confirm(`Delete ${count} recipe${count !== 1 ? 's' : ''}?`)) return
    setBatchDeleting(true)
    try {
      await Promise.all([...selectedIds].map((id) => deleteRecipe(id)))
      setRecipes((prev) => prev.filter((r) => !selectedIds.has(r.id)))
      setSelectedIds(new Set())
      setSelectMode(false)
    } catch {
      window.alert('Some recipes could not be deleted. Please try again.')
    } finally {
      setBatchDeleting(false)
    }
  }

  const tagFrequency = useMemo(() => {
    const counts = {}
    for (const r of recipes) {
      for (const t of (r.tags ?? [])) {
        counts[t] = (counts[t] ?? 0) + 1
      }
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
  }, [recipes])

  const sortedFilteredRecipes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    let list = recipes.filter((r) => {
      if (activeTag && !(r.tags ?? []).includes(activeTag)) return false
      if (!query) return true
      const titleMatch = r.title.toLowerCase().includes(query)
      const tagMatch = (r.tags ?? []).some((t) => t.toLowerCase().includes(query))
      return titleMatch || tagMatch
    })

    if (sortBy === 'name-asc') list.sort((a, b) => a.title.localeCompare(b.title))
    else if (sortBy === 'name-desc') list.sort((a, b) => b.title.localeCompare(a.title))
    else if (sortBy === 'created') list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    else if (sortBy === 'updated') list.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at))

    return list
  }, [recipes, searchQuery, sortBy, activeTag])

  const setRecipeRating = (recipeId, nextRating) => {
    setRatingsByRecipeId((current) => {
      const current_ = current[recipeId] || null
      return { ...current, [recipeId]: current_ === nextRating ? null : nextRating }
    })
  }

  const handleSurpriseMe = () => {
    if (recipes.length === 0) return
    const random = recipes[Math.floor(Math.random() * recipes.length)]
    navigate(`/recipe/${random.id}`)
  }

  const handleImported = (data) => {
    setShowImport(false)
    navigate('/add', { state: { prefill: data } })
  }

  const handleExportAll = async () => {
    setExportingAll(true)
    try {
      const a = document.createElement('a')
      a.href = `${API_BASE_URL}/recipes/export-all`
      a.download = ''
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      // Keep loading state visible briefly so the button doesn't flicker
      await new Promise((r) => setTimeout(r, 1500))
    } finally {
      setExportingAll(false)
    }
  }

  const viewBtnCls = (v) => [
    'rounded p-1.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember',
    view === v ? 'text-mise-300 bg-mise-800' : 'text-mise-600 hover:text-mise-400',
  ].join(' ')

  const gridCls = view === 'large'
    ? 'mt-4 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3'
    : view === 'small'
    ? 'mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4'
    : 'mt-4 flex flex-col gap-2'

  const CardComponent = view === 'large' ? LargeCard : view === 'small' ? SmallCard : ListRow

  return (
    <section className="mx-auto w-full max-w-7xl">
      {showImport && <ImportModal onClose={() => setShowImport(false)} onImported={handleImported} />}
      {shoppingListText !== null && <ShoppingListModal text={shoppingListText} onClose={() => setShoppingListText(null)} />}

      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-mise-300">Recipe Browser</h1>
          <p className="mt-2 text-sm text-mise-500">Search recipes by title or tags.</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => navigate('/add')}
            aria-label="New Recipe"
            className="inline-flex items-center gap-2 rounded border border-mise-800 px-3 py-2 text-sm font-medium text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          >
            <Plus size={14} />
            <span className="hidden sm:inline">New Recipe</span>
          </button>
          <button
            type="button"
            onClick={() => setShowImport(true)}
            aria-label="Import recipe"
            className="inline-flex items-center gap-2 rounded border border-mise-800 px-3 py-2 text-sm font-medium text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          >
            <Upload size={14} />
            <span className="hidden sm:inline">Import</span>
          </button>
          <button
            type="button"
            onClick={handleSurpriseMe}
            disabled={loading || recipes.length === 0}
            className="inline-flex items-center gap-2 rounded border border-ember px-3 py-2 text-sm font-medium text-ember transition hover:bg-ember/10 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          >
            <Shuffle size={15} />
            <span className="hidden sm:inline">Surprise Me</span>
          </button>
        </div>
      </header>

      <div className="mt-6">
        <label htmlFor="recipe-search" className="sr-only">Search recipes</label>
        <input
          id="recipe-search"
          type="text"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search by recipe title or tag..."
          className="w-full rounded border border-mise-800 bg-mise-900 px-4 py-3 text-sm text-mise-300 placeholder:text-mise-500 outline-none ring-0 transition focus:border-mise-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
        />
        {tagFrequency.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {tagFrequency.map(([tag, count]) => (
              <button
                key={tag}
                type="button"
                onClick={() => setActiveTag((t) => t === tag ? null : tag)}
                className={[
                  'rounded-full border px-2.5 py-0.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember',
                  activeTag === tag
                    ? 'border-ember bg-ember/10 text-ember'
                    : 'border-mise-800 bg-mise-900 text-mise-500 hover:border-mise-700 hover:text-mise-300',
                ].join(' ')}
              >
                {tag}
                <span className={`ml-1.5 text-[10px] ${activeTag === tag ? 'text-ember/70' : 'text-mise-600'}`}>{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {!loading && !error && recipes.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          {/* Sort */}
          <div className="flex items-center gap-2">
            <label htmlFor="sort-select" className="text-xs text-mise-600">Sort</label>
            <select
              id="sort-select"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
              className="rounded border border-mise-800 bg-mise-900 px-2.5 py-1.5 text-xs text-mise-300 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3">
            {/* Export all */}
            <button
              type="button"
              onClick={handleExportAll}
              disabled={exportingAll}
              className="inline-flex items-center gap-1.5 rounded border border-mise-800 px-3 py-1.5 text-xs font-medium text-mise-500 transition hover:border-mise-700 hover:text-mise-300 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              title="Export all recipes as a zip of markdown files"
            >
              <Download size={12} />
              {exportingAll ? 'Exporting…' : 'Export All'}
            </button>

            {/* Batch actions */}
            {selectMode && selectedIds.size > 0 && (
              <>
                <button
                  type="button"
                  onClick={handleGenerateShoppingList}
                  disabled={generatingList}
                  className="inline-flex items-center gap-1.5 rounded border border-mise-700 bg-mise-800/60 px-3 py-1.5 text-xs font-medium text-mise-300 transition hover:border-mise-600 hover:bg-mise-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
                >
                  <ShoppingCart size={12} />
                  {generatingList ? 'Generating…' : `Shopping List (${selectedIds.size})`}
                </button>
                <button
                  type="button"
                  onClick={handleBatchDelete}
                  disabled={batchDeleting}
                  className="inline-flex items-center gap-1.5 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-1.5 text-xs font-medium text-rose-300 transition hover:border-rose-400 hover:bg-rose-500/20 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
                >
                  <Trash2 size={12} />
                  {batchDeleting ? 'Deleting…' : `Delete Selected (${selectedIds.size})`}
                </button>
              </>
            )}

            {/* Select mode toggle */}
            <button
              type="button"
              onClick={toggleSelectMode}
              className={[
                'rounded border px-3 py-1.5 text-xs font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember',
                selectMode
                  ? 'border-mise-700 bg-mise-800 text-mise-300'
                  : 'border-mise-800 text-mise-500 hover:border-mise-700 hover:text-mise-300',
              ].join(' ')}
            >
              {selectMode ? 'Cancel' : 'Select'}
            </button>

            {/* View toggle */}
            <div className="flex items-center gap-0.5 rounded border border-mise-800 p-0.5">
              <button type="button" onClick={() => switchView('list')} className={viewBtnCls('list')} aria-label="List view">
                <LayoutList size={15} />
              </button>
              <button type="button" onClick={() => switchView('large')} className={viewBtnCls('large')} aria-label="Large card view">
                <LayoutGrid size={15} />
              </button>
              <button type="button" onClick={() => switchView('small')} className={viewBtnCls('small')} aria-label="Small card view">
                <Grid2X2 size={15} />
              </button>
            </div>
          </div>
        </div>
      )}

      {loading ? (
        <div className="mt-8 border border-dashed border-mise-800 bg-mise-900/50 p-8 text-center text-mise-500">
          Loading recipes...
        </div>
      ) : error ? (
        <div className="mt-8 border border-rose-500/30 bg-rose-500/10 p-8 text-center text-rose-200">
          <p className="font-medium">Unable to load recipes.</p>
          <p className="mt-2 text-sm text-rose-200/80">{error}</p>
        </div>
      ) : recipes.length === 0 ? (
        <div className="mt-8 border border-dashed border-mise-800 bg-mise-900/50 p-8 text-center text-mise-500">
          <p className="font-medium text-mise-400">No recipes yet.</p>
          <p className="mt-2 text-sm">Add your first recipe to start building the library.</p>
        </div>
      ) : sortedFilteredRecipes.length === 0 ? (
        <div className="mt-8 border border-dashed border-mise-800 bg-mise-900/50 p-8 text-center text-mise-500">
          No recipes matched your search.
        </div>
      ) : (
        <div className={gridCls}>
          {sortedFilteredRecipes.map((recipe) => (
            <CardComponent
              key={recipe.id}
              recipe={recipe}
              rating={ratingsByRecipeId[recipe.id] || null}
              onOpen={() => navigate(`/recipe/${recipe.id}`)}
              onRate={setRecipeRating}
              onDelete={handleDelete}
              selectMode={selectMode}
              selected={selectedIds.has(recipe.id)}
              onToggleSelect={toggleSelect}
            />
          ))}
        </div>
      )}
    </section>
  )
}

export default RecipeBrowser
