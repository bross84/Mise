import { useState } from 'react'
import { saveOpenRouterKey } from '../api/client.js'

const sectionClassName = 'rounded border border-theme bg-mise-900 p-4'
const labelClassName = 'mb-2 block text-sm font-medium text-mise-400'
const inputClassName =
  'w-full rounded border border-mise-800 bg-mise-950 px-3 py-2.5 pr-24 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember'

function Settings() {
  const [isApiKeyVisible, setIsApiKeyVisible] = useState(false)
  const [openRouterKey, setOpenRouterKey] = useState('')
  const [apiKeyStatus, setApiKeyStatus] = useState({ type: '', message: '' })
  const [isSavingApiKey, setIsSavingApiKey] = useState(false)
  const [units, setUnits] = useState('metric')

  const handleSaveApiKey = async () => {
    setApiKeyStatus({ type: '', message: '' })
    setIsSavingApiKey(true)

    try {
      await saveOpenRouterKey(openRouterKey)
      setApiKeyStatus({ type: 'success', message: 'OpenRouter API key saved.' })
    } catch (error) {
      setApiKeyStatus({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to save OpenRouter API key.',
      })
    } finally {
      setIsSavingApiKey(false)
    }
  }

  return (
    <section className="mx-auto w-full max-w-4xl">
      <header>
        <h1 className="font-display text-3xl font-semibold text-mise-300">Settings</h1>
        <p className="mt-2 text-sm text-mise-500">Manage app preferences and account configuration.</p>
      </header>

      <div className="mt-6 space-y-4">
        <section className={sectionClassName} aria-labelledby="settings-api-keys-heading">
          <h2 id="settings-api-keys-heading" className="text-lg font-semibold text-mise-300">
            API Keys
          </h2>
          <p className="mt-1 text-sm text-mise-500">Set your OpenRouter API key for AI-assisted workflows.</p>

          <div className="mt-4">
            <label className={labelClassName} htmlFor="openrouter-api-key">
              OpenRouter API key
            </label>
            <div className="relative">
              <input
                id="openrouter-api-key"
                type={isApiKeyVisible ? 'text' : 'password'}
                value={openRouterKey}
                onChange={(event) => setOpenRouterKey(event.target.value)}
                placeholder="sk-or-v1-..."
                className={inputClassName}
                autoComplete="off"
              />
              <button
                type="button"
                onClick={() => setIsApiKeyVisible((current) => !current)}
                aria-label={isApiKeyVisible ? 'Hide OpenRouter API key' : 'Show OpenRouter API key'}
                aria-pressed={isApiKeyVisible}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded border border-mise-800 px-3 py-1.5 text-xs font-medium text-mise-300 transition hover:border-mise-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              >
                {isApiKeyVisible ? 'Hide' : 'Show'}
              </button>
            </div>
            <div className="mt-3 flex items-center gap-3">
              <button
                type="button"
                onClick={handleSaveApiKey}
                disabled={isSavingApiKey}
                className="rounded border border-mise-800 px-3 py-1.5 text-xs font-medium text-mise-300 transition hover:border-mise-700 disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              >
                {isSavingApiKey ? 'Saving...' : 'Save Key'}
              </button>
              {apiKeyStatus.message && (
                <p
                  className={[
                    'text-xs',
                    apiKeyStatus.type === 'success' ? 'text-emerald-300' : 'text-rose-300',
                  ].join(' ')}
                  role="status"
                >
                  {apiKeyStatus.message}
                </p>
              )}
            </div>
          </div>
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

      </div>
    </section>
  )
}

export default Settings
