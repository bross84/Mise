import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { stripMarkdown } from './text.js'

describe('stripMarkdown', () => {
  it('returns empty string for null/undefined', () => {
    assert.equal(stripMarkdown(null), '')
    assert.equal(stripMarkdown(undefined), '')
  })

  it('removes emphasis, code, and strikethrough markers', () => {
    assert.equal(
      stripMarkdown('**Bold** and *italic* and _also_ and `code` and ~~gone~~'),
      'Bold and italic and also and code and gone',
    )
  })

  it('removes heading, quote, and list markers', () => {
    assert.equal(
      stripMarkdown('## Storage\n- fridge 4 days\n- freezer 3 months\n1. reheat\n> tip'),
      'Storage fridge 4 days freezer 3 months reheat tip',
    )
  })

  it('keeps link text and drops urls', () => {
    assert.equal(stripMarkdown('See [the original](https://example.com/x) recipe'), 'See the original recipe')
  })

  it('drops horizontal rules and table separators', () => {
    assert.equal(stripMarkdown('a\n\n---\n\n| x | y |\n|---|---|\n| 1 | 2 |'), 'a x y 1 2')
  })

  it('leaves snake_case words alone', () => {
    assert.equal(stripMarkdown('use meal_prep_box today'), 'use meal_prep_box today')
  })
})
