import { useState } from 'react'

/**
 * A recipe image that renders `fallback` when there is no URL or the file fails to load.
 * The failure is remembered per URL, so a changed URL (e.g. the image was re-uploaded) gets a
 * fresh attempt instead of staying hidden.
 */
export default function RecipeImage({ src, className, fallback }) {
  const [failedSrc, setFailedSrc] = useState(null)

  if (!src || failedSrc === src) return fallback

  return (
    <img
      src={src}
      alt=""
      className={className}
      loading="lazy"
      onError={() => setFailedSrc(src)}
    />
  )
}
