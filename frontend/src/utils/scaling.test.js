import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isMeasuredUnit, scaleAmount, scaleIngredients, scaleMacroTotals, scalingChangesAmounts } from './scaling.js'

describe('isMeasuredUnit', () => {
  it('recognizes weights and volumes, ignoring case, spacing and periods', () => {
    for (const unit of ['g', 'G', ' cups ', 'tbsp.', 'fl oz', 'fl. oz', 'FL  OZ', 'liter', 'L', 'ml', 'lbs', 'gallon', 'mg']) {
      assert.equal(isMeasuredUnit(unit), true, unit)
    }
  })

  it('treats counts, blanks and everything else as not measured', () => {
    for (const unit of ['', '  ', null, undefined, 'clove', 'cloves', 'large', 'can', 'slice', 'pinch', 'piece', 'whole', 'each', 'scoop']) {
      assert.equal(isMeasuredUnit(unit), false, String(unit))
    }
  })
})

describe('scaleAmount', () => {
  it('multiplies exactly, with no rounding', () => {
    assert.equal(scaleAmount(500, 'g', 0.75), 375)
    assert.equal(scaleAmount(3, '', 0.75), 2.25)
    assert.equal(scaleAmount(5, 'cloves', 0.3), 1.5)
    assert.equal(scaleAmount(1, 'tsp', 2.54321), 2.54321)
    assert.equal(scaleAmount(299.2, 'g', 2.54), 759.968)
    assert.equal(scaleAmount(1, 'egg', 0.1), 0.1)
    assert.equal(scaleAmount(0.25, 'tsp', 0.01), 0.0025)
  })

  it('trims floating-point noise only', () => {
    assert.equal(scaleAmount(0.1, 'cup', 3), 0.3)
    assert.equal(scaleAmount(3, '', 1 / 3), 1)
  })

  it('leaves an amount of zero alone', () => {
    assert.equal(scaleAmount(0, '', 0.5), 0)
    assert.equal(scaleAmount(0, 'g', 2), 0)
  })

  it('does not misread bad amounts', () => {
    assert.equal(scaleAmount(NaN, 'g', 2), 0)
    assert.equal(scaleAmount(undefined, '', 2), 0)
    assert.equal(scaleAmount('3', '', 2), 6) // stored amounts can arrive as strings
  })
})

describe('scaleIngredients', () => {
  const recipe = [
    { id: 'a', amount: 500, unit: 'g' },
    { id: 'b', amount: 3, unit: '' },
    { id: 'c', amount: 0, unit: '' },
  ]

  it('returns the new amount and the ratio each ingredient changed by', () => {
    const [a, b, c] = scaleIngredients(recipe, 0.75)
    assert.deepEqual(a, { id: 'a', amount: 500, newAmount: 375, ratio: 0.75 })
    assert.equal(b.newAmount, 2.25)
    assert.ok(Math.abs(b.ratio - 0.75) < 1e-12)
    assert.deepEqual(c, { id: 'c', amount: 0, newAmount: 0, ratio: 1 })
  })

  it('a factor of exactly 1 changes nothing', () => {
    const result = scaleIngredients([{ id: 'x', amount: 1.5, unit: '' }, { id: 'y', amount: 0.333, unit: 'cup' }], 1)
    assert.deepEqual(result.map((r) => r.newAmount), [1.5, 0.333])
    assert.equal(scalingChangesAmounts(result), false)
  })

  it('reports whether anything would change', () => {
    assert.equal(scalingChangesAmounts(scaleIngredients(recipe, 0.75)), true)
    assert.equal(scalingChangesAmounts(scaleIngredients([{ id: 'e', amount: 3, unit: '' }], 0.9)), true)
  })
})

describe('scaleMacroTotals', () => {
  const macros = {
    total: { calories: 800, protein: 60, carbs: 50, fat: 20 },
    breakdown: [
      { recipe_ingredient_id: 'a', matched: true, calories: 500, protein: 40, carbs: 30, fat: 10 },
      { recipe_ingredient_id: 'b', matched: true, calories: 300, protein: 20, carbs: 20, fat: 10 },
    ],
  }

  it('scales the whole recipe when every amount scales evenly (800 kcal at x0.75 is 600)', () => {
    const scaled = scaleIngredients([{ id: 'a', amount: 400, unit: 'g' }, { id: 'b', amount: 200, unit: 'g' }], 0.75)
    const totals = scaleMacroTotals(macros, scaled)
    assert.equal(Math.round(totals.calories), 600)
    assert.equal(Math.round(totals.protein), 45)
  })

  it('scales every matched ingredient by the same ratio, counts included', () => {
    const scaled = scaleIngredients([{ id: 'a', amount: 500, unit: 'g' }, { id: 'b', amount: 3, unit: '' }], 0.75)
    assert.ok(Math.abs(scaleMacroTotals(macros, scaled).calories - 600) < 1e-9)
  })

  it('leaves unmatched ingredients out, as the server does', () => {
    const withUnmatched = { ...macros, breakdown: [...macros.breakdown, { recipe_ingredient_id: 'z', matched: false, calories: null }] }
    const scaled = scaleIngredients([{ id: 'a', amount: 500, unit: 'g' }, { id: 'b', amount: 300, unit: 'g' }, { id: 'z', amount: 5, unit: '' }], 0.5)
    assert.doesNotThrow(() => scaleMacroTotals(withUnmatched, scaled))
    assert.equal(Math.round(scaleMacroTotals(withUnmatched, scaled).calories), 400)
  })

  it('returns the unchanged total at a factor of 1, and null without macros', () => {
    const scaled = scaleIngredients([{ id: 'a', amount: 500, unit: 'g' }, { id: 'b', amount: 3, unit: '' }], 1)
    assert.deepEqual(scaleMacroTotals(macros, scaled), macros.total)
    assert.equal(scaleMacroTotals(null, scaled), null)
  })
})
