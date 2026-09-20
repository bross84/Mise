import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { formatDecimal, parseDecimal } from './amounts.js'

describe('parseDecimal', () => {
  it('reads whole numbers and decimals', () => {
    assert.equal(parseDecimal('2'), 2)
    assert.equal(parseDecimal('1.5'), 1.5)
    assert.equal(parseDecimal('1.25'), 1.25)
    assert.equal(parseDecimal('.5'), 0.5)
    assert.equal(parseDecimal('.25'), 0.25)
    assert.equal(parseDecimal('2.'), 2)
  })

  it('rounds to two decimals so the box and the scale agree', () => {
    assert.equal(parseDecimal('.375'), 0.38)
    assert.equal(parseDecimal('1.234'), 1.23)
    assert.equal(parseDecimal('0.999'), 1)
  })

  it('ignores surrounding whitespace', () => {
    assert.equal(parseDecimal('  1.5  '), 1.5)
  })

  it('rejects fractions, comma decimals and anything else that is not a plain decimal', () => {
    for (const text of ['1/2', '1 1/2', '0,5', '1e3', '1.2.3', '1.5x', 'abc', '½', '', '   ', '1 2']) {
      assert.equal(parseDecimal(text), null, JSON.stringify(text))
    }
  })

  it('rejects zero, negatives, and values that round to zero', () => {
    for (const text of ['0', '0.0', '-1', '-0.5', '0.004']) {
      assert.equal(parseDecimal(text), null, JSON.stringify(text))
    }
    assert.equal(parseDecimal('0.005'), 0.01)
  })

  it('handles missing input and numbers', () => {
    assert.equal(parseDecimal(null), null)
    assert.equal(parseDecimal(undefined), null)
    assert.equal(parseDecimal(3), 3)
    assert.equal(parseDecimal(0), null)
  })
})

describe('formatDecimal', () => {
  it('drops trailing zeros and keeps up to two decimals', () => {
    assert.equal(formatDecimal(2), '2')
    assert.equal(formatDecimal(0.5), '0.5')
    assert.equal(formatDecimal(1.25), '1.25')
    assert.equal(formatDecimal(0.375), '0.38')
    assert.equal(formatDecimal(2.5000000001), '2.5')
  })
})
