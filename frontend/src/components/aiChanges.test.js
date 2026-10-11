import test from 'node:test'
import assert from 'node:assert/strict'
import { applyChanges, buildUpdatePayload, unmatchedChanges } from './aiChanges.js'

const recipe = {
  servings: 1,
  ingredients: [
    { id: 'a', name: 'Oil', amount: 4.6, unit: 'g' },
    { id: 7, name: 'Paprika', amount: 7.5, unit: 'g' },
  ],
}
const update = (target_id, after) => ({ id: `c-${target_id}`, op: 'update', field: 'ingredients', target_id, after })

test('applies updates to matching ingredients', () => {
  const next = applyChanges(recipe, [update('a', { amount: 5 })])
  assert.equal(next.ingredients[0].amount, 5)
  assert.equal(next.ingredients[1].amount, 7.5)
})

test('matches ids across string and number types and keeps the original id', () => {
  const next = applyChanges(recipe, [update('7', { amount: 8 })])
  assert.equal(next.ingredients[1].amount, 8)
  assert.equal(next.ingredients[1].id, 7)
})

test('an update cannot overwrite the ingredient id', () => {
  const next = applyChanges(recipe, [update('a', { amount: 5, id: 'zzz' })])
  assert.equal(next.ingredients[0].id, 'a')
})

test('unmatchedChanges lists ingredient changes that target nothing', () => {
  const missing = unmatchedChanges(recipe, [update('a', { amount: 5 }), update('nope', { amount: 1 })])
  assert.deepEqual(missing.map((c) => c.target_id), ['nope'])
})

test('buildUpdatePayload sends the changed amounts', () => {
  const { payload } = buildUpdatePayload(recipe, [update('a', { amount: 5 })])
  assert.equal(payload.ingredients[0].amount, 5)
})
