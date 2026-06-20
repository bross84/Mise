import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { addToMealPlan, clearMealPlan, getMealPlan, removeFromMealPlan } from '../api/client.js'

const MealPlanContext = createContext(null)

export function MealPlanProvider({ children }) {
  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getMealPlan()
      .then(setItems)
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  const recipeIds = useMemo(() => new Set(items.map((i) => i.recipe_id)), [items])

  const add = useCallback(async (recipeId) => {
    const item = await addToMealPlan(recipeId)
    setItems((prev) => [...prev, item])
    return item
  }, [])

  const remove = useCallback(async (itemId) => {
    await removeFromMealPlan(itemId)
    setItems((prev) => prev.filter((i) => i.id !== itemId))
  }, [])

  const clear = useCallback(async () => {
    await clearMealPlan()
    setItems([])
  }, [])

  return (
    <MealPlanContext.Provider value={{ items, recipeIds, loading, add, remove, clear }}>
      {children}
    </MealPlanContext.Provider>
  )
}

export function useMealPlan() {
  const ctx = useContext(MealPlanContext)
  if (!ctx) throw new Error('useMealPlan must be used within MealPlanProvider')
  return ctx
}
