const DEFAULT_API_URL = 'http://localhost:8001/api'

/**
 * Turns a stored recipe image URL into one the browser can load.
 *
 * Uploaded files ("/uploads/...") are served by the backend, so they share the API's origin. That
 * comes from VITE_API_URL: a relative value ("/api", behind nginx in production) keeps the path
 * relative, and an absolute one ("http://localhost:8001/api" in dev) supplies the host. External
 * image URLs pass through unchanged.
 */
export function resolveUploadUrl(imageUrl, apiUrl = import.meta.env.VITE_API_URL ?? DEFAULT_API_URL) {
  if (!imageUrl) return null
  if (!imageUrl.startsWith('/uploads/')) return imageUrl
  const origin = /^https?:\/\/[^/]+/i.exec(apiUrl)?.[0]
  return origin ? `${origin}${imageUrl}` : imageUrl
}
