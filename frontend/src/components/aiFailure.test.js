import { test } from 'node:test'
import assert from 'node:assert/strict'
import { failureMessage } from './aiFailure.js'

const httpError = (status, detail) => Object.assign(new Error(String(detail ?? '')), { status, detail })

test('relays the provider reason and points at the key on a 401', () => {
  const msg = failureMessage(httpError(502, 'AI request failed (401): User not found'))
  assert.match(msg, /AI request failed \(401\): User not found\./)
  assert.match(msg, /Check the API key in Settings\./)
  assert.match(msg, /Nothing was changed\.$/)
})

test('says the account is out of credits on a 402', () => {
  const msg = failureMessage(httpError(502, 'AI request failed (402): Insufficient credits.'))
  assert.match(msg, /Insufficient credits\. The AI provider account is out of credits\./)
})

test('relays a reason with no status code and adds no hint', () => {
  const msg = failureMessage(httpError(502, 'AI request failed: ReadTimeout'))
  assert.equal(msg, 'The AI provider refused the request: AI request failed: ReadTimeout. Nothing was changed.')
})

test('keeps the generic message when a proxy answered with no detail', () => {
  const msg = failureMessage(httpError(502, null))
  assert.match(msg, /didn’t respond \(error 502\)/)
})

test('timeouts and stops are unchanged', () => {
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' })
  assert.match(failureMessage(abort, true), /within 100 seconds/)
  assert.equal(failureMessage(abort, false), 'Stopped. Nothing was changed.')
})
