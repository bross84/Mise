const BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:8001/api'

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {}),
    },
    ...options,
  })

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`

    try {
      const errorBody = await response.json()
      message = errorBody?.detail || errorBody?.message || message
    } catch {
      // Fall back to the generic status message.
    }

    throw new Error(message)
  }

  if (response.status === 204) {
    return null
  }

  const contentType = response.headers.get('content-type') ?? ''
  if (!contentType.includes('application/json')) {
    return null
  }

  return response.json()
}

export function getRecipes() {
  return request('/recipes')
}

export function getRecipe(id) {
  return request(`/recipes/${encodeURIComponent(id)}`)
}

export function getRecipeMacros(id) {
  return request(`/recipes/${encodeURIComponent(id)}/macros`)
}

export function createRecipe(data) {
  return request('/recipes', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function parseRecipe(data) {
  return request('/recipes/parse', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function importMarkdown(markdown) {
  return request('/recipes/import-markdown', {
    method: 'POST',
    body: JSON.stringify({ markdown }),
  })
}

export function parseIngredients(text, recipeName) {
  return request('/recipes/parse-ingredients', {
    method: 'POST',
    body: JSON.stringify({ text, recipe_name: recipeName || undefined }),
  })
}

export function matchIngredients(ingredients) {
  return request('/recipes/match-ingredients', {
    method: 'POST',
    body: JSON.stringify({ ingredients }),
  })
}

export function updateRecipe(id, data) {
  return request(`/recipes/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export function deleteRecipe(id) {
  return request(`/recipes/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export function getIngredients() {
  return request('/ingredients')
}

export function searchIngredients(q, { includeExternal = true, externalSource } = {}) {
  const params = new URLSearchParams({ q: String(q ?? '') })
  if (!includeExternal) {
    params.set('include_external', 'false')
  }
  if (externalSource) {
    params.set('external_source', String(externalSource))
  }
  return request(`/ingredients/search?${params.toString()}`)
}

export function createIngredient(data) {
  return request('/ingredients', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function updateIngredient(id, data) {
  return request(`/ingredients/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  })
}

export function deleteIngredient(id) {
  return request(`/ingredients/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export function blockIngredient(data) {
  return request('/ingredients/block', {
    method: 'POST',
    body: JSON.stringify(data),
  })
}

export function getBlockedIngredients() {
  return request('/ingredients/blocked')
}

export function deleteBlockedIngredient(id) {
  return request(`/ingredients/blocked/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

export async function generateShoppingList(recipeIds) {
  const response = await fetch(`${BASE_URL}/recipes/shopping-list`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipe_ids: recipeIds }),
  })
  if (!response.ok) throw new Error(`Request failed with status ${response.status}`)
  return response.text()
}

export function getCookbooks() {
  return request('/recipes/cookbooks')
}

export function getMealPlan() {
  return request('/meal-plan')
}

export function addToMealPlan(recipeId) {
  return request('/meal-plan', {
    method: 'POST',
    body: JSON.stringify({ recipe_id: recipeId }),
  })
}

export function removeFromMealPlan(itemId) {
  return request(`/meal-plan/${encodeURIComponent(itemId)}`, { method: 'DELETE' })
}

export function clearMealPlan() {
  return request('/meal-plan', { method: 'DELETE' })
}

export function saveOpenRouterKey(key) {
  return request('/settings/openrouter-key', {
    method: 'POST',
    body: JSON.stringify({ key }),
  })
}
