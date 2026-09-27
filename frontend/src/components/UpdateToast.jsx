import { X } from 'lucide-react'
import { useUpdateCheck } from '../hooks/useUpdateCheck.js'

export default function UpdateToast() {
  const { updateAvailable, latestSha, compareUrl, dismiss } = useUpdateCheck()

  if (!updateAvailable) return null

  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-80 items-start gap-3 rounded border border-mise-800 bg-mise-900 p-4 shadow-lg">
      <div className="flex-1">
        <p className="text-sm font-medium text-mise-300">Update available</p>
        <p className="mt-1 text-xs text-mise-500">
          A newer build is on GitHub ({latestSha.slice(0, 7)}). Pull the latest images to update.
        </p>
        {compareUrl && (
          <a
            href={compareUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-2 inline-block text-xs font-medium text-ember hover:text-ember-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          >
            View changes
          </a>
        )}
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss update notification"
        className="rounded p-1 text-mise-600 transition hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
      >
        <X size={15} />
      </button>
    </div>
  )
}
