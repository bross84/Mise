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
  it('keeps two decimals for weights and volumes', () => {
    assert.equal(scaleAmount(500, 'g', 0.75), 375)
    assert.equal(scaleAmount(1, 'tsp', 0.75), 0.75)
    assert.equal(scaleAmount(1, 'cup', 0.33), 0.33)
    assert.equal(scaleAmount(250, 'ml', 1.25), 312.5)
    assert.equal(scaleAmount(100, 'g', 0.38), 38)
  })

  it('rounds counts to the nearest whole number, halves up', () => {
    assert.equal(scaleAmount(3, '', 0.75), 2) // 2.25
    assert.equal(scaleAmount(12, 'pieces', 0.5), 6)
    assert.equal(scaleAmount(5, 'cloves', 0.3), 2) // 1.5 rounds up
    assert.equal(scaleAmount(2, 'large', 1.25), 3) // 2.5 rounds up
    assert.equal(scaleAmount(2, 'can', 0.75), 2) // 1.5 rounds up
    assert.equal(scaleAmount(4, '', 2), 8)
  })

  it('never lets a count round down to nothing', () => {
    assert.equal(scaleAmount(1, '', 0.25), 1)
    assert.equal(scaleAmount(1, 'egg', 0.1), 1)
    assert.equal(scaleAmount(2, 'cloves', 0.01), 1)
  })

  it('never lets a measured amount round to zero', () => {
    assert.equal(scaleAmount(0.25, 'tsp', 0.01), 0.01)
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

  it('returns the new amount and the ratio each ingredient actually changed by', () => {
    const [a, b, c] = scaleIngredients(recipe, 0.75)
    assert.deepEqual(a, { id: 'a', amount: 500, newAmount: 375, ratio: 0.75 })
    assert.equal(b.newAmount, 2)
    assert.ok(Math.abs(b.ratio - 2 / 3) < 1e-12) // 3 eggs at x0.75 is 2 eggs, not 2.25
    assert.deepEqual(c, { id: 'c', amount: 0, newAmount: 0, ratio: 1 })
  })

  it('a factor of exactly 1 changes nothing, even fractional counts', () => {
    const result = scaleIngredients([{ id: 'x', amount: 1.5, unit: '' }, { id: 'y', amount: 0.333, unit: 'cup' }], 1)
    assert.deepEqual(result.map((r) => r.newAmount), [1.5, 0.333])
    assert.equal(scalingChangesAmounts(result), false)
  })

  it('reports whether anything would change', () => {
    assert.equal(scalingChangesAmounts(scaleIngredients(recipe, 0.75)), true)
    // a recipe of only counts, scaled by a factor too small to move any of them
    assert.equal(scalingChangesAmounts(scaleIngredients([{ id: 'e', amount: 3, unit: '' }], 0.9)), false)
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

  it('uses the rounded amounts, so a count item that rounds moves the total by its own ratio', () => {
    // a: 500 g -> 375 (x0.75). b: 3 eggs -> 2 eggs (x0.667), not 2.25
    const scaled = scaleIngredients([{ id: 'a', amount: 500, unit: 'g' }, { id: 'b', amount: 3, unit: '' }], 0.75)
    const totals = scaleMacroTotals(macros, scaled)
    assert.ok(Math.abs(totals.calories - (500 * 0.75 + 300 * (2 / 3))) < 1e-9) // 575, not 600
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
