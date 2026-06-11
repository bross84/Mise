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

export function saveOpenRouterKey(key) {
  return request('/settings/openrouter-key', {
    method: 'POST',
    body: JSON.stringify({ key }),
  })
}
