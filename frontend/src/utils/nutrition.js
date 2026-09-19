// Pure helpers for the nutrition form (see components/NutritionFields.jsx).
//
// Foods are stored per 100 g on the server. Labels usually print a per-serving column, so the
// form asks which one the numbers came from, plus the serving weight, and the server converts.

export const MACRO_FIELDS = [
  ['calories', 'Calories'],
  ['protein', 'Protein (g)'],
  ['carbs', 'Carbs (g)'],
  ['fat', 'Fat (g)'],
]

export const emptyNutritionForm = {
  basis: 'per_100g',
  calories: '',
  protein: '',
  carbs: '',
  fat: '',
  serving_grams: '',
  serving_quantity: '',
}

const LEGACY_GRAMS_RE = /^per\s+([\d.]+)\s*g/i
const STANDARD_UNIT_RE = /^\s*(per\s*100\s*g(rams?)?)?\s*$/i

export function isStandardUnit(unit) {
  return STANDARD_UNIT_RE.test(unit ?? '')
}

/** Form state for editing a saved food. Rows saved under an older "per 45g" style unit open as
 *  per-serving values, so saving converts them to per 100 g with the weight made explicit. */
export function nutritionFormFromIngredient(ingredient) {
  const values = {
    calories: String(ingredient.calories),
    protein: String(ingredient.protein),
    carbs: String(ingredient.carbs),
    fat: String(ingredient.fat),
    serving_quantity: ingredient.serving_quantity > 1 ? String(ingredient.serving_quantity) : '',
  }
  if (isStandardUnit(ingredient.unit)) {
    return {
      ...values,
      basis: 'per_100g',
      serving_grams: ingredient.serving_grams ? String(ingredient.serving_grams) : '',
    }
  }
  const legacy = LEGACY_GRAMS_RE.exec(String(ingredient.unit).trim())
  return { ...values, basis: 'per_serving', serving_grams: legacy ? String(Number(legacy[1])) : '' }
}

export function isNutritionFormComplete(form) {
  const macrosFilled = MACRO_FIELDS.every(([key]) => form[key] !== '' && Number(form[key]) >= 0)
  return macrosFilled && (form.basis !== 'per_serving' || Number(form.serving_grams) > 0)
}

/** API fields for a create/update request. The caller adds name, source, barcode, etc. */
export function nutritionFormToPayload(form) {
  const servingGrams = Number(form.serving_grams)
  const servingQuantity = parseInt(form.serving_quantity, 10)
  return {
    calories: Number(form.calories),
    protein: Number(form.protein),
    carbs: Number(form.carbs),
    fat: Number(form.fat),
    nutrition_basis: form.basis,
    serving_grams: servingGrams > 0 ? servingGrams : null,
    serving_quantity: servingQuantity >= 1 ? servingQuantity : 1,
  }
}

/** True for the server's 409 "calories don't match the macros" rejection. */
export function isCalorieMismatch(error) {
  return error?.status === 409 && error?.detail?.code === 'calorie_mismatch'
}

const round1 = (n) => Math.round(n * 10) / 10

/** Live "what will be saved" lines. Display only; the server does the real conversion. */
export function nutritionPreviewLines(form) {
  const [calories, protein, carbs, fat] = MACRO_FIELDS.map(([key]) => Number(form[key]))
  const filled = MACRO_FIELDS.every(([key]) => form[key] !== '')
  const servingGrams = Number(form.serving_grams)
  const pieces = Math.max(parseInt(form.serving_quantity, 10) || 1, 1)
  if (!filled || ![calories, protein, carbs, fat].every(Number.isFinite)) return []

  const lines = []
  if (form.basis === 'per_serving') {
    if (!(servingGrams > 0)) return []
    const f = 100 / servingGrams
    lines.push(
      `Saved per 100 g: ${Math.round(calories * f)} cal, ${round1(protein * f)} g protein, ${round1(carbs * f)} g carbs, ${round1(fat * f)} g fat.`,
    )
    if (pieces > 1) lines.push(`One piece (${round1(servingGrams / pieces)} g): ${Math.round(calories / pieces)} cal.`)
    return lines
  }
  if (servingGrams > 0) {
    const perServing = (calories * servingGrams) / 100
    lines.push(`One serving (${servingGrams} g): ${Math.round(perServing)} cal.`)
    if (pieces > 1) lines.push(`One piece (${round1(servingGrams / pieces)} g): ${Math.round(perServing / pieces)} cal.`)
  }
  return lines
}
