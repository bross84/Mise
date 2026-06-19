import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

const GROUPS = [
  {
    label: 'Weight',
    units: [
      { key: 'g', label: 'g', toBase: (v) => v, fromBase: (v) => v },
      { key: 'oz', label: 'oz', toBase: (v) => v * 28.3495, fromBase: (v) => v / 28.3495 },
      { key: 'lbs', label: 'lbs', toBase: (v) => v * 453.592, fromBase: (v) => v / 453.592 },
    ],
  },
  {
    label: 'Volume',
    units: [
      { key: 'ml', label: 'ml', toBase: (v) => v, fromBase: (v) => v },
      { key: 'tsp', label: 'tsp', toBase: (v) => v * 4.92892, fromBase: (v) => v / 4.92892 },
      { key: 'tbsp', label: 'tbsp', toBase: (v) => v * 14.7868, fromBase: (v) => v / 14.7868 },
      { key: 'fl oz', label: 'fl oz', toBase: (v) => v * 29.5735, fromBase: (v) => v / 29.5735 },
      { key: 'cup', label: 'cup', toBase: (v) => v * 236.588, fromBase: (v) => v / 236.588 },
    ],
  },
]

function fmt(n) {
  if (!Number.isFinite(n) || n === 0) return '0'
  if (Math.abs(n) >= 100) return n.toFixed(1).replace(/\.0$/, '')
  if (Math.abs(n) >= 10) return n.toFixed(2).replace(/\.?0+$/, '')
  return n.toFixed(3).replace(/\.?0+$/, '')
}

export default function UnitConverterModal({ onClose }) {
  const [value, setValue] = useState('')
  const [fromKey, setFromKey] = useState('g')
  const inputRef = useRef(null)

  useEffect(() => {
    inputRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const num = parseFloat(value)
  const fromUnit = GROUPS.flatMap((g) => g.units).find((u) => u.key === fromKey)
  const baseValue = fromUnit && Number.isFinite(num) ? fromUnit.toBase(num) : null

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Unit converter"
    >
      <button
        type="button"
        className="absolute inset-0 bg-mise-950/70 backdrop-blur-sm focus-visible:outline-none"
        onClick={onClose}
        aria-label="Close"
        tabIndex={-1}
      />

      <div className="relative z-10 w-full max-w-sm rounded-t-xl border border-mise-800 bg-mise-950 p-5 shadow-xl sm:rounded-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-mise-500">Unit Converter</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded text-mise-500 transition hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            aria-label="Close converter"
          >
            <X size={18} />
          </button>
        </div>

        {/* Input row */}
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="number"
            inputMode="decimal"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="0"
            className="w-full rounded border border-mise-800 bg-mise-900 px-3 py-2 text-lg font-semibold text-mise-300 placeholder:text-mise-600 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          />
          <select
            value={fromKey}
            onChange={(e) => setFromKey(e.target.value)}
            className="rounded border border-mise-800 bg-mise-900 px-2 py-2 text-sm text-mise-300 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          >
            {GROUPS.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.units.map((u) => (
                  <option key={u.key} value={u.key}>{u.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>

        {/* Results */}
        <div className="mt-4 space-y-4">
          {GROUPS.map((group) => {
            const inGroup = group.units.some((u) => u.key === fromKey)
            const targets = group.units.filter((u) => u.key !== fromKey)
            if (!inGroup) return null
            return (
              <div key={group.label}>
                <ul className="space-y-1">
                  {targets.map((u) => {
                    const converted = baseValue !== null ? u.fromBase(baseValue) : null
                    return (
                      <li
                        key={u.key}
                        className="flex items-center justify-between rounded border border-mise-800 bg-mise-900/60 px-3 py-2"
                      >
                        <span className="text-sm text-mise-500">{u.label}</span>
                        <span className="text-base font-semibold text-mise-300">
                          {converted !== null ? fmt(converted) : '—'}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
