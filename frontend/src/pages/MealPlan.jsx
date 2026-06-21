import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, ShoppingCart, Trash2, X } from 'lucide-react'
import { useMealPlan } from '../context/MealPlanContext.jsx'
import { generateShoppingList } from '../api/client.js'
import ShoppingListModal from '../components/ShoppingListModal.jsx'

function resolveImageUrl(imageUrl) {
  if (!imageUrl) return null
  if (!imageUrl.startsWith('/uploads/')) return imageUrl
  return import.meta.env.VITE_API_URL?.startsWith('/') ? imageUrl : `http://localhost:8001${imageUrl}`
}

function RecipeThumbnail({ imageUrl, title }) {
  const resolved = resolveImageUrl(imageUrl)
  if (resolved) {
    return (
      <img
        src={resolved}
        alt=""
        className="h-full w-full object-cover"
        loading="lazy"
        onError={(e) => { e.currentTarget.style.display = 'none' }}
      />
    )
  }
  return (
    <div className="flex h-full w-full items-center justify-center text-xl text-mise-600">
      🍽️
    </div>
  )
}

export default function MealPlan() {
  const { items, remove, clear, loading } = useMealPlan()
  const [removing, setRemoving] = useState(null)
  const [clearing, setClearing] = useState(false)
  const [shoppingListText, setShoppingListText] = useState(null)
  const [generatingList, setGeneratingList] = useState(false)

  const handleRemove = async (itemId) => {
    setRemoving(itemId)
    try {
      await remove(itemId)
    } catch {
      window.alert('Failed to remove from meal plan.')
    } finally {
      setRemoving(null)
    }
  }

  const handleClear = async () => {
    if (!window.confirm('Clear the entire meal plan?')) return
    setClearing(true)
    try {
      await clear()
    } catch {
      window.alert('Failed to clear meal plan.')
    } finally {
      setClearing(false)
    }
  }

  const handleGenerateShoppingList = async () => {
    if (items.length === 0) return
    setGeneratingList(true)
    try {
      const recipeIds = items.map((i) => i.recipe_id)
      const text = await generateShoppingList(recipeIds)
      setShoppingListText(text)
    } catch {
      window.alert('Failed to generate shopping list.')
    } finally {
      setGeneratingList(false)
    }
  }

  return (
    <section className="mx-auto w-full max-w-3xl">
      {shoppingListText !== null && (
        <ShoppingListModal text={shoppingListText} onClose={() => setShoppingListText(null)} />
      )}

      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-mise-300">Meal Plan</h1>
          <p className="mt-2 text-sm text-mise-500">
            Recipes you plan to make this week.
          </p>
        </div>

        {items.length > 0 && (
          <div className="flex shrink-0 items-center gap-2 pt-1">
            <button
              type="button"
              onClick={handleGenerateShoppingList}
              disabled={generatingList}
              className="inline-flex items-center gap-2 rounded border border-mise-700 bg-mise-800/60 px-3 py-2 text-sm font-medium text-mise-300 transition hover:border-mise-600 hover:bg-mise-800 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              <ShoppingCart size={14} />
              {generatingList ? 'Generating…' : 'Shopping List'}
            </button>
            <button
              type="button"
              onClick={handleClear}
              disabled={clearing}
              className="inline-flex items-center gap-2 rounded border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-sm font-medium text-rose-300 transition hover:border-rose-400 hover:bg-rose-500/20 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              <X size={14} />
              {clearing ? 'Clearing…' : 'Clear All'}
            </button>
          </div>
        )}
      </header>

      {loading ? (
        <div className="mt-8 border border-dashed border-mise-800 bg-mise-900/50 p-8 text-center text-mise-500">
          Loading…
        </div>
      ) : items.length === 0 ? (
        <div className="mt-8 flex flex-col items-center gap-3 border border-dashed border-mise-800 bg-mise-900/50 p-10 text-center">
          <ClipboardList size={32} className="text-mise-700" />
          <p className="font-medium text-mise-400">Your meal plan is empty</p>
          <p className="text-sm text-mise-600">
            Add recipes from the{' '}
            <Link to="/" className="text-ember hover:underline">Recipe Browser</Link>
            {' '}or from any recipe page.
          </p>
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="flex items-center gap-3 rounded border border-mise-800 bg-mise-900 px-3 py-2.5 transition hover:border-mise-700"
            >
              <div className="relative h-12 w-12 shrink-0 overflow-hidden rounded border border-mise-800 bg-mise-800">
                <RecipeThumbnail imageUrl={item.image_url} title={item.title} />
              </div>

              <Link
                to={`/recipe/${item.recipe_id}`}
                className="min-w-0 flex-1 truncate font-medium text-mise-300 transition hover:text-mise-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              >
                {item.title}
              </Link>

              <button
                type="button"
                onClick={() => handleRemove(item.id)}
                disabled={removing === item.id}
                aria-label={`Remove ${item.title} from meal plan`}
                className="shrink-0 rounded p-1.5 text-mise-600 transition hover:text-rose-400 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              >
                <Trash2 size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
