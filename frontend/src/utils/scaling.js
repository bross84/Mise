// Scaling a recipe: every ingredient amount is multiplied by one factor.
//
// Amounts measured by weight or volume keep two decimals. Everything else (eggs, cloves, "large",
// no unit at all) is a count of things, so it rounds to a whole number. Nothing that was in the
// recipe ever drops out: a count never rounds below 1 and a measured amount never below 0.01. An
// amount that was 0 (e.g. "salt, to taste") stays 0.

const MEASURED_UNITS = new Set([
  // weight
  'g', 'gram', 'grams', 'kg', 'kilogram', 'kilograms', 'mg', 'milligram', 'milligrams',
  'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds',
  // volume
  'tsp', 'teaspoon', 'teaspoons', 'tbsp', 'tablespoon', 'tablespoons', 'cup', 'cups',
  'ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres',
  'l', 'liter', 'liters', 'litre', 'litres', 'dl', 'cl',
  'fl oz', 'floz', 'fluid ounce', 'fluid ounces',
  'pt', 'pint', 'pints', 'qt', 'quart', 'quarts', 'gal', 'gallon', 'gallons',
])

const MACRO_KEYS = ['calories', 'protein', 'carbs', 'fat']

const round2 = (n) => Math.round(n * 100) / 100

/** True when the unit is a weight or volume ("g", "cups", "fl. oz"); false for counts and blanks. */
export function isMeasuredUnit(unit) {
  const normalized = String(unit ?? '').trim().toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ')
  return MEASURED_UNITS.has(normalized)
}

/** One ingredient amount multiplied by `factor`, rounded by the rules above. */
export function scaleAmount(amount, unit, factor) {
  const original = Number(amount)
  if (!Number.isFinite(original)) return 0
  if (original <= 0) return original
  const raw = original * factor
  return isMeasuredUnit(unit) ? Math.max(0.01, round2(raw)) : Math.max(1, Math.round(raw))
}

/**
 * The scaled version of every ingredient: { id, amount, newAmount, ratio }. `ratio` is
 * newAmount / amount, which is how much that ingredient's macros change once rounding is applied.
 * A factor of exactly 1 changes nothing (it must not round a stored 1.5 eggs).
 */
export function scaleIngredients(ingredients, factor) {
  return ingredients.map((ingredient) => {
    const amount = Number(ingredient.amount) || 0
    const newAmount = factor === 1 ? amount : scaleAmount(amount, ingredient.unit, factor)
    return { id: ingredient.id, amount, newAmount, ratio: amount > 0 ? newAmount / amount : 1 }
  })
}

/** True when scaling would change at least one amount. */
export function scalingChangesAmounts(scaled) {
  return scaled.some((entry) => entry.newAmount !== entry.amount)
}

/**
 * The recipe's macro totals after scaling, from the API's `macros` (total plus per-ingredient
 * breakdown). Each matched ingredient's macros move by its own ratio, so the result matches what the
 * server calculates once the rounded amounts are saved. Returns null without macros.
 */
export function scaleMacroTotals(macros, scaled) {
  if (!macros?.total) return null
  const ratios = new Map(scaled.map((entry) => [entry.id, entry.ratio]))
  const totals = { ...macros.total }
  for (const item of macros.breakdown ?? []) {
    if (!item.matched) continue
    const ratio = ratios.get(item.recipe_ingredient_id)
    if (ratio === undefined || ratio === 1) continue
    for (const key of MACRO_KEYS) totals[key] += (item[key] ?? 0) * (ratio - 1)
  }
  return totals
}
