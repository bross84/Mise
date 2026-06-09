import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Shuffle, ThumbsDown, ThumbsUp } from 'lucide-react'
import { mockRecipes } from '../assets/mockRecipes.js'

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

function RecipeBrowser() {
 const navigate = useNavigate()
 const [searchQuery, setSearchQuery] = useState('')
 const [ratingsByRecipeId, setRatingsByRecipeId] = useState({})

 const filteredRecipes = useMemo(() => {
 const query = searchQuery.trim().toLowerCase()

 if (!query) {
 return mockRecipes
 }

 return mockRecipes.filter((recipe) => {
 const titleMatch = recipe.title.toLowerCase().includes(query)
 const tagMatch = recipe.tags.some((tag) => tag.toLowerCase().includes(query))
 return titleMatch || tagMatch
 })
 }, [searchQuery])

 const handleSurpriseMe = () => {
 const random = mockRecipes[Math.floor(Math.random() * mockRecipes.length)]
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
 className="inline-flex shrink-0 items-center gap-2 rounded border border-ember px-3 py-2 text-sm font-medium text-ember transition hover:bg-ember/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
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

 {filteredRecipes.length === 0 ? (
 <div className="mt-8 border border-dashed border-mise-800 bg-mise-900/50 p-8 text-center text-mise-500">
 No recipes matched your search.
 </div>
 ) : (
 <div className="mt-8 grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
 {filteredRecipes.map((recipe) => {
 const rating = ratingsByRecipeId[recipe.id] || null
 const headerTheme = getHeaderTheme(recipe.tags[0])

 return (
 <article
 key={recipe.id}
 onClick={() => navigate(`/recipe/${recipe.id}`)}
 onKeyDown={(event) => {
 if (event.key === 'Enter' || event.key === ' ') {
 event.preventDefault()
 navigate(`/recipe/${recipe.id}`)
 }
 }}
 role="button"
 tabIndex={0}
 aria-label={`Open recipe ${recipe.title}`}
 className="group flex flex-col overflow-hidden rounded border border-mise-800 bg-mise-900 text-left transition hover:border-mise-700 hover:bg-mise-900/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
 >
 <div className={`relative h-28 w-full rounded border-b border-mise-800 bg-gradient-to-br ${headerTheme}`} aria-hidden="true">
 <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.08),transparent_45%),radial-gradient(circle_at_80%_100%,rgba(255,255,255,0.06),transparent_40%)]" />
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

 <div className="mt-4 flex flex-wrap gap-2 pb-4">
 {recipe.tags.map((tag) => (
 <span
 key={`${recipe.id}-${tag}`}
 className="rounded border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/60"
 >
 {tag}
 </span>
 ))}
 </div>

 <div className="mt-auto grid grid-cols-4 gap-2 border-t border-white/10 pt-4 text-xs">
 <div>
 <p className="text-mise-500">Calories</p>
 <p className="mt-1 font-semibold text-mise-300">{recipe.macros.calories}</p>
 </div>
 <div>
 <p className="text-mise-500">Protein</p>
 <p className="mt-1 font-semibold text-mise-300">{recipe.macros.protein}g</p>
 </div>
 <div>
 <p className="text-mise-500">Carbs</p>
 <p className="mt-1 font-semibold text-mise-300">{recipe.macros.carbs}g</p>
 </div>
 <div>
 <p className="text-mise-500">Fat</p>
 <p className="mt-1 font-semibold text-mise-300">{recipe.macros.fat}g</p>
 </div>
 </div>

 <div className="mt-4 flex items-center justify-end gap-2 border-t border-white/10 pt-4">
 <button
 type="button"
 onClick={(event) => {
 event.stopPropagation()
 setRecipeRating(recipe.id, 'up')
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
 setRecipeRating(recipe.id, 'down')
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
 )})}
 </div>
 )}
 </section>
 )
}

export default RecipeBrowser
