import { test } from 'node:test'
import assert from 'node:assert/strict'
import { EXPIRED_TEXT, MAX_STORED_MESSAGES, loadHistory, restoreMessages, saveHistory } from './aiHistory.js'

function memoryStorage() {
  const data = new Map()
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
    data,
  }
}

const change = (id) => ({ id, op: 'update', field: 'servings', label: 'Servings', before: 2, after: 4 })

test('round-trips a conversation per recipe', () => {
  const s = memoryStorage()
  saveHistory(1, [{ id: 'a', role: 'user', content: 'hi' }], s)
  saveHistory(2, [{ id: 'b', role: 'user', content: 'other' }], s)
  assert.equal(loadHistory(1, s)[0].content, 'hi')
  assert.equal(loadHistory(2, s)[0].content, 'other')
  assert.deepEqual(loadHistory(3, s), [])
})

test('keeps only the most recent messages', () => {
  const s = memoryStorage()
  const many = Array.from({ length: MAX_STORED_MESSAGES + 10 }, (_, i) => ({ id: `m${i}`, role: 'user', content: `${i}` }))
  saveHistory(1, many, s)
  const loaded = loadHistory(1, s)
  assert.equal(loaded.length, MAX_STORED_MESSAGES)
  assert.equal(loaded[0].content, '10')
})

test('saving an empty conversation clears it', () => {
  const s = memoryStorage()
  saveHistory(1, [{ id: 'a', role: 'user', content: 'hi' }], s)
  saveHistory(1, [], s)
  assert.equal(s.data.size, 0)
})

test('open change cards come back expired; decided ones keep their result', () => {
  const [open, applied, dismissed] = restoreMessages([
    { id: 'a', role: 'assistant', content: 'x', changes: [change('c1')], busy: true },
    { id: 'b', role: 'assistant', content: 'y', changes: [change('c2')], resultText: 'Applied 1 change.' },
    { id: 'c', role: 'assistant', content: 'z', changes: [], resultText: 'Dismissed.' },
  ])
  assert.equal(open.resultText, EXPIRED_TEXT)
  assert.deepEqual(open.appliedIds, [])
  assert.equal(open.busy, undefined)
  assert.equal(applied.resultText, 'Applied 1 change.')
  assert.equal(dismissed.resultText, 'Dismissed.')
})

test('open suggestions come back expired; text-only suggestions stay plain', () => {
  const [m] = restoreMessages([
    {
      id: 'a',
      role: 'assistant',
      content: 'x',
      suggestions: [
        { id: 's1', title: 'Swap', changes: [change('c1')] },
        { id: 's2', title: 'Tip', changes: [] },
        { id: 's3', title: 'Done', changes: [change('c2')] },
      ],
      suggestionStatus: { s3: { resultText: 'Applied 1 change.' } },
    },
  ])
  assert.equal(m.suggestionStatus.s1.resultText, EXPIRED_TEXT)
  assert.equal(m.suggestionStatus.s2.resultText, undefined)
  assert.equal(m.suggestionStatus.s3.resultText, 'Applied 1 change.')
})

test('corrupt or blocked storage never throws', () => {
  const s = memoryStorage()
  s.setItem('mise.aiChat.1', '{not json')
  assert.deepEqual(loadHistory(1, s), [])
  const blocked = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('full') }, removeItem: () => {} }
  assert.deepEqual(loadHistory(1, blocked), [])
  assert.doesNotThrow(() => saveHistory(1, [{ id: 'a', role: 'user', content: 'hi' }], blocked))
})
