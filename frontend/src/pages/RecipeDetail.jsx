import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { Star } from 'lucide-react'
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

function RecipeDetail() {
 const { id } = useParams()
 const recipe = mockRecipes.find((entry) => String(entry.id) === id)

 const [mode, setMode] = useState('per-serving')
 const [servings, setServings] = useState(recipe?.servings ?? 1)
 const headerTheme = getHeaderTheme(recipe?.tags?.[0])

 const handleModeChange = (nextMode) => {
 setMode(nextMode)
 setServings(recipe?.servings ?? 1)
 }

 // Per Serving: ingredients stay at total recipe amounts; macros divide total by serving count
 // Scale Recipe: both ingredients and macros scale proportionally with serving count
 const ingredientFactor = useMemo(() => {
 if (!recipe || recipe.servings <= 0) return 1
 if (mode === 'per-serving') return 1
 return servings / recipe.servings
 }, [recipe, mode, servings])

 const macroFactor = useMemo(() => {
 if (!recipe || recipe.servings <= 0) return 1
 if (mode === 'per-serving') return recipe.servings / servings
 return servings / recipe.servings
 }, [recipe, mode, servings])

 const scaledMacros = useMemo(() => {
 if (!recipe) return null
 return {
 calories: Math.round(recipe.macros.calories * macroFactor),
 protein: Math.round(recipe.macros.protein * macroFactor),
 carbs: Math.round(recipe.macros.carbs * macroFactor),
 fat: Math.round(recipe.macros.fat * macroFactor),
 }
 }, [recipe, macroFactor])

 const scaledIngredients = useMemo(() => {
 if (!recipe) return []
 return recipe.ingredients.map((ingredient) => ({
 ...ingredient,
 scaledAmount: formatScaledAmount(ingredient.amount * ingredientFactor),
 }))
 }, [recipe, ingredientFactor])

 if (!recipe) {
 return (
 <section className="mx-auto w-full max-w-4xl">
 <Link
 to="/"
 className="inline-flex items-center border rounded border-mise-800 px-3 py-2 text-sm text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
 >
 Back to recipes
 </Link>
 <div className="mt-6 rounded border border-white/10 bg-mise-900 p-6">
 <h1 className="text-2xl font-semibold tracking-tight text-mise-300">Recipe not found</h1>
 <p className="mt-2 text-mise-500">The recipe you requested does not exist.</p>
 </div>
 </section>
 )
 }

 return (
 <section className="mx-auto w-full max-w-5xl">
 <Link
 to="/"
 className="inline-flex items-center border rounded border-mise-800 px-3 py-2 text-sm text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
 >
 Back to recipes
 </Link>

 <div className={`relative mt-6 h-56 w-full overflow-hidden rounded border border-white/10 bg-gradient-to-br md:h-72 ${headerTheme}`} aria-hidden="true">
 <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_25%,rgba(255,255,255,0.1),transparent_40%),radial-gradient(circle_at_80%_75%,rgba(255,255,255,0.08),transparent_45%)]" />
 </div>

 <header className="mt-6">
 <h1 className="font-display text-3xl font-semibold text-mise-300">{recipe.title}</h1>
 <div className="mt-3 flex flex-wrap gap-2">
 {recipe.tags.map((tag) => (
 <span
 key={`${recipe.id}-${tag}`}
 className="rounded border border-white/10 bg-white/5 px-2.5 py-1 text-xs font-medium text-white/60"
 >
 {tag}
 </span>
 ))}
 </div>
 <StarRating />
 </header>

 <div className="mt-8 inline-flex items-center gap-4 rounded border border-white/10 bg-mise-900 px-4 py-3">
 <div
 className="flex items-center gap-4"
 role="radiogroup"
 aria-label="Serving mode"
 >
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
 <span className={mode === value ? 'text-mise-300' : 'text-mise-500'}>
 {label}
 </span>
 </button>
 ))}
 </div>

 <div className="flex items-center gap-2 border-l border-white/10 pl-4">
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

 <div className="mt-6 grid gap-6 lg:grid-cols-[1.1fr_1fr]">
 <section className="rounded border border-white/10 bg-mise-900 p-4">
 <h2 className="text-xs font-medium uppercase tracking-widest text-mise-500">Ingredients</h2>
 <ul className="mt-4 space-y-2">
 {scaledIngredients.map((ingredient) => (
 <li
 key={ingredient.id}
 className="flex items-baseline justify-between gap-4 rounded border border-white/10 bg-mise-950/50 px-3 py-2"
 >
 <span className="text-mise-400">{ingredient.name}</span>
 <span className="text-sm font-medium text-mise-300">
 {ingredient.scaledAmount} {ingredient.unit}
 </span>
 </li>
 ))}
 </ul>
 </section>

 <section className="rounded border border-white/10 bg-mise-900 p-4">
 <h2 className="text-xs font-medium uppercase tracking-widest text-mise-500">
 Macros <span className="normal-case tracking-normal">— {mode === 'per-serving' ? 'per serving' : `for ${servings} serving${servings !== 1 ? 's' : ''}`}</span>
 </h2>
 <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
 <div className="rounded border border-white/10 bg-mise-950/50 p-3">
 <p className="text-xs text-mise-500">Calories</p>
 <p className="mt-1 text-lg font-semibold text-mise-300">{scaledMacros.calories}</p>
 </div>
 <div className="rounded border border-white/10 bg-mise-950/50 p-3">
 <p className="text-xs text-mise-500">Protein</p>
 <p className="mt-1 text-lg font-semibold text-mise-300">{scaledMacros.protein}g</p>
 </div>
 <div className="rounded border border-white/10 bg-mise-950/50 p-3">
 <p className="text-xs text-mise-500">Carbs</p>
 <p className="mt-1 text-lg font-semibold text-mise-300">{scaledMacros.carbs}g</p>
 </div>
 <div className="rounded border border-white/10 bg-mise-950/50 p-3">
 <p className="text-xs text-mise-500">Fat</p>
 <p className="mt-1 text-lg font-semibold text-mise-300">{scaledMacros.fat}g</p>
 </div>
 </div>
 </section>
 </div>

 <section className="mt-6 rounded border border-white/10 bg-mise-900 p-4">
 <h2 className="text-xs font-medium uppercase tracking-widest text-mise-500">Steps</h2>
 <ol className="mt-4 space-y-3">
 {recipe.steps.map((step, index) => (
 <li
 key={step.id}
 className="rounded border border-white/10 bg-mise-950/50 px-4 py-3"
 >
 <p className="text-sm font-medium text-mise-500">Step {index + 1}</p>
 <div className="mt-1 flex items-center gap-2">
 <p className="text-base font-semibold text-mise-300">{step.title}</p>
 {step.timer_seconds !== null && (
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
 </section>
 )
}

export default RecipeDetail
