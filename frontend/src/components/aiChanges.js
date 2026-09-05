// Turns an accepted subset of AI-proposed changes into a new recipe object and a
// minimal PATCH payload. This is the reusable core of the recipe edit assistant —
// the review UI renders `changes[]` and this module applies them.

const SCALAR_FIELDS = ['title', 'servings', 'tags', 'notes', 'instructions', 'cookbook']

export function tempIngredientId() {
  return `ing-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

function cloneRecipe(recipe) {
  return typeof structuredClone === 'function'
    ? structuredClone(recipe)
    : JSON.parse(JSON.stringify(recipe))
}

function str(value) {
  return value == null ? '' : String(value).trim()
}

function normalizeIngredient(ing) {
  return {
    id: ing.id || tempIngredientId(),
    name: str(ing.name),
    amount: Number(ing.amount) || 0,
    unit: str(ing.unit),
    ingredient_id: ing.ingredient_id ?? null,
    group_name: ing.group_name ?? null,
  }
}

export function applyChanges(recipe, accepted) {
  const next = cloneRecipe(recipe)
  next.ingredients = Array.isArray(next.ingredients) ? next.ingredients : []

  for (const change of accepted) {
    if (change.field === 'ingredients') {
      if (change.op === 'update' && change.target_id) {
        next.ingredients = next.ingredients.map((ing) =>
          ing.id === change.target_id ? { ...ing, ...(change.after || {}) } : ing,
        )
      } else if (change.op === 'add' && change.after) {
        next.ingredients = [
          ...next.ingredients,
          { ...change.after, id: change.after.id || tempIngredientId() },
        ]
      } else if (change.op === 'remove' && change.target_id) {
        next.ingredients = next.ingredients.filter((ing) => ing.id !== change.target_id)
      }
    } else if (change.op === 'update' && SCALAR_FIELDS.includes(change.field)) {
      next[change.field] = change.after
    }
  }

  return next
}

// Returns { payload, nextRecipe }. `payload` carries only the fields that accepted
// changes touched; if any ingredient changed, the full array is sent.
export function buildUpdatePayload(recipe, accepted) {
  const nextRecipe = applyChanges(recipe, accepted)
  const touched = new Set(accepted.map((c) => c.field))
  const payload = {}

  if (touched.has('ingredients')) {
    payload.ingredients = (nextRecipe.ingredients || []).map(normalizeIngredient)
  }
  for (const field of SCALAR_FIELDS) {
    if (!touched.has(field)) continue
    if (field === 'servings') {
      payload.servings = Number(nextRecipe.servings) || 1
    } else if (field === 'tags') {
      payload.tags = Array.isArray(nextRecipe.tags) ? nextRecipe.tags : []
    } else {
      payload[field] = nextRecipe[field] ?? null
    }
  }

  return { payload, nextRecipe }
}

// Line-level diff (LCS) for text fields like instructions and notes.
export function lineDiff(before, after) {
  const a = String(before ?? '').split('\n')
  const b = String(after ?? '').split('\n')
  const m = a.length
  const n = b.length
  const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))

  for (let i = m - 1; i >= 0; i -= 1) {
    for (let j = n - 1; j >= 0; j -= 1) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const rows = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      rows.push({ type: 'context', text: a[i] })
      i += 1
      j += 1
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      rows.push({ type: 'remove', text: a[i] })
      i += 1
    } else {
      rows.push({ type: 'add', text: b[j] })
      j += 1
    }
  }
  while (i < m) {
    rows.push({ type: 'remove', text: a[i] })
    i += 1
  }
  while (j < n) {
    rows.push({ type: 'add', text: b[j] })
    j += 1
  }
  return rows
}
