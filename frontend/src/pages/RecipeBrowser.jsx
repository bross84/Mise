import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shuffle, ThumbsDown, ThumbsUp } from 'lucide-react'
import { getRecipes } from '../api/client.js'

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

const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api'

function RecipeCard({ recipe, rating, onOpen, onRate }) {
  const [imageUrl, setImageUrl] = useState(null)
  const [loadingImage, setLoadingImage] = useState(true)

  useEffect(() => {
    let active = true

    async function loadImage() {
      try {
        setLoadingImage(true)
        const response = await fetch(`${API_BASE_URL}/recipes/${encodeURIComponent(recipe.id)}/image`)
        if (!response.ok) {
          throw new Error(`Image request failed with status ${response.status}`)
        }
        const data = await response.json()
        if (active) {
          setImageUrl(data?.image_url ?? null)
        }
      } catch {
        if (active) {
          setImageUrl(null)
        }
      } finally {
        if (active) {
          setLoadingImage(false)
        }
      }
    }

    void loadImage()

    return () => {
      active = false
    }
  }, [recipe.id])

  const tags = Array.isArray(recipe.tags) ? recipe.tags : []
  const ingredientCount = Array.isArray(recipe.ingredients) ? recipe.ingredients.length : 0
  const stepCount = Array.isArray(recipe.steps) ? recipe.steps.length : 0
  const headerTheme = getHeaderTheme(recipe.tags?.[0])

  return (
    <article
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      role="button"
      tabIndex={0}
      aria-label={`Open recipe ${recipe.title}`}
      className="group flex flex-col overflow-hidden rounded border border-mise-800 bg-mise-900 text-left transition hover:border-mise-700 hover:bg-mise-900/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
    >
      <div className="relative h-40 w-full border-b border-mise-800 bg-mise-900" aria-hidden="true">
        {loadingImage ? (
          <div className="absolute inset-0 animate-pulse bg-gradient-to-br from-mise-800 via-mise-700/70 to-mise-800" />
        ) : imageUrl ? (
          <img
            src={imageUrl}
            alt=""
            className="h-full w-full object-cover"
            loading="lazy"
            onError={() => setImageUrl(null)}
          />
        ) : (
          <div className={`absolute inset-0 flex items-center justify-center bg-gradient-to-br ${headerTheme} text-4xl text-mise-500`}>
            <span aria-hidden="true">🍽️</span>
          </div>
        )}
      </div>

      <div className="flex flex-1 flex-col p-5">
        <div className="flex items-start justify-between gap-3">
          <h2 className="font-display text-lg font-semibold text-mise-300 transition group-hover:text-mise-200">
            {recipe.title}
          </h2>
          <span className="rounded border border-mise-800 px-2 py-1 text-xs text-mise-500">
            {recipe.servings} servings
          </span>
        </div>

        <p className="mt-3 line-clamp-3 text-sm text-mise-500">
          {recipe.notes || 'No notes available for this recipe.'}
        </p>

        <div className="mt-4 flex flex-wrap gap-2 pb-4">
          {tags.map((tag) => (
            <span
              key={`${recipe.id}-${tag}`}
              className="rounded border border-theme bg-mise-800/40 px-2.5 py-1 text-xs font-medium text-mise-500"
            >
              {tag}
            </span>
          ))}
        </div>

        <div className="mt-auto grid grid-cols-3 gap-2 border-t border-theme pt-4 text-xs">
          <div>
            <p className="text-mise-500">Ingredients</p>
            <p className="mt-1 font-semibold text-mise-300">{ingredientCount}</p>
          </div>
          <div>
            <p className="text-mise-500">Steps</p>
            <p className="mt-1 font-semibold text-mise-300">{stepCount}</p>
          </div>
          <div>
            <p className="text-mise-500">Updated</p>
            <p className="mt-1 font-semibold text-mise-300">
              {recipe.updated_at ? new Date(recipe.updated_at).toLocaleDateString() : 'New'}
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-end gap-2 border-t border-theme pt-4">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onRate(recipe.id, 'up')
            }}
            onKeyDown={(event) => event.stopPropagation()}
            className="inline-flex items-center gap-1.5 border border-mise-800 px-2.5 py-1.5 text-xs font-medium text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            aria-label="Thumbs up"
            aria-pressed={rating === 'up'}
          >
            <ThumbsUp
              size={14}
              className={rating === 'up' ? 'fill-current text-ember' : 'text-mise-500'}
            />
          </button>
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              onRate(recipe.id, 'down')
            }}
            onKeyDown={(event) => event.stopPropagation()}
            className="inline-flex items-center gap-1.5 border border-mise-800 px-2.5 py-1.5 text-xs font-medium text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            aria-label="Thumbs down"
            aria-pressed={rating === 'down'}
          >
            <ThumbsDown
              size={14}
              className={rating === 'down' ? 'fill-current text-rose-300' : 'text-mise-500'}
            />
          </button>
        </div>
      </div>
    </article>
  )
}

function RecipeBrowser() {
  const navigate = useNavigate()
  const [recipes, setRecipes] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [ratingsByRecipeId, setRatingsByRecipeId] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let active = true

    async function loadRecipes() {
      try {
        setLoading(true)
        setError('')
        const data = await getRecipes()

        if (!active) {
          return
        }

        setRecipes(Array.isArray(data) ? data : [])
      } catch (requestError) {
        if (!active) {
          return
        }

        setError(requestError instanceof Error ? requestError.message : 'Failed to load recipes.')
        setRecipes([])
      } finally {
        if (active) {
          setLoading(false)
        }
      }
    }

    void loadRecipes()

    return () => {
      active = false
    }
  }, [])

  const filteredRecipes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()

    if (!query) {
      return recipes
    }

    return recipes.filter((recipe) => {
      const titleMatch = recipe.title.toLowerCase().includes(query)
      const tagMatch = (recipe.tags ?? []).some((tag) => tag.toLowerCase().includes(query))
      return titleMatch || tagMatch
    })
  }, [recipes, searchQuery])

  const handleSurpriseMe = () => {
    if (recipes.length === 0) {
      return
    }

    const random = recipes[Math.floor(Math.random() * recipes.length)]
    navigate(`/recipe/${random.id}`)
  }

  const setRecipeRating = (recipeId, nextRating) => {
    setRatingsByRecipeId((currentRatings) => {
      const currentRating = currentRatings[recipeId] || null
      const resolvedRating = currentRating === nextRating ? null : nextRating

      return {
        ...currentRatings,
        [recipeId]: resolvedRating,
      }
    })
  }

  return (
    <section className="mx-auto w-full max-w-7xl">
      <header className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-mise-300">Recipe Browser</h1>
          <p className="mt-2 text-sm text-mise-500">Search recipes by title or tags.</p>
        </div>
        <button
          type="button"
          onClick={handleSurpriseMe}
          disabled={loading || recipes.length === 0}
          className="inline-flex shrink-0 items-center gap-2 rounded border border-ember px-3 py-2 text-sm font-medium text-ember transition hover:bg-ember/10 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
        >
          <Shuffle size={15} />
          Surprise Me
        </button>
      </header>

      <div className="mt-6">
        <label htmlFor="recipe-search" className="sr-only">
          Search recipes
        </label>
        <input
          id="recipe-search"
          type="text"
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          placeholder="Search by recipe title or tag..."
          className="w-full rounded border border-mise-800 bg-mise-900 px-4 py-3 text-sm text-mise-300 placeholder:text-mise-500 outline-none ring-0 transition focus:border-mise-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
        />
      </div>

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
      ) : filteredRecipes.length === 0 ? (
        <div className="mt-8 border border-dashed border-mise-800 bg-mise-900/50 p-8 text-center text-mise-500">
          No recipes matched your search.
        </div>
      ) : (
        <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
          {filteredRecipes.map((recipe) => {
            const rating = ratingsByRecipeId[recipe.id] || null

            return (
              <RecipeCard
                key={recipe.id}
                recipe={recipe}
                rating={rating}
                onOpen={() => navigate(`/recipe/${recipe.id}`)}
                onRate={setRecipeRating}
              />
            )
          })}
        </div>
      )}
    </section>
  )
}

export default RecipeBrowser
