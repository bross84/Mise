/** Title-cases each word for display. null/undefined render as '' and other values are stringified. */
export function toTitleCase(str) {
  return String(str ?? '').replace(/\S+/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
}
