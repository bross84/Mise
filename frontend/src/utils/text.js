/**
 * Flattens markdown to a single line of plain text for card previews, where
 * rendering block elements inside a line-clamped box isn't practical.
 */
export function stripMarkdown(str) {
  return String(str ?? '')
    .replace(/```[^\n]*\n?([\s\S]*?)```/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s{0,3}(?:[-*_]\s*){3,}$/gm, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}>\s?/gm, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/gm, '')
    .replace(/^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)*\|?\s*$/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(?<!\w)__(.+?)__(?!\w)/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/(?<!\w)_(.+?)_(?!\w)/g, '$1')
    .replace(/~~(.+?)~~/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Title-cases each word for display. null/undefined render as '' and other values are stringified. */
export function toTitleCase(str) {
  return String(str ?? '').replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
}
