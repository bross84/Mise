import { useEffect, useState } from 'react'
import {
  deleteBlockedIngredient,
  getAiSettings,
  getBlockedIngredients,
  saveAiSettings,
  testAi,
} from '../api/client.js'

const sectionClassName = 'rounded border border-theme bg-mise-900 p-4'
const labelClassName = 'mb-2 block text-sm font-medium text-mise-400'
const inputClassName =
  'w-full rounded border border-mise-800 bg-mise-950 px-3 py-2.5 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember'

function Settings() {
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [hasKey, setHasKey] = useState(false)
  const [showProvider, setShowProvider] = useState(false)
  const [apiKeyStatus, setApiKeyStatus] = useState({ type: '', message: '' })
  const [isSaving, setIsSaving] = useState(false)
  const [testStatus, setTestStatus] = useState({ type: '', message: '' })
  const [isTesting, setIsTesting] = useState(false)
  const [units, setUnits] = useState('metric')
  const [blocked, setBlocked] = useState([])
  const [blockedLoading, setBlockedLoading] = useState(true)

  useEffect(() => {
    getAiSettings()
      .then((data) => {
        if (!data) return
        setModel(data.model ?? '')
        setBaseUrl(data.base_url ?? '')
        setHasKey(Boolean(data.has_key))
        if (data.base_url && data.base_url !== 'https://openrouter.ai/api/v1') {
          setShowProvider(true)
        }
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    getBlockedIngredients()
      .then((data) => setBlocked(Array.isArray(data) ? data : []))
      .catch(() => setBlocked([]))
      .finally(() => setBlockedLoading(false))
  }, [])

  const handleUnblock = async (id) => {
    setBlocked((prev) => prev.filter((b) => b.id !== id))
    try {
      await deleteBlockedIngredient(id)
    } catch {
      getBlockedIngredients().then((data) => setBlocked(Array.isArray(data) ? data : [])).catch(() => {})
    }
  }

  const handleSave = async () => {
    setApiKeyStatus({ type: '', message: '' })
    setTestStatus({ type: '', message: '' })
    setIsSaving(true)
    try {
      const payload = { model: model.trim(), base_url: baseUrl.trim() }
      if (apiKey.trim()) payload.api_key = apiKey.trim()
      const data = await saveAiSettings(payload)
      setHasKey(Boolean(data?.has_key))
      setApiKey('')
      setApiKeyStatus({ type: 'success', message: 'AI settings saved.' })
    } catch (error) {
      setApiKeyStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to save AI settings.',
      })
    } finally {
      setIsSaving(false)
    }
  }

  const handleTest = async () => {
    setTestStatus({ type: '', message: '' })
    setIsTesting(true)
    try {
      const data = await testAi()
      setTestStatus({ type: 'success', message: `Connected — model replied: “${(data?.response ?? '').slice(0, 60)}”` })
    } catch (error) {
      setTestStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Connection test failed.',
      })
    } finally {
      setIsTesting(false)
    }
  }

  return (
    <section className="mx-auto w-full max-w-4xl">
      <header>
        <h1 className="font-display text-3xl font-semibold text-mise-300">Settings</h1>
        <p className="mt-2 text-sm text-mise-500">Manage app preferences and account configuration.</p>
      </header>

      <div className="mt-6 space-y-4">
        <section className={sectionClassName} aria-labelledby="settings-ai-heading">
          <h2 id="settings-ai-heading" className="text-lg font-semibold text-mise-300">
            AI
          </h2>
          <p className="mt-1 text-sm text-mise-500">
            Used for recipe and ingredient parsing, tag suggestions, and the recipe assistant. Works with
            any OpenAI-compatible API.
          </p>

          <div className="mt-4">
            <label className={labelClassName} htmlFor="ai-api-key">
              API key {hasKey && <span className="font-normal text-mise-600">· a key is saved</span>}
            </label>
            <div className="relative">
              <input
                id="ai-api-key"
                type={isApiKeyVisible ? 'text' : 'password'}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder={hasKey ? 'Enter a new key to replace the saved one' : 'sk-or-v1-…'}
                className={`${inputClassName} pr-20`}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setIsApiKeyVisible((current) => !current)}
                aria-label={isApiKeyVisible ? 'Hide API key' : 'Show API key'}
                aria-pressed={isApiKeyVisible}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-mise-800 px-3 py-1.5 text-xs font-medium text-mise-300 transition hover:border-mise-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              >
                {isApiKeyVisible ? 'Hide' : 'Show'}
              </button>
            </div>
          </div>

          <div className="mt-4">
            <label className={labelClassName} htmlFor="ai-model">
              Model
            </label>
            <input
              id="ai-model"
              type="text"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="deepseek/deepseek-chat"
              className={inputClassName}
              autoComplete="off"
            />
          </div>

          <div className="mt-3">
            <button
              type="button"
              onClick={() => setShowProvider((v) => !v)}
              className="text-xs text-mise-400 underline-offset-2 transition hover:text-mise-300 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              {showProvider ? 'Hide provider settings' : 'Provider settings'}
            </button>
            {showProvider && (
              <div className="mt-3">
                <label className={labelClassName} htmlFor="ai-base-url">
                  API base URL
                </label>
                <input
                  id="ai-base-url"
                  type="url"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder="https://openrouter.ai/api/v1"
                  className={inputClassName}
                  autoComplete="off"
                />
                <p className="mt-1.5 text-xs text-mise-600">
                  e.g. <code className="text-mise-500">https://api.openai.com/v1</code> ·{' '}
                  <code className="text-mise-500">http://localhost:11434/v1</code> for Ollama
                </p>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="rounded border border-mise-800 px-3 py-1.5 text-xs font-medium text-mise-300 transition hover:border-mise-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              {isSaving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={handleTest}
              disabled={isTesting}
              className="rounded border border-mise-800 px-3 py-1.5 text-xs font-medium text-mise-400 transition hover:border-mise-700 hover:text-mise-300 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            >
              {isTesting ? 'Testing…' : 'Test connection'}
            </button>
          </div>

          {apiKeyStatus.message && (
            <p
              className={['mt-3 text-xs', apiKeyStatus.type === 'success' ? 'text-emerald-300' : 'text-rose-300'].join(' ')}
              role="status"
            >
              {apiKeyStatus.message}
            </p>
          )}
          {testStatus.message && (
            <p
              className={['mt-2 text-xs', testStatus.type === 'success' ? 'text-emerald-300' : 'text-rose-300'].join(' ')}
              role="status"
            >
              {testStatus.message}
            </p>
          )}
        </section>

        <section className={sectionClassName} aria-labelledby="settings-units-heading">
          <h2 id="settings-units-heading" className="text-lg font-semibold text-mise-300">
            Units
          </h2>
          <p className="mt-1 text-sm text-mise-500">Choose your preferred unit system.</p>

          <div className="mt-4 inline-flex rounded border border-mise-800 bg-mise-950 p-1" role="radiogroup" aria-label="Unit system">
            {['metric', 'imperial'].map((unit) => (
              <button
                key={unit}
                type="button"
                role="radio"
                aria-checked={units === unit}
                onClick={() => setUnits(unit)}
                className={[
                  'rounded px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember',
                  units === unit ? 'bg-ember text-white' : 'text-mise-400 hover:text-mise-300',
                ].join(' ')}
              >
                {unit.charAt(0).toUpperCase() + unit.slice(1)}
              </button>
            ))}
          </div>
        </section>

        <section className={sectionClassName} aria-labelledby="settings-blocked-heading">
          <h2 id="settings-blocked-heading" className="text-lg font-semibold text-mise-300">
            Blocked Ingredients
          </h2>
          <p className="mt-1 text-sm text-mise-500">
            These search results are hidden from ingredient search. Unblock to make them appear again.
          </p>

          <div className="mt-4">
            {blockedLoading && (
              <p className="text-xs text-mise-500">Loading…</p>
            )}
            {!blockedLoading && blocked.length === 0 && (
              <p className="text-xs text-mise-500">No blocked ingredients.</p>
            )}
            {!blockedLoading && blocked.length > 0 && (
              <ul className="space-y-2">
                {blocked.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 rounded border border-mise-800 bg-mise-950 px-3 py-2">
                    <div className="min-w-0">
                      <span className="text-sm text-mise-300">{b.name}</span>
                      <span className={[
                        'ml-2 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                        b.source === 'usda' ? 'border border-sky-500/30 bg-sky-500/20 text-sky-200' : 'border border-emerald-500/30 bg-emerald-500/20 text-emerald-200',
                      ].join(' ')}>
                        {b.source === 'usda' ? 'USDA' : 'OFF'}
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleUnblock(b.id)}
                      className="shrink-0 rounded border border-mise-800 px-2.5 py-1 text-xs text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
                    >
                      Unblock
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

      </div>
    </section>
  )
}

export default Settings
