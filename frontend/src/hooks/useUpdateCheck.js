import { useEffect, useState } from 'react'

const REPO = 'bross84/Mise'
const DISMISSED_KEY = 'mise-update-dismissed-sha'
const CURRENT_SHA = import.meta.env.VITE_GIT_SHA || ''

function getDismissedSha() {
  try {
    return localStorage.getItem(DISMISSED_KEY) || ''
  } catch {
    return ''
  }
}

export function useUpdateCheck() {
  const [latestSha, setLatestSha] = useState(null)
  const [dismissedSha, setDismissedSha] = useState(getDismissedSha)

  useEffect(() => {
    if (!CURRENT_SHA) return

    let active = true
    fetch(`https://api.github.com/repos/${REPO}/commits/main`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data?.sha) setLatestSha(data.sha)
      })
      .catch(() => {})

    return () => {
      active = false
    }
  }, [])

  const updateAvailable =
    Boolean(latestSha) && !latestSha.startsWith(CURRENT_SHA) && latestSha !== dismissedSha

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISSED_KEY, latestSha)
    } catch {}
    setDismissedSha(latestSha)
  }

  return {
    updateAvailable,
    currentSha: CURRENT_SHA,
    latestSha,
    compareUrl: CURRENT_SHA && latestSha ? `https://github.com/${REPO}/compare/${CURRENT_SHA}...${latestSha}` : null,
    dismiss,
  }
}
