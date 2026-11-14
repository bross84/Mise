// Per-recipe assistant chat history, kept in this browser only (localStorage).
//
// Restored change cards are read-only: a card that was still open when the cook left may no longer
// match the recipe (it could have been edited since), so applying it later is not allowed.

export const MAX_STORED_MESSAGES = 50
export const EXPIRED_TEXT = 'Expired — draft again to apply.'

const keyFor = (recipeId) => `mise.aiChat.${recipeId}`

function defaultStorage() {
  try {
    return globalThis.localStorage ?? null
  } catch {
    return null // access can throw when site data is blocked
  }
}

// Lock anything that was still waiting for a decision; drop transient UI flags.
export function restoreMessages(messages) {
  if (!Array.isArray(messages)) return []
  return messages
    .filter((m) => m && typeof m.content === 'string' && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => {
      if (m.role !== 'assistant') return m
      const restored = { ...m, restored: true }
      delete restored.busy
      // Expired cards show nothing ticked, so they can't be mistaken for applied ones.
      if (restored.changes?.length && !restored.resultText) {
        restored.resultText = EXPIRED_TEXT
        restored.appliedIds = []
      }
      if (restored.suggestions?.length) {
        const status = { ...(restored.suggestionStatus ?? {}) }
        for (const s of restored.suggestions) {
          const prev = status[s.id] ?? {}
          const expire = !prev.resultText && s.changes?.length > 0
          status[s.id] = expire
            ? { ...prev, busy: false, resultText: EXPIRED_TEXT, appliedIds: [] }
            : { ...prev, busy: false }
        }
        restored.suggestionStatus = status
      }
      return restored
    })
}

export function loadHistory(recipeId, storage = defaultStorage()) {
  if (recipeId == null || !storage) return []
  try {
    const raw = storage.getItem(keyFor(recipeId))
    return raw ? restoreMessages(JSON.parse(raw)) : []
  } catch {
    return []
  }
}

export function saveHistory(recipeId, messages, storage = defaultStorage()) {
  if (recipeId == null || !storage) return
  try {
    if (!messages.length) {
      storage.removeItem(keyFor(recipeId))
      return
    }
    storage.setItem(keyFor(recipeId), JSON.stringify(messages.slice(-MAX_STORED_MESSAGES)))
  } catch {
    // Full or blocked storage: the chat still works, it just won't survive a reload.
  }
}
