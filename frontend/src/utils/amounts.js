/**
 * Parses what someone types into the servings / scaling box: a plain decimal such as "2", "1.5",
 * ".25" or "2.". The value is used exactly as typed (".375" is 0.375). Returns a positive number, or null if the
 * text isn't usable (empty, zero, negative or junk).
 */
export function parseDecimal(text) {
  const s = String(text ?? '').trim()
  if (!/^(\d+\.?\d*|\.\d+)$/.test(s)) return null
  const value = Number(s)
  return value > 0 ? value : null
}

/** A number for display, exactly, without floating-point noise or trailing zeros (2, 0.5, 2.25). */
export function formatDecimal(value) {
  return String(Number(Number(value).toPrecision(12)))
}
