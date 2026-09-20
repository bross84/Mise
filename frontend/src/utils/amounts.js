/**
 * Parses what someone types into the servings / scaling box: a plain decimal such as "2", "1.5",
 * ".25" or "2.". The result is rounded to two decimals, so what the box shows is what gets used and
 * saved (".375" becomes 0.38). Returns a positive number, or null if the text isn't usable (empty,
 * zero, negative, junk, or small enough to round to zero).
 */
export function parseDecimal(text) {
  const s = String(text ?? '').trim()
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null
  const value = Math.round(Number(s) * 100) / 100
  return value > 0 ? value : null
}

/** A number for display: up to two decimals, no trailing zeros (2, 0.5, 1.25). */
export function formatDecimal(value) {
  return String(Math.round(value * 100) / 100)
}
