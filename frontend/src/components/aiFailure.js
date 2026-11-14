// What the cook sees when an assistant request fails. Always says whether anything changed.

// The backend turns every failed AI-provider call into a 502 whose `detail` is the provider's own
// reason, e.g. "AI request failed (401): User not found." Map the common codes to the fix.
const PROVIDER_HINTS = {
  401: 'Check the API key in Settings.',
  402: 'The AI provider account is out of credits.',
  404: 'Check the model in Settings.',
  429: 'The AI provider is rate-limiting requests. Wait a moment and try again.',
}

export function failureMessage(err, timedOut) {
  if (err?.name === 'AbortError') {
    return timedOut
      ? 'The assistant didn’t answer within 100 seconds, so I stopped waiting. Nothing was changed. Try again, or ask for less at once.'
      : 'Stopped. Nothing was changed.'
  }
  if ([502, 503, 504].includes(err?.status)) {
    // A string detail means our backend reached the provider and is relaying its reason.
    // Without one, the gateway/proxy answered, so the generic message is all we know.
    if (typeof err.detail === 'string' && err.detail.trim()) {
      const reason = err.detail.trim().replace(/([^.!?])$/, '$1.')
      const code = Number(reason.match(/\((\d{3})\)/)?.[1])
      const hint = PROVIDER_HINTS[code] ? ` ${PROVIDER_HINTS[code]}` : ''
      return `The AI provider refused the request: ${reason}${hint} Nothing was changed.`
    }
    return `The assistant service didn’t respond (error ${err.status}). Nothing was changed. This is usually the AI provider being slow or briefly down. Try the same message again.`
  }
  return err instanceof Error ? `${err.message} Nothing was changed.` : 'The assistant request failed. Nothing was changed.'
}
