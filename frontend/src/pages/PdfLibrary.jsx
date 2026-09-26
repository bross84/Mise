import { useEffect, useRef, useState } from 'react'
import { Download, FileText, Trash2, Upload } from 'lucide-react'
import { deletePdfDocument, getPdfDocuments, uploadPdfDocument } from '../api/client.js'
import { resolveUploadUrl } from '../utils/uploads.js'

const MAX_PDF_UPLOAD_BYTES = 50 * 1024 * 1024

function formatFileSize(bytes) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.ceil(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export default function PdfLibrary() {
  const fileInputRef = useRef(null)
  const [documents, setDocuments] = useState([])
  const [loaded, setLoaded] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [previewId, setPreviewId] = useState(null)

  useEffect(() => {
    let active = true
    getPdfDocuments()
      .then((data) => {
        if (active) setDocuments(data)
      })
      .catch((err) => {
        if (active) setError(err instanceof Error ? err.message : 'Could not load the PDF library.')
      })
      .finally(() => {
        if (active) setLoaded(true)
      })
    return () => { active = false }
  }, [])

  const handleUpload = async (event) => {
    const file = event.target.files?.[0]
    if (!file) return
    if (file.size > MAX_PDF_UPLOAD_BYTES) {
      setError('PDF must be 50 MB or smaller.')
      event.target.value = ''
      return
    }

    setUploading(true)
    setError('')
    try {
      const document = await uploadPdfDocument(file)
      setDocuments((current) => [document, ...current])
      setPreviewId(document.id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload the PDF.')
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

  const handleDelete = async (document) => {
    setError('')
    try {
      await deletePdfDocument(document.id)
      setDocuments((current) => current.filter((item) => item.id !== document.id))
      setPreviewId((current) => current === document.id ? null : current)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not remove the PDF.')
    }
  }

  const preview = documents.find((document) => document.id === previewId)

  return (
    <section className="mx-auto w-full max-w-5xl">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-mise-800 pb-5">
        <div>
          <h1 className="font-display text-3xl font-semibold text-mise-300">PDF Library</h1>
          <p className="mt-1 text-sm text-mise-500">Keep recipe cards and cookbook pages here. Parsing recipes from them comes next.</p>
        </div>
        <input ref={fileInputRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={handleUpload} />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 rounded bg-ember px-3 py-2 text-sm font-semibold text-mise-950 transition hover:bg-ember-hover disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"
        >
          <Upload size={15} />
          {uploading ? 'Uploading…' : 'Upload PDF'}
        </button>
      </div>

      <p className="mt-3 text-xs text-mise-600">PDFs stay in Mise. Maximum 50 MB per file.</p>
      {error && <p className="mt-4 rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}

      {loaded && documents.length === 0 && !error && (
        <div className="mt-8 rounded border border-dashed border-mise-700 bg-mise-900/30 p-8 text-center">
          <FileText size={30} className="mx-auto text-mise-600" aria-hidden="true" />
          <p className="mt-3 text-sm text-mise-400">No PDFs in your library yet.</p>
        </div>
      )}

      {documents.length > 0 && (
        <ul className="mt-6 divide-y divide-mise-800 rounded border border-mise-800 bg-mise-900/20">
          {documents.map((document) => (
            <li key={document.id} className="flex flex-wrap items-center gap-2 px-4 py-3">
              <FileText size={18} className="shrink-0 text-mise-500" aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-mise-300" title={document.original_filename}>{document.original_filename}</span>
              <span className="text-xs text-mise-500">{formatFileSize(document.size_bytes)}</span>
              <button type="button" onClick={() => setPreviewId((current) => current === document.id ? null : document.id)} className="rounded px-2.5 py-1.5 text-xs text-mise-400 transition hover:bg-mise-800 hover:text-mise-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember">
                {previewId === document.id ? 'Hide' : 'View'}
              </button>
              <a href={resolveUploadUrl(document.url)} target="_blank" rel="noreferrer" className="rounded px-2.5 py-1.5 text-xs text-mise-400 transition hover:bg-mise-800 hover:text-mise-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember">Open</a>
              <a href={resolveUploadUrl(document.url)} download={document.original_filename} aria-label={`Download ${document.original_filename}`} className="rounded p-1.5 text-mise-500 transition hover:bg-mise-800 hover:text-mise-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ember"><Download size={15} /></a>
              <button type="button" onClick={() => handleDelete(document)} aria-label={`Delete ${document.original_filename}`} className="rounded p-1.5 text-mise-500 transition hover:bg-rose-500/10 hover:text-rose-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-400"><Trash2 size={15} /></button>
            </li>
          ))}
        </ul>
      )}

      {preview && (
        <iframe
          title={`PDF preview: ${preview.original_filename}`}
          src={resolveUploadUrl(preview.url)}
          className="mt-6 h-[720px] w-full rounded border border-mise-800 bg-white"
        />
      )}
    </section>
  )
}
