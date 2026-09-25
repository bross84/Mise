import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { createRecipe, getCookbooks, getIngredients, matchIngredients, parseIngredients } from '../api/client.js'
import { MarkdownField } from '../components/MarkdownText.jsx'
import IngredientSearchPanel from '../components/IngredientSearchPanel.jsx'
import ImportRecipeModal from '../components/ImportRecipeModal.jsx'
import { toTitleCase } from '../utils/text.js'

const inputCls =
  'w-full rounded border border-mise-800 bg-mise-900 px-3 py-2.5 text-sm text-mise-300 placeholder:text-mise-500 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember'

const primaryBtnCls =
  'rounded bg-ember px-4 py-2 text-sm font-semibold text-mise-950 transition hover:bg-ember-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember'

const secondaryBtnCls =
  'rounded border border-mise-800 px-3 py-2 text-sm font-medium text-mise-300 transition hover:border-mise-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember'

// ─── caret coordinate helper ────────────────────────────────────────────────

function getCaretCoords(el, index) {
  const style = window.getComputedStyle(el)
  const mirror = document.createElement('div')

  for (const prop of [
    'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
    'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft',
    'fontFamily', 'fontSize', 'fontStyle', 'fontWeight', 'lineHeight',
    'letterSpacing', 'whiteSpace', 'wordWrap', 'width', 'tabSize',
  ]) {
    mirror.style[prop] = style[prop]
  }

  mirror.style.position = 'absolute'
  mirror.style.visibility = 'hidden'
  mirror.style.whiteSpace = 'pre-wrap'
  mirror.style.wordBreak = 'break-word'
  mirror.style.boxSizing = 'border-box'
  mirror.style.top = '0'
  mirror.style.left = '0'

  const text = document.createTextNode(el.value.slice(0, index))
  const marker = document.createElement('span')
  marker.textContent = '​'
  mirror.appendChild(text)
  mirror.appendChild(marker)

  document.body.appendChild(mirror)

  const lineH = parseFloat(style.lineHeight) || 20
  const coords = {
    top: marker.offsetTop - el.scrollTop + lineH,
    left: Math.min(marker.offsetLeft, el.clientWidth - 288),
  }

  document.body.removeChild(mirror)
  return coords
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function parseAmount(str) {
  if (!str) return 0
  const s = String(str).trim()
  const fraction = s.match(/^(\d+)\s*\/\s*(\d+)$/)
  if (fraction) return parseInt(fraction[1]) / parseInt(fraction[2])
  const mixed = s.match(/^(\d+)\s+(\d+)\s*\/\s*(\d+)$/)
  if (mixed) return parseInt(mixed[1]) + parseInt(mixed[2]) / parseInt(mixed[3])
  const range = s.match(/^([\d.]+)\s*[-–]/)
  if (range) return parseFloat(range[1])
  return parseFloat(s) || 0
}

// ─── MatchedIngredientList ────────────────────────────────────────────────────

function MatchedIngredientList({ matchResults, onRerun }) {
  const [openSearch, setOpenSearch] = useState(null)
  const [acceptedIndexes, setAcceptedIndexes] = useState([])
  const [skippedIndexes, setSkippedIndexes] = useState([])

  useEffect(() => {
    // Only reset on a full match reset (null), not on partial per-ingredient updates from onRerun
    if (matchResults === null) {
      setAcceptedIndexes([])
      setSkippedIndexes([])
    }
  }, [matchResults])

  if (!matchResults) return null

  const unmatchedResults = matchResults
    .map((result, index) => ({ result, index }))
    .filter((entry) => !entry.result.match)
    .filter((entry) => !acceptedIndexes.includes(entry.index))
    .filter((entry) => !skippedIndexes.includes(entry.index))

  if (unmatchedResults.length === 0) return null

  // Build display items with group name headers
  const displayItems = []
  let lastGroup = undefined
  unmatchedResults.forEach(({ result: r, index: i }) => {
    if (r.group_name !== lastGroup) {
      lastGroup = r.group_name
      if (r.group_name) {
        displayItems.push({ type: 'group', key: `group-${r.group_name}-${i}`, name: r.group_name })
      }
    }
    displayItems.push({ type: 'ingredient', key: i, result: r, index: i })
  })

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
        {displayItems.map((item) => {
          if (item.type === 'group') {
            return (
              <li key={item.key} className="pt-1 text-[10px] font-semibold uppercase tracking-widest text-mise-600">
                {item.name}
              </li>
            )
          }
          const { result: r, index: i } = item
          const isOpen = openSearch === r.name
          return (
            <li key={item.key}>
              <div className="flex items-center gap-3 rounded border border-theme bg-mise-950/50 px-3 py-2">
                <span className="text-sm">🔴</span>
                <span className="flex-1 text-sm text-mise-300">{toTitleCase(r.name)}</span>
                <button
                  type="button"
                  onClick={() => setSkippedIndexes((prev) => prev.includes(i) ? prev : [...prev, i])}
                  className="rounded border border-mise-800 px-2.5 py-1 text-xs text-mise-400 transition hover:border-mise-700 hover:text-mise-300"
                >
                  Skip
                </button>
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
                  onSelect={async (saved) => {
                    const matched = await onRerun(i, saved)
                    setAcceptedIndexes((prev) => (prev.includes(i) ? prev : [...prev, i]))
                    return matched
                  }}
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
  const location = useLocation()

  const prefill = location.state?.prefill ?? null

  const [stage, setStage] = useState('input') // 'input' | 'review'

  // Form fields
  const [title, setTitle] = useState(prefill?.title ?? '')
  const [servingsStr, setServingsStr] = useState(prefill ? String(prefill.servings ?? 1) : '1')
  const [ingredientsText, setIngredientsText] = useState(prefill?.ingredients_text ?? '')
  const [instructions, setInstructions] = useState(prefill?.instructions ?? '')
  const [notes, setNotes] = useState(prefill?.notes ?? '')
  const [tagsText, setTagsText] = useState(prefill?.tags?.join(', ') ?? '')
  const [sourceUrl, setSourceUrl] = useState(prefill?.source_url ?? '')
  const [cookbook, setCookbook] = useState('')
  const [cookbooks, setCookbooks] = useState([])

  // URL/markdown import
  const [showImport, setShowImport] = useState(false)

  // AI parsing
  const [parsing, setParsing] = useState(false)
  const [parseError, setParseError] = useState('')
  const [parsedIngredients, setParsedIngredients] = useState([]) // [{raw, name, amount, unit, group_name}]

  // Matching
  const [matching, setMatching] = useState(false)
  const [matchResults, setMatchResults] = useState(null) // [{name, amount, unit, match, group_name}]

  // Saving
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // @ autocomplete
  const [dbIngredients, setDbIngredients] = useState([])
  const [mentionQuery, setMentionQuery] = useState(null)
  const [mentionStart, setMentionStart] = useState(0)
  const [mentionIndex, setMentionIndex] = useState(0)
  const [mentionCoords, setMentionCoords] = useState({ top: 0, left: 0 })
  const [ingredientOverrides, setIngredientOverrides] = useState({})
  const ingredientsRef = useRef(null)

  useEffect(() => {
    getCookbooks().then((d) => setCookbooks(Array.isArray(d) ? d : [])).catch(() => {})
    getIngredients().then((d) => setDbIngredients(Array.isArray(d) ? d : [])).catch(() => {})
  }, [])

  const mentionMatches = useMemo(() => {
    if (mentionQuery === null || !dbIngredients.length) return []
    const q = mentionQuery.toLowerCase()
    if (!q) return dbIngredients.slice(0, 8)
    return dbIngredients.filter((i) => i.name.toLowerCase().includes(q)).slice(0, 8)
  }, [mentionQuery, dbIngredients])

  const selectMention = (ingredient) => {
    const endPos = mentionStart + 1 + (mentionQuery?.length ?? 0)
    const newValue = ingredientsText.slice(0, mentionStart) + ingredient.name + ingredientsText.slice(endPos)
    setIngredientsText(newValue)
    setIngredientOverrides((prev) => ({ ...prev, [ingredient.name]: ingredient.id }))
    setMentionQuery(null)
    const newCursor = mentionStart + ingredient.name.length
    setTimeout(() => {
      if (ingredientsRef.current) {
        ingredientsRef.current.focus()
        ingredientsRef.current.setSelectionRange(newCursor, newCursor)
      }
    }, 0)
  }

  const handleIngredientsChange = (e) => {
    const value = e.target.value
    setIngredientsText(value)
    const pos = e.target.selectionStart
    const textBefore = value.slice(0, pos)
    const atIndex = textBefore.lastIndexOf('@')
    if (
      atIndex !== -1 &&
      !textBefore.slice(atIndex + 1).includes('\n') &&
      !textBefore.slice(atIndex + 1).includes(' ')
    ) {
      setMentionQuery(textBefore.slice(atIndex + 1))
      setMentionStart(atIndex)
      setMentionIndex(0)
      setMentionCoords(getCaretCoords(e.target, atIndex))
    } else {
      setMentionQuery(null)
    }
  }

  const handleIngredientsKeyDown = (e) => {
    if (mentionQuery === null || mentionMatches.length === 0) return
    if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIndex((prev) => Math.min(prev + 1, mentionMatches.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIndex((prev) => Math.max(prev - 1, 0)) }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); selectMention(mentionMatches[mentionIndex]) }
    else if (e.key === 'Escape') { setMentionQuery(null) }
  }

  const runMatching = async (parsed) => {
    if (!parsed.length) return
    setMatching(true)
    try {
      const items = parsed.map((p) => ({ name: p.name, amount: parseAmount(p.amount), unit: p.unit || '' }))
      const data = await matchIngredients(items)
      const enriched = (data.results || []).map((r, i) => ({ ...r, group_name: parsed[i]?.group_name ?? null }))
      setMatchResults(enriched)
    } catch {
      // matching failure is non-fatal
    } finally {
      setMatching(false)
    }
  }

  const handleParseAndContinue = async () => {
    if (!ingredientsText.trim()) { setParseError('Please enter some ingredients.'); return }
    setParseError('')
    setSaveError('')
    setParsing(true)
    try {
      const data = await parseIngredients(ingredientsText.trim(), title.trim() || undefined)
      const parsed = data.ingredients || []
      setParsedIngredients(parsed)
      // Auto-fill tags only if the user has not already typed anything
      if (!tagsText.trim() && Array.isArray(data.suggested_tags) && data.suggested_tags.length > 0) {
        setTagsText(data.suggested_tags.join(', '))
      }
      setMatchResults(null)
      setStage('review')
      await runMatching(parsed)
    } catch (err) {
      setParseError(err instanceof Error ? err.message : 'Failed to parse ingredients.')
    } finally {
      setParsing(false)
    }
  }

  const handleImported = (data) => {
    setShowImport(false)
    setTitle(data.title ?? '')
    setServingsStr(String(data.servings ?? 1))
    setIngredientsText(data.ingredients_text ?? '')
    setInstructions(data.instructions ?? '')
    setNotes(data.notes ?? '')
    setTagsText((data.tags ?? []).join(', '))
    setSourceUrl(data.source_url ?? '')
  }

  const handleStartOver = () => {
    setStage('input')
    setTitle('')
    setServingsStr('1')
    setIngredientsText('')
    setInstructions('')
    setNotes('')
    setTagsText('')
    setSourceUrl('')
    setParseError('')
    setParsedIngredients([])
    setMatchResults(null)
    setSaveError('')
    setIngredientOverrides({})
    setMentionQuery(null)
  }

  const handleSave = async () => {
    if (!title.trim()) { setSaveError('Recipe name is required.'); return }
    setSaveError('')
    setSaving(true)
    try {
      const tags = tagsText.split(',').map((t) => t.trim()).filter(Boolean)
      const ingredients = parsedIngredients.map((p, i) => ({
        id: `ing-${Date.now()}-${i}`,
        name: p.name,
        amount: parseAmount(p.amount),
        unit: p.unit || '',
        ingredient_id: ingredientOverrides[p.name] ?? matchResults?.[i]?.match?.ingredient_id ?? null,
        group_name: p.group_name ?? null,
      }))
      const recipe = await createRecipe({
        title: title.trim(),
        servings: parseInt(servingsStr, 10) || 1,
        tags,
        ingredients,
        instructions: instructions.trim() || null,
        notes: notes.trim() || null,
        source_url: sourceUrl.trim() || null,
        cookbook: cookbook.trim() || null,
        steps: [],
      })
      navigate(`/recipe/${recipe.id}`)
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save recipe.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="mx-auto w-full max-w-3xl">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-semibold text-mise-300">
            {stage === 'input' ? (prefill ? 'Import Recipe' : 'Add Recipe') : 'Review & Save'}
          </h1>
          <p className="mt-2 text-sm text-mise-500">
            {stage === 'input'
              ? prefill
                ? 'Fields pre-filled from import — review and edit before parsing ingredients.'
                : 'Fill in the recipe details, then parse your ingredient list.'
              : 'Fix any unmatched ingredients below, then save.'}
          </p>
        </div>
        {stage === 'review' ? (
          <button type="button" onClick={handleStartOver} className={`shrink-0 ${secondaryBtnCls}`}>
            Start Over
          </button>
        ) : (
          <button type="button" onClick={() => setShowImport(true)} className={`shrink-0 ${secondaryBtnCls}`}>
            Import from URL
          </button>
        )}
      </header>

      {showImport && <ImportRecipeModal onClose={() => setShowImport(false)} onImported={handleImported} />}

      {(parseError || saveError) && (
        <div className="mt-4 rounded border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          {parseError || saveError}
        </div>
      )}

      <div className="mt-6 space-y-5">
        {/* Title + Servings */}
        <div className="grid gap-4 sm:grid-cols-[1fr_120px]">
          <div>
            <label className="mb-2 block text-sm font-medium text-mise-400" htmlFor="recipe-title">
              Recipe Name
            </label>
            <input
              id="recipe-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Beef Tacos"
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-mise-400" htmlFor="recipe-servings">
              Servings
            </label>
            <input
              id="recipe-servings"
              type="number"
              min="1"
              value={servingsStr}
              onChange={(e) => setServingsStr(e.target.value)}
              className={inputCls}
            />
          </div>
        </div>

        {/* Tags + Source URL + Cookbook */}
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium text-mise-400" htmlFor="recipe-tags">
              Tags <span className="font-normal text-mise-600">(comma-separated)</span>
            </label>
            <input
              id="recipe-tags"
              type="text"
              value={tagsText}
              onChange={(e) => setTagsText(e.target.value)}
              placeholder="high protein, meal prep"
              className={inputCls}
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium text-mise-400" htmlFor="recipe-source">
              Source URL <span className="font-normal text-mise-600">(optional)</span>
            </label>
            <input
              id="recipe-source"
              type="url"
              value={sourceUrl}
              onChange={(e) => setSourceUrl(e.target.value)}
              placeholder="https://..."
              className={inputCls}
            />
          </div>
        </div>
        <div>
          <label className="mb-2 block text-sm font-medium text-mise-400" htmlFor="recipe-cookbook">
            Cookbook <span className="font-normal text-mise-600">(optional)</span>
          </label>
          <input
            id="recipe-cookbook"
            type="text"
            list="cookbook-suggestions"
            value={cookbook}
            onChange={(e) => setCookbook(e.target.value)}
            placeholder="e.g. Salt Fat Acid Heat"
            className={inputCls}
            autoComplete="off"
          />
          <datalist id="cookbook-suggestions">
            {cookbooks.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>

        {/* Ingredients with @ autocomplete */}
        <div className="relative">
          <label className="mb-2 block text-sm font-medium text-mise-400" htmlFor="recipe-ingredients">
            Ingredients
            <span className="ml-2 text-xs font-normal text-mise-600">Type @ to link to ingredient database</span>
          </label>
          <textarea
            id="recipe-ingredients"
            ref={ingredientsRef}
            rows={8}
            value={ingredientsText}
            onChange={handleIngredientsChange}
            onKeyDown={handleIngredientsKeyDown}
            placeholder={'1 cup flour\n2 eggs\n1/2 tsp salt'}
            className={inputCls}
          />
          {mentionQuery !== null && mentionMatches.length > 0 && (
            <ul
              className="absolute z-30 max-h-48 w-72 overflow-y-auto rounded border border-mise-700 bg-mise-900 shadow-xl"
              style={{ top: mentionCoords.top + 32, left: mentionCoords.left }}
            >
              {mentionMatches.map((ing, i) => (
                <li key={ing.id} className="border-b border-mise-800 last:border-none">
                  <button
                    type="button"
                    onMouseDown={(e) => { e.preventDefault(); selectMention(ing) }}
                    className={[
                      'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition focus-visible:outline-none',
                      i === mentionIndex ? 'bg-mise-800/60' : 'hover:bg-mise-800/40',
                    ].join(' ')}
                  >
                    <span className="flex-1 text-mise-300">{ing.name}</span>
                    <span className="shrink-0 text-xs text-mise-500">{ing.calories} cal · {ing.protein}g p</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Instructions */}
        <MarkdownField
          id="recipe-instructions"
          label="Instructions"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
          rows={8}
          placeholder={'1. Preheat oven to 375°F\n2. Mix dry ingredients\n3. Add wet ingredients and stir until combined'}
          textareaClassName={inputCls}
        />

        {/* Notes */}
        <MarkdownField
          id="recipe-notes"
          label="Notes"
          labelExtra="(optional)"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          placeholder="Meal prep tips, storage, substitutions..."
          textareaClassName={inputCls}
        />
      </div>

      {/* Review stage: ingredient match panel */}
      {stage === 'review' && (
        <>
          {matching && <p className="mt-4 text-xs text-mise-500">Matching ingredients…</p>}
          <MatchedIngredientList
            matchResults={matchResults}
            onRerun={async (resultIndex, savedIngredient) => {
              if (resultIndex === undefined) {
                await runMatching(parsedIngredients)
                return false
              }
              if (savedIngredient?.id) {
                setMatchResults((prev) => {
                  if (!prev) return prev
                  const next = [...prev]
                  next[resultIndex] = {
                    ...next[resultIndex],
                    match: { ingredient_id: savedIngredient.id, name: savedIngredient.name, confidence: 100, score: 100 },
                  }
                  return next
                })
                return true
              }
              const p = parsedIngredients[resultIndex]
              if (!p) return false
              try {
                const data = await matchIngredients([{ name: p.name, amount: parseAmount(p.amount), unit: p.unit || '' }])
                const r = data?.results?.[0]
                if (r) {
                  setMatchResults((prev) => {
                    if (!prev) return prev
                    const next = [...prev]
                    next[resultIndex] = { ...next[resultIndex], ...r }
                    return next
                  })
                  return Boolean(r?.match)
                }
              } catch {
                // non-fatal
              }
              return false
            }}
          />
        </>
      )}

      {/* Action buttons */}
      <div className="mt-6 flex gap-3">
        {stage === 'input' ? (
          <button
            type="button"
            onClick={handleParseAndContinue}
            disabled={parsing || !ingredientsText.trim()}
            className={`flex-1 py-3 text-base font-semibold ${primaryBtnCls}`}
          >
            {parsing ? 'Parsing Ingredients…' : 'Parse Ingredients & Continue →'}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !title.trim()}
              className={`flex-1 py-3 text-base font-semibold ${primaryBtnCls}`}
            >
              {saving ? 'Saving Recipe…' : 'Save Recipe'}
            </button>
            <button
              type="button"
              onClick={handleParseAndContinue}
              disabled={parsing || !ingredientsText.trim()}
              className={secondaryBtnCls}
              title="Re-parse ingredients after editing"
            >
              {parsing ? 'Parsing…' : 'Re-parse'}
            </button>
          </>
        )}
      </div>
    </section>
  )
}
