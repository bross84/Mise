import { useMemo, useState } from 'react'
import { mockIngredients } from '../assets/mockIngredients.js'

const inputClassName =
 'w-full rounded border border-mise-800 bg-mise-900 px-4 py-2.5 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember'

const primaryButtonClassName =
 'inline-flex w-fit bg-ember px-4 py-2 text-sm font-semibold text-mise-950 transition hover:bg-ember-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember'

const secondaryButtonClassName =
 ' border border-mise-800 px-3 py-1.5 text-xs font-medium text-mise-300 transition hover:border-mise-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember'

const destructiveButtonClassName =
 ' px-3 py-1.5 text-xs font-medium text-rose-400 transition hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember'

function IngredientDatabase() {
 const [searchQuery, setSearchQuery] = useState('')
 const [showAddForm, setShowAddForm] = useState(false)
 const [name, setName] = useState('')
 const [calories, setCalories] = useState('')
 const [protein, setProtein] = useState('')
 const [carbs, setCarbs] = useState('')
 const [fat, setFat] = useState('')

 const filteredIngredients = useMemo(() => {
 const query = searchQuery.trim().toLowerCase()

 if (!query) {
 return mockIngredients
 }

 return mockIngredients.filter((ingredient) => ingredient.name.toLowerCase().includes(query))
 }, [searchQuery])

 const handleAddIngredient = (event) => {
 event.preventDefault()

 const ingredient = {
 id: Date.now(),
 name: name.trim(),
 calories: Number(calories),
 protein: Number(protein),
 carbs: Number(carbs),
 fat: Number(fat),
 unit: 'per 100g',
 }

 console.log(ingredient)

 setName('')
 setCalories('')
 setProtein('')
 setCarbs('')
 setFat('')
 setShowAddForm(false)
 }

 return (
 <section className="mx-auto w-full max-w-7xl">
 <header>
 <h1 className="font-display text-3xl font-semibold text-mise-300">Ingredient Database</h1>
 <p className="mt-2 text-sm text-mise-500">Browse base ingredient macros and add new entries.</p>
 </header>

 <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
 <button
 type="button"
 onClick={() => setShowAddForm((current) => !current)}
 className={showAddForm ? secondaryButtonClassName : primaryButtonClassName}
 >
 {showAddForm ? 'Cancel' : 'Add Ingredient'}
 </button>

 <div className="w-full sm:max-w-md">
 <label htmlFor="ingredient-search" className="sr-only">
 Search ingredients
 </label>
 <input
 id="ingredient-search"
 type="text"
 value={searchQuery}
 onChange={(event) => setSearchQuery(event.target.value)}
 placeholder="Search ingredients by name..."
 className={inputClassName}
 />
 </div>
 </div>

 {showAddForm && (
 <form
 onSubmit={handleAddIngredient}
 className="mt-4 rounded border border-white/10 bg-mise-900 p-4"
 >
 <h2 className="text-lg font-semibold text-mise-300">Add Ingredient</h2>
 <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-5">
 <label htmlFor="new-ingredient-name" className="sr-only">
 Ingredient name
 </label>
 <input
 id="new-ingredient-name"
 type="text"
 value={name}
 onChange={(event) => setName(event.target.value)}
 placeholder="Name"
 className="rounded border border-mise-800 bg-mise-950 px-3 py-2.5 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
 required
 />
 <label htmlFor="new-ingredient-calories" className="sr-only">
 Ingredient calories
 </label>
 <input
 id="new-ingredient-calories"
 type="number"
 step="any"
 value={calories}
 onChange={(event) => setCalories(event.target.value)}
 placeholder="Calories"
 className="rounded border border-mise-800 bg-mise-950 px-3 py-2.5 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
 required
 />
 <label htmlFor="new-ingredient-protein" className="sr-only">
 Ingredient protein
 </label>
 <input
 id="new-ingredient-protein"
 type="number"
 step="any"
 value={protein}
 onChange={(event) => setProtein(event.target.value)}
 placeholder="Protein"
 className="rounded border border-mise-800 bg-mise-950 px-3 py-2.5 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
 required
 />
 <label htmlFor="new-ingredient-carbs" className="sr-only">
 Ingredient carbs
 </label>
 <input
 id="new-ingredient-carbs"
 type="number"
 step="any"
 value={carbs}
 onChange={(event) => setCarbs(event.target.value)}
 placeholder="Carbs"
 className="rounded border border-mise-800 bg-mise-950 px-3 py-2.5 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
 required
 />
 <label htmlFor="new-ingredient-fat" className="sr-only">
 Ingredient fat
 </label>
 <input
 id="new-ingredient-fat"
 type="number"
 step="any"
 value={fat}
 onChange={(event) => setFat(event.target.value)}
 placeholder="Fat"
 className="rounded border border-mise-800 bg-mise-950 px-3 py-2.5 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
 required
 />
 </div>

 <button
 type="submit"
 className="mt-4 bg-ember px-4 py-2 text-sm font-semibold text-mise-950 transition hover:bg-ember-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
 >
 Save Ingredient (Log to Console)
 </button>
 </form>
 )}

 <div className="mt-6 overflow-x-auto rounded border border-white/10 bg-mise-900">
 <table className="min-w-full divide-y divide-mise-800 text-left text-sm">
 <thead className="bg-mise-950/60 text-xs uppercase tracking-wide text-mise-500">
 <tr>
 <th scope="col" className="px-4 py-3 font-medium">Name</th>
 <th scope="col" className="px-4 py-3 font-medium">Calories</th>
 <th scope="col" className="px-4 py-3 font-medium">Protein</th>
 <th scope="col" className="px-4 py-3 font-medium">Carbs</th>
 <th scope="col" className="px-4 py-3 font-medium">Fat</th>
 <th scope="col" className="px-4 py-3 font-medium">Unit</th>
 <th scope="col" className="px-4 py-3 font-medium">Actions</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-mise-800 text-mise-300">
 {filteredIngredients.length === 0 ? (
 <tr>
 <td colSpan={7} className="px-4 py-8 text-center text-mise-500">
 No ingredients found yet. Try a different name in search.
 </td>
 </tr>
 ) : (
 filteredIngredients.map((ingredient) => (
 <tr key={ingredient.id} className="hover:bg-mise-950/40">
 <td className="whitespace-nowrap px-4 py-3 font-medium text-mise-300">{ingredient.name}</td>
 <td className="whitespace-nowrap px-4 py-3">{ingredient.calories}</td>
 <td className="whitespace-nowrap px-4 py-3">{ingredient.protein}</td>
 <td className="whitespace-nowrap px-4 py-3">{ingredient.carbs}</td>
 <td className="whitespace-nowrap px-4 py-3">{ingredient.fat}</td>
 <td className="whitespace-nowrap px-4 py-3 text-mise-400">{ingredient.unit}</td>
 <td className="whitespace-nowrap px-4 py-3">
 <div className="flex items-center gap-2">
 <button
 type="button"
 className={secondaryButtonClassName}
 >
 Edit
 </button>
 <button
 type="button"
 className={destructiveButtonClassName}
 >
 Delete
 </button>
 </div>
 </td>
 </tr>
 ))
 )}
 </tbody>
 </table>
 </div>
 </section>
 )
}

export default IngredientDatabase
