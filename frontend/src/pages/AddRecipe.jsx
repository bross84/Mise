import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { createIngredient, createRecipe, matchIngredients, parseRecipe, searchIngredients } from '../api/client.js'

const inputCls =
  'w-full rounded border border-mise-800 bg-mise-900 px-3 py-2.5 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember'

const primaryBtnCls =
  'rounded bg-ember px-4 py-2 text-sm font-semibold text-mise-950 transition hover:bg-ember-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember'

const secondaryBtnCls =
  'rounded border border-mise-800 px-3 py-2 text-sm font-medium text-mise-300 transition hover:border-mise-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember'

// ─── markdown parser ─────────────────────────────────────────────────────────

function parseMarkdownRecipe(md) {
  const lines = md.split('\n')
  let title = ''
  let servings = 1
  let tags = []
  let notes = ''
  const ingredients = []
  const steps = []

  let section = null
  let notesLines = []
  let stepCounter = 0

  for (const raw of lines) {
    const line = raw.trimEnd()

    // Title
    if (/^#\s+/.test(line)) {
      title = line.replace(/^#\s+/, '').trim()
      continue
    }

    // Servings
    const servingsMatch = line.match(/^\*\*Servings:\*\*\s*(\d+)/i)
    if (servingsMatch) { servings = parseInt(servingsMatch[1], 10); continue }

    // Tags
    const tagsMatch = line.match(/^\*\*Tags:\*\*\s*(.+)/i)
    if (tagsMatch) {
      tags = tagsMatch[1].split(',').map((t) => t.trim()).filter(Boolean)
      continue
    }

    // Section headers
    if (/^##\s+Ingredients/i.test(line)) { section = 'ingredients'; continue }
    if (/^##\s+Steps/i.test(line)) { section = 'steps'; continue }
    if (/^##\s+Notes/i.test(line)) { section = 'notes'; continue }
    if (/^##\s+/.test(line)) { section = null; continue }

    if (section === 'ingredients') {
      // - 250g chicken breast  OR  - 2 eggs
      const ingMatch = line.match(/^-\s+(\d*\.?\d+)\s*g\s+(.+)/)
      if (ingMatch) {
        ingredients.push({
          id: `ing-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: ingMatch[2].trim(),
          amount: parseFloat(ingMatch[1]),
          unit: 'g',
        })
      } else {
        const bare = line.match(/^-\s+(.+)/)
        if (bare) {
          ingredients.push({
            id: `ing-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            name: bare[1].trim(),
            amount: 0,
            unit: 'g',
          })
        }
      }
    }

    if (section === 'steps') {
      const stepMatch = line.match(/^\d+\.\s+(.+)/)
      if (stepMatch) {
        stepCounter++
        steps.push({
          id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          title: `Step ${stepCounter}`,
          content: stepMatch[1].trim(),
          timer_seconds: null,
        })
      }
    }

    if (section === 'notes' && line.trim()) {
      notesLines.push(line.trim())
    }
  }

  notes = notesLines.join('\n').trim() || null

  return { title, servings, tags, ingredients, steps, notes }
}

// Split on --- separator, ignoring empty blocks
function splitMarkdownRecipes(md) {
  return md
    .split(/^---$/m)
    .map((s) => s.trim())
    .filter(Boolean)
}

function formatServingMacroLabel(result) {
  const servingCandidate =
    result.serving_grams ??
    result.serving_size_g ??
    result.serving_size ??
    result.amount_grams ??
    100
  const numericServing = Number(servingCandidate)
  const servingG = Number.isFinite(numericServing) && numericServing > 0 ? numericServing : 100
  const scale = servingG / 100

  return `Per ${servingG}g: ${Math.round((Number(result.calories) || 0) * scale)} cal · ${Math.round((Number(result.protein) || 0) * scale)}g protein · ${Math.round((Number(result.carbs) || 0) * scale)}g carbs · ${Math.round((Number(result.fat) || 0) * scale)}g fat`
}

// ─── IngredientSearchPanel ────────────────────────────────────────────────────
// Inline panel (not a dropdown) for searching USDA/OFF and adding an ingredient

function IngredientSearchPanel({ ingredientName, onAdded, onClose }) {
  const [query, setQuery] = useState(ingredientName)
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [savingIndex, setSavingIndex] = useState(null)
  const [error, setError] = useState('')
  const timerRef = useRef(null)

  const runSearch = (q, { immediate = false } = {}) => {
    clearTimeout(timerRef.current)
    setError('')
    if (q.trim().length < 2) {
      setResults([])
      return
    }
    const execute = () => {
      setSearching(true)
      searchIngredients(q)
        .then((d) => setResults(d?.results ?? []))
        .catch(() => setResults([]))
        .finally(() => setSearching(false))
    }
    if (immediate) { execute(); return }
    timerRef.current = setTimeout(execute, 400)
  }

  // Fire search immediately on mount with the pre-filled name
  useEffect(() => {
    runSearch(ingredientName, { immediate: true })
    return () => clearTimeout(timerRef.current)
  }, [])

  const handleQueryChange = (e) => {
    const q = e.target.value
    setQuery(q)
    runSearch(q)
  }

  const handleAdd = async (result, index) => {
    setSavingIndex(index)
    setError('')
    try {
      await createIngredient({
        name: result.name,
        calories: result.calories,
        protein: result.protein,
        carbs: result.carbs,
        fat: result.fat,
        unit: 'per 100g',
      })
      const matchedNow = await onAdded()
      if (matchedNow) {
        onClose()
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add ingredient.')
    } finally {
      setSavingIndex(null)
    }
  }

  return (
    <div className="mt-2 rounded border border-mise-700/60 bg-mise-950 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="relative flex-1">
          <input
            type="text"
            value={query}
            onChange={handleQueryChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); runSearch(query, { immediate: true }) }
            }}
            placeholder="Search USDA / Open Food Facts…"
            autoFocus
            className="w-full rounded border border-mise-800 bg-mise-900 px-3 py-2 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          />
          {searching && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-mise-500">Searching…</span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="shrink-0 rounded border border-mise-800 px-2.5 py-2 text-xs text-mise-500 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
        >
          Close
        </button>
      </div>

      {error && <p className="mb-2 text-xs text-rose-400">{error}</p>}

      {results.length > 0 && (
        <ul className="space-y-1">
          {results.map((r, i) => (
            <li key={i} className="flex items-center gap-3 rounded border border-mise-800 bg-mise-900/60 px-3 py-2">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm text-mise-300">{r.name}</span>
                  {r.source === 'usda' && (
                    <span className="rounded-full border border-sky-500/30 bg-sky-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-sky-200">USDA</span>
                  )}
                  {r.source === 'openfoodfacts' && (
                    <span className="rounded-full border border-emerald-500/30 bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-200">OFF</span>
                  )}
                </div>
                <p className="mt-0.5 text-xs text-mise-500">{formatServingMacroLabel(r)}</p>
              </div>
              <button
                type="button"
                disabled={savingIndex !== null}
                onClick={() => handleAdd(r, i)}
                className="shrink-0 rounded bg-ember px-3 py-1.5 text-xs font-semibold text-mise-950 transition hover:bg-ember-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              >
                {savingIndex === i ? 'Adding…' : 'Add'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {!searching && results.length === 0 && query.trim().length >= 2 && (
        <p className="text-xs text-mise-500">No results found.</p>
      )}
    </div>
  )
}

// ─── MatchedIngredientList ────────────────────────────────────────────────────

function MatchedIngredientList({ matchResults, onRerun }) {
  const [openSearch, setOpenSearch] = useState(null) // ingredient name with panel open

  if (!matchResults) return null

  const unmatchedResults = matchResults
    .map((result, index) => ({ result, index }))
    .filter((entry) => !entry.result.match)

  if (unmatchedResults.length === 0) return null

  return (
    <div className="mt-4 rounded border border-theme bg-mise-900 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-widest text-mise-500">Ingredient Matches</h3>
        <button type="button" onClick={onRerun}
          className="rounded border border-mise-800 px-2.5 py-1 text-xs text-mise-400 transition hover:border-mise-700 hover:text-mise-300">
          Re-run matching
        </button>
      </div>
      <ul className="space-y-2">
        {unmatchedResults.map(({ result: r, index: i }) => {
          const isOpen = openSearch === r.name
          return (
            <li key={i}>
              <div className="flex items-center gap-3 rounded border border-theme bg-mise-950/50 px-3 py-2">
                <span className="text-sm">🔴</span>
                <span className="flex-1 text-sm text-mise-300">{r.name}</span>
                <button
                  type="button"
                  onClick={() => setOpenSearch(isOpen ? null : r.name)}
                  className="rounded border border-mise-800 px-2.5 py-1 text-xs text-mise-400 transition hover:border-mise-700 hover:text-mise-300"
                >
                  {isOpen ? 'Cancel' : 'Search & Add'}
                </button>
              </div>
              {isOpen && (
                <IngredientSearchPanel
                  ingredientName={r.name}
                  onClose={() => setOpenSearch(null)}
                  onAdded={() => onRerun(i)}
                />
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ─── AddRecipe ───────────────────────────────────────────────────────────────

export default function AddRecipe() {
  const navigate = useNavigate()

  const [stage, setStage] = useState('input')   // 'input' | 'editor'

  // Stage 1
  const [rawText, setRawText] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')

  // Stage 2 — editor
  const [tabs, setTabs] = useState([''])
  const [activeTab, setActiveTab] = useState(0)

  // Stage 2 — matching
  const [matching, setMatching] = useState(false)
  const [matchResults, setMatchResults] = useState(null) // per-tab: array indexed by tab

  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  const matchedOnceRef = useRef({})

  const handleParse = async () => {
    setParseError('')
    setParsing(true)
    try {
      const result = await parseRecipe({ text: rawText.trim(), url: sourceUrl.trim() || undefined })
      const blocks = splitMarkdownRecipes(result.markdown)
      setTabs(blocks.length ? blocks : [result.markdown])
      setActiveTab(0)
      setMatchResults(null)
      setSaveError('')
      setStage('editor')
    } catch (err) {
      setParseError(err instanceof Error ? err.message : "Couldn't parse the recipe — try rephrasing or check the format.")
    } finally {
      setParsing(false)
    }
  }

  const handleStartOver = () => {
    setStage('input')
    setRawText('')
    setSourceUrl('')
    setParseError('')
    setTabs([''])
    setActiveTab(0)
    setMatchResults(null)
    setSaveError('')
  }

  const runMatching = async (tabIndex) => {
    const recipe = parseMarkdownRecipe(tabs[tabIndex])
    if (!recipe.ingredients.length) return
    setMatching(true)
    try {
      const data = await matchIngredients(
        recipe.ingredients.map((i) => ({ name: i.name, amount: i.amount, unit: i.unit }))
      )
      setMatchResults((prev) => {
        const next = prev ? [...prev] : Array(tabs.length).fill(null)
        next[tabIndex] = data.results
        return next
      })
    } catch {
      // matching failure is non-fatal
    } finally {
      setMatching(false)
    }
  }

  // Run matching whenever we enter the editor stage or switch tabs
  const handleTabChange = (i) => {
    setActiveTab(i)
    if (!matchResults?.[i]) runMatching(i)
  }

  const applyMatchesToRecipe = (recipe, tabIndex) => {
    const results = matchResults?.[tabIndex]
    if (!results) return recipe
    return {
      ...recipe,
      ingredients: recipe.ingredients.map((ing, i) => ({
        ...ing,
        ingredient_id: results[i]?.match?.ingredient_id ?? null,
      })),
    }
  }

  const saveOne = async (index) => {
    const recipe = applyMatchesToRecipe(parseMarkdownRecipe(tabs[index]), index)
    return createRecipe(recipe)
  }

  const handleSaveOne = async () => {
    setSaveError('')
    setSaving(true)
    try {
      const created = await saveOne(activeTab)
      if (tabs.length === 1) {
        navigate(`/recipe/${created.id}`)
      } else {
        const next = tabs.filter((_, i) => i !== activeTab)
        setTabs(next)
        setActiveTab(Math.min(activeTab, next.length - 1))
      }
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save recipe.')
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAll = async () => {
    setSaveError('')
    setSaving(true)
    try {
      const results = []
      for (let i = 0; i < tabs.length; i++) results.push(await saveOne(i))
      navigate(`/recipe/${results[0].id}`)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save recipes.')
    } finally {
      setSaving(false)
    }
  }

  const updateTab = (value) => {
    setTabs((prev) => prev.map((t, i) => i === activeTab ? value : t))
    // clear stale match results for this tab when markdown changes
    setMatchResults((prev) => {
      if (!prev) return prev
      const next = [...prev]
      next[activeTab] = null
      return next
    })
  }

  // ── Stage 1: input ──────────────────────────────────────────────────────

  if (stage === 'input') {
    return (
      <section className="mx-auto flex min-h-[calc(100vh-12rem)] w-full max-w-3xl items-center">
        <div className="w-full rounded border border-theme bg-mise-900/70 p-6 sm:p-8">
          <header>
            <h1 className="font-display text-3xl font-semibold text-mise-300">Add Recipe</h1>
            <p className="mt-2 text-sm text-mise-500">
              Paste recipe text or a URL — AI will format it into clean markdown you can edit before saving.
            </p>
          </header>

          {parseError && (
            <div className="mt-4 rounded border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {parseError}
            </div>
          )}

          <div className="mt-6 space-y-5">
            <div>
              <label className="mb-2 block text-sm font-medium text-mise-400" htmlFor="raw-recipe-text">
                Recipe Text
              </label>
              <textarea
                id="raw-recipe-text"
                rows={12}
                value={rawText}
                onChange={(e) => setRawText(e.target.value)}
                placeholder="Paste a recipe, ingredients list, or any text..."
                className={inputCls}
              />
            </div>

            <div>
              <label className="mb-2 block text-sm font-medium text-mise-400" htmlFor="source-url">
                Source URL
              </label>
              <input
                id="source-url"
                type="url"
                value={sourceUrl}
                onChange={(e) => setSourceUrl(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleParse() } }}
                placeholder="https://example.com/recipe"
                className={inputCls}
              />
            </div>

            <button
              type="button"
              onClick={handleParse}
              disabled={parsing || (!rawText.trim() && !sourceUrl.trim())}
              className={`w-full py-3 text-base font-semibold ${primaryBtnCls}`}
            >
              {parsing ? 'Formatting recipe…' : 'Parse Recipe'}
            </button>
          </div>
        </div>
      </section>
    )
  }

  // ── Stage 2: markdown editor ────────────────────────────────────────────

  const multiTab = tabs.length > 1

  const tabLabel = (md, i) => {
    const titleLine = md.split('\n').find((l) => /^#\s+/.test(l))
    return titleLine ? titleLine.replace(/^#\s+/, '').trim().slice(0, 32) : `Recipe ${i + 1}`
  }

  // Kick off matching for the active tab when first entering the editor stage
  if (stage === 'editor' && !matchedOnceRef.current[activeTab] && !matching) {
    matchedOnceRef.current[activeTab] = true
    runMatching(activeTab)
  }

  return (
    <section className="mx-auto w-full max-w-5xl">
      <header>
        <h1 className="font-display text-3xl font-semibold text-mise-300">
          {multiTab ? 'Review Parsed Recipes' : 'Review Parsed Recipe'}
        </h1>
        <p className="mt-2 text-sm text-mise-500">
          Edit the markdown below, then save. Changes here are reflected when saved.
        </p>
      </header>

      {saveError && (
        <div className="mt-4 rounded border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {saveError}
        </div>
      )}

      {/* Tab strip */}
      {multiTab && (
        <div className="mt-6 flex gap-1 overflow-x-auto border-b border-mise-800 pb-px">
          {tabs.map((md, i) => (
            <button
              key={i}
              type="button"
              onClick={() => handleTabChange(i)}
              className={[
                'shrink-0 rounded-t border border-b-0 px-4 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember',
                activeTab === i
                  ? 'border-mise-700 bg-mise-900 text-mise-300'
                  : 'border-transparent text-mise-500 hover:text-mise-300',
              ].join(' ')}
            >
              {tabLabel(md, i)}
            </button>
          ))}
        </div>
      )}

      {/* Markdown editor */}
      <div className={multiTab ? 'mt-0' : 'mt-6'}>
        <textarea
          key={activeTab}
          value={tabs[activeTab] ?? ''}
          onChange={(e) => updateTab(e.target.value)}
          spellCheck={false}
          className="w-full rounded border border-mise-800 bg-mise-900 px-4 py-3 font-mono text-sm leading-relaxed text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          style={{ minHeight: '60vh', resize: 'vertical' }}
        />
      </div>

      {/* Ingredient matching panel */}
      {matching && (
        <p className="mt-3 text-xs text-mise-500">Matching ingredients…</p>
      )}
      <MatchedIngredientList
        matchResults={matchResults?.[activeTab] ?? null}
        onRerun={async (resultIndex) => {
          if (resultIndex === undefined) {
            matchedOnceRef.current[activeTab] = false
            setMatchResults((prev) => { const n = prev ? [...prev] : []; n[activeTab] = null; return n })
            await runMatching(activeTab)
            return false
          }

          const recipe = parseMarkdownRecipe(tabs[activeTab])
          const ingredient = recipe.ingredients[resultIndex]
          if (!ingredient) {
            return false
          }

          try {
            const data = await matchIngredients([
              { name: ingredient.name, amount: ingredient.amount, unit: ingredient.unit },
            ])

            const refreshed = data?.results?.[0]
            setMatchResults((prev) => {
              if (!prev?.[activeTab]) {
                return prev
              }

              const next = [...prev]
              const tabResults = [...next[activeTab]]
              tabResults[resultIndex] = refreshed ?? tabResults[resultIndex]
              next[activeTab] = tabResults
              return next
            })

            return Boolean(refreshed?.match)
          } catch {
            return false
          }
        }}
      />

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {multiTab && (
          <button type="button" onClick={handleSaveAll} disabled={saving || matching} className={primaryBtnCls}>
            {saving ? 'Saving…' : `Save All (${tabs.length})`}
          </button>
        )}
        <button type="button" onClick={handleSaveOne} disabled={saving || matching} className={primaryBtnCls}>
          {saving ? 'Saving…' : multiTab ? 'Save This One' : 'Save Recipe'}
        </button>
        <button type="button" onClick={handleStartOver} className={secondaryBtnCls}>
          Start Over
        </button>
      </div>
    </section>
  )
}
