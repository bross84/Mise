// Shared nutrition inputs for every place a food is created or edited.
// State shape and API helpers live in ../utils/nutrition.js.
import { MACRO_FIELDS, nutritionPreviewLines } from '../utils/nutrition.js'

const fieldCls =
  'w-full rounded border border-mise-800 bg-mise-950 px-3 py-2 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember'

const toggleCls = (active) =>
  [
    'px-2.5 py-1 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember first:rounded-l last:rounded-r',
    active ? 'bg-mise-800 text-mise-300' : 'text-mise-500 hover:text-mise-300',
  ].join(' ')

/**
 * Controlled by `form` (see emptyNutritionForm); `onChange` receives the next form object.
 * `legacyUnit` shows a notice for foods saved under an older, non-100 g unit.
 */
export default function NutritionFields({ form, onChange, idPrefix, legacyUnit }) {
  const set = (patch) => onChange({ ...form, ...patch })
  const perServing = form.basis === 'per_serving'
  const preview = nutritionPreviewLines(form)
  const basisLabelId = `${idPrefix}-basis-label`

  return (
    <div className="space-y-3">
      {legacyUnit && (
        <p className="border-l-2 border-ember pl-3 text-xs text-mise-300">
          Saved as “{legacyUnit}”. Confirm which amount these values are for before saving.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <span id={basisLabelId} className="text-xs text-mise-500">Label values are</span>
        <div role="radiogroup" aria-labelledby={basisLabelId} className="flex items-center rounded border border-mise-800 text-xs font-medium">
          <button type="button" role="radio" aria-checked={!perServing} onClick={() => set({ basis: 'per_100g' })} className={toggleCls(!perServing)}>
            Per 100 g
          </button>
          <button type="button" role="radio" aria-checked={perServing} onClick={() => set({ basis: 'per_serving' })} className={toggleCls(perServing)}>
            Per serving
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {MACRO_FIELDS.map(([key, label]) => (
          <div key={key}>
            <label htmlFor={`${idPrefix}-${key}`} className="mb-1 block text-xs text-mise-500">{label}</label>
            <input
              id={`${idPrefix}-${key}`}
              type="number"
              min="0"
              step="any"
              value={form[key]}
              onChange={(e) => set({ [key]: e.target.value })}
              placeholder="0"
              required
              className={fieldCls}
            />
          </div>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div>
          <label htmlFor={`${idPrefix}-serving-grams`} className="mb-1 block text-xs text-mise-500">
            Serving weight (g){perServing ? '' : ', optional'}
          </label>
          <input
            id={`${idPrefix}-serving-grams`}
            type="number"
            min="0"
            step="any"
            value={form.serving_grams}
            onChange={(e) => set({ serving_grams: e.target.value })}
            placeholder="e.g. 56"
            required={perServing}
            className={fieldCls}
          />
        </div>
        <div>
          <label htmlFor={`${idPrefix}-serving-quantity`} className="mb-1 block text-xs text-mise-500">
            Pieces per serving, optional
          </label>
          <input
            id={`${idPrefix}-serving-quantity`}
            type="number"
            min="1"
            step="1"
            value={form.serving_quantity}
            onChange={(e) => set({ serving_quantity: e.target.value })}
            placeholder="e.g. 2"
            className={fieldCls}
          />
        </div>
      </div>

      <p className="text-[11px] text-mise-500">
        {perServing
          ? 'The weight of one serving, from the label. Values are converted to per 100 g when saved.'
          : 'Serving weight and pieces let recipes use pieces, scoops or servings.'}
      </p>

      {preview.length > 0 && (
        <div className="space-y-0.5 text-xs text-mise-400" aria-live="polite">
          {preview.map((line) => <p key={line}>{line}</p>)}
        </div>
      )}
    </div>
  )
}

/**
 * Shown when the server rejects a save because calories don't match the macros.
 * `detail` is the error's `detail` payload; `onConfirm` retries with the override set.
 */
export function CalorieMismatchNotice({ detail, onConfirm, confirmLabel = 'Save anyway', busy = false }) {
  if (!detail) return null
  return (
    <div role="alert" className="border-l-2 border-ember bg-mise-950 px-3 py-2 text-xs text-mise-300">
      <p>{detail.message}</p>
      <p className="mt-1 text-mise-500">Check the numbers against the label, or keep them as entered.</p>
      <button
        type="button"
        onClick={onConfirm}
        disabled={busy}
        className="mt-2 rounded border border-mise-700 px-2.5 py-1 font-medium text-mise-300 transition hover:border-mise-600 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
      >
        {busy ? 'Saving…' : confirmLabel}
      </button>
    </div>
  )
}
