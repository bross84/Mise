import { useEffect, useRef, useState } from 'react'
import { ImageUp, Upload, X } from 'lucide-react'
import { importMarkdown, ocrImage, parseRecipe } from '../api/client.js'

export default function ImportRecipeModal({ onClose, onImported }) {
  const [tab, setTab] = useState('url') // 'url' | 'text' | 'markdown'
  const [url, setUrl] = useState('')
  const [text, setText] = useState('')
  const [markdown, setMarkdown] = useState('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const [shots, setShots] = useState([]) // object URLs of the images read so far, shown for checking
  const fileRef = useRef(null)
  const imageRef = useRef(null)
  const shotsRef = useRef([])

  useEffect(() => () => shotsRef.current.forEach((shot) => URL.revokeObjectURL(shot)), [])

  // Reads an image (pasted screenshot or picked photo) into the text box. The result is raw OCR
  // text, so it stays editable and goes through the same /parse cleanup as typed text on Import.
  // OCR can misread a number into another plausible one, so the image stays on screen to check against.
  const readImage = async (file) => {
    setError('')
    setReading(true)
    try {
      const { text: read } = await ocrImage(file)
      const shot = URL.createObjectURL(file)
      shotsRef.current.push(shot)
      setShots((current) => [...current, shot])
      setText((current) => (current.trim() ? `${current.trimEnd()}\n\n${read}` : read))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not read the image.')
    } finally {
      setReading(false)
    }
  }

  const handleTextPaste = (e) => {
    const image = [...(e.clipboardData?.files ?? [])].find((f) => f.type.startsWith('image/'))
    if (!image) return
    e.preventDefault()
    readImage(image)
  }

  const handleImagePicked = (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) readImage(file)
  }

  const handleFile = (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = (evt) => setMarkdown(evt.target.result ?? '')
    reader.readAsText(file)
    e.target.value = ''
  }

  const handleSubmit = async () => {
    setError('')
    setImporting(true)
    try {
      let data
      if (tab === 'url') {
        if (!url.trim()) { setError('Enter a recipe URL.'); setImporting(false); return }
        const parsed = await parseRecipe({ url: url.trim() })
        data = await importMarkdown(parsed.markdown)
      } else if (tab === 'text') {
        if (!text.trim()) { setError('Paste the recipe text first.'); setImporting(false); return }
        const parsed = await parseRecipe({ text: text.trim() })
        data = await importMarkdown(parsed.markdown)
      } else {
        if (!markdown.trim()) { setError('Paste or load a markdown file first.'); setImporting(false); return }
        data = await importMarkdown(markdown.trim())
      }
      onImported(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed.')
    } finally {
      setImporting(false)
    }
  }

  const tabCls = (t) =>
    `px-3 py-1.5 text-xs font-medium rounded-t border-b-0 transition focus-visible:outline-none ${
      tab === t
        ? 'border border-mise-700 border-b-mise-950 bg-mise-950 text-mise-300 -mb-px'
        : 'border border-transparent text-mise-500 hover:text-mise-300'
    }`

  return (
    // No close-on-backdrop-click: a stray click would throw away pasted text and read screenshots.
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex w-full max-w-xl flex-col gap-4 rounded border border-mise-700 bg-mise-950 p-5 shadow-2xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-mise-300">Import Recipe</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-mise-500 transition hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember">
            <X size={16} />
          </button>
        </div>

        <div className="flex gap-1 border-b border-mise-800">
          <button type="button" className={tabCls('url')} onClick={() => { setTab('url'); setError('') }}>
            From URL
          </button>
          <button type="button" className={tabCls('text')} onClick={() => { setTab('text'); setError('') }}>
            From Text
          </button>
          <button type="button" className={tabCls('markdown')} onClick={() => { setTab('markdown'); setError('') }}>
            From Markdown
          </button>
        </div>

        {tab === 'url' ? (
          <div className="flex flex-col gap-2">
            <p className="text-xs text-mise-500">
              Paste a recipe website URL. The page will be fetched and parsed automatically.
            </p>
            <input
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmit() }}
              placeholder="https://www.seriouseats.com/..."
              className="w-full rounded border border-mise-800 bg-mise-900 px-3 py-2.5 text-sm text-mise-300 placeholder:text-mise-600 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              autoFocus
            />
          </div>
        ) : tab === 'text' ? (
          <div className="flex flex-col gap-2">
            <div className="flex items-start justify-between gap-3">
              <p className="text-xs text-mise-500">
                Paste a screenshot (Ctrl+V), choose an image, or paste text you already copied.
                Broken lines, stray bullets and odd numbering are cleaned up for you, and you can review everything before saving.
              </p>
              <button
                type="button"
                onClick={() => imageRef.current?.click()}
                disabled={reading}
                className="inline-flex shrink-0 items-center gap-1.5 rounded border border-mise-800 px-2.5 py-1 text-xs text-mise-400 transition hover:border-mise-700 hover:text-mise-300 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              >
                <ImageUp size={11} />
                Choose image
              </button>
              <input ref={imageRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={handleImagePicked} />
            </div>
            {shots.length > 0 && (
              <div className="flex items-start gap-3 rounded border border-mise-800 bg-mise-900 p-2">
                <div className="flex shrink-0 flex-wrap gap-2">
                  {shots.map((shot, index) => (
                    <a key={shot} href={shot} target="_blank" rel="noreferrer" title="Open full size">
                      <img src={shot} alt={`Screenshot ${index + 1}`} className="max-h-24 max-w-40 rounded border border-mise-700 object-contain" />
                    </a>
                  ))}
                </div>
                <p className="text-xs text-mise-500">
                  The text below was read from {shots.length === 1 ? 'this image' : 'these images'}. Reading can
                  swap a number or letter, so check the amounts against it before importing.
                </p>
              </div>
            )}
            <textarea
              rows={12}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onPaste={handleTextPaste}
              readOnly={reading}
              placeholder={'INGREDIENTS\n. 2 cups flour\n. 1 egg, beaten\n\nDIRECTIONS\n. 1. Mix everything together.'}
              className="w-full rounded border border-mise-800 bg-mise-900 px-3 py-2.5 font-mono text-xs text-mise-300 placeholder:text-mise-600 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              autoFocus
            />
          </div>
        ) : (
          <div>
            <div className="mb-2 flex items-center justify-between">
              <label className="text-xs font-medium text-mise-500">Markdown content</label>
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="inline-flex items-center gap-1.5 rounded border border-mise-800 px-2.5 py-1 text-xs text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
              >
                <Upload size={11} />
                Load file
              </button>
              <input ref={fileRef} type="file" accept=".md,.markdown,text/markdown,text/plain" className="hidden" onChange={handleFile} />
            </div>
            <textarea
              rows={12}
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              placeholder={'# My Recipe\n\n## Ingredients\n- 2 cups flour\n- 1 egg\n\n## Instructions\n1. Mix everything together.'}
              className="w-full rounded border border-mise-800 bg-mise-900 px-3 py-2.5 font-mono text-xs text-mise-300 placeholder:text-mise-600 focus:border-mise-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-ember"
            />
          </div>
        )}

        {reading && <p className="text-xs text-mise-500">Reading image…</p>}

        {error && (
          <p className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-200">{error}</p>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-mise-800 px-3 py-2 text-sm text-mise-400 transition hover:border-mise-700 hover:text-mise-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={importing || reading || !{ url, text, markdown }[tab].trim()}
            className="rounded bg-ember px-4 py-2 text-sm font-semibold text-mise-950 transition hover:bg-ember-hover disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
          >
            {importing ? 'Importing…' : 'Import →'}
          </button>
        </div>
      </div>
    </div>
  )
}
