import { useCallback, useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import type { Attachment, Category, Plan, Point } from '@poi-app/shared'
import { getToken, listAttachments, type UserSummary } from '../api/client'
import { exportPlansToPdf } from '../utils/planExportPdf'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

const FALLBACK_COLOR = '#888888'
const FALLBACK_GLYPH = '!'
const DEFAULT_SCALE = 1.5
const MIN_SCALE = 0.75
const MAX_SCALE = 4.5
const SCALE_STEP = 0.375

interface PdfViewerProps {
  fileUrl: string
  points: Point[]
  categories: Category[]
  plan?: Plan
  users: UserSummary[]
  selectedPointId?: string
  onCanvasClick: (relX: number, relY: number) => void
  onPointClick: (point: Point) => void
}

export function PdfViewer({
  fileUrl,
  points,
  categories,
  plan,
  users,
  selectedPointId,
  onCanvasClick,
  onPointClick,
}: PdfViewerProps) {
  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const pdfDocRef = useRef<PDFDocumentProxy | null>(null)
  const renderTaskRef = useRef<RenderTask | null>(null)
  const renderDebounceRef = useRef<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const [scale, setScale] = useState(DEFAULT_SCALE)
  const [retryCount, setRetryCount] = useState(0)
  const [includeTicketPages, setIncludeTicketPages] = useState(false)
  const [exporting, setExporting] = useState(false)

  const renderAtScale = useCallback(async (targetScale: number) => {
    const pdf = pdfDocRef.current
    const canvas = canvasRef.current
    if (!pdf || !canvas) return

    renderTaskRef.current?.cancel()

    const page = await pdf.getPage(1)
    const viewport = page.getViewport({ scale: targetScale })
    const context = canvas.getContext('2d')
    if (!context) return

    canvas.width = viewport.width
    canvas.height = viewport.height

    const task = page.render({ canvasContext: context, viewport, canvas })
    renderTaskRef.current = task
    try {
      await task.promise
      setSize({ width: viewport.width, height: viewport.height })
    } catch (err) {
      if ((err as { name?: string })?.name !== 'RenderingCancelledException') throw err
    } finally {
      if (renderTaskRef.current === task) renderTaskRef.current = null
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    setScale(DEFAULT_SCALE)
    setError(null)

    async function load() {
      try {
        const token = getToken()
        const loadingTask = pdfjsLib.getDocument({
          url: fileUrl,
          httpHeaders: token ? { Authorization: `Bearer ${token}` } : undefined,
        })
        const pdf = await loadingTask.promise
        if (cancelled) return
        pdfDocRef.current = pdf
        await renderAtScale(DEFAULT_SCALE)
      } catch (err) {
        if (!cancelled) setError(String(err))
      }
    }

    load()
    return () => {
      cancelled = true
      pdfDocRef.current = null
    }
  }, [fileUrl, renderAtScale, retryCount])

  useEffect(() => {
    if (!pdfDocRef.current || scale === DEFAULT_SCALE) return
    // Entprellt: schnelle Strg+Mausrad-Ticks loesen sonst bei jedem einzelnen
    // Schritt ein volles pdf.js-Rerendering aus.
    if (renderDebounceRef.current) window.clearTimeout(renderDebounceRef.current)
    renderDebounceRef.current = window.setTimeout(() => {
      renderAtScale(scale)
    }, 120)
    return () => {
      if (renderDebounceRef.current) window.clearTimeout(renderDebounceRef.current)
    }
  }, [scale, renderAtScale])

  function zoomBy(delta: number) {
    setScale((s) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round((s + delta) * 1000) / 1000)))
  }

  // Strg+Mausrad zoomt (wie Google Maps/Figma); normales Rad scrollt weiterhin
  // die umgebende .plan-canvas-area, damit das Schwenken groesser, reingezoomter
  // Plaene per Mausrad nicht verloren geht.
  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    function handleWheel(e: WheelEvent) {
      if (!e.ctrlKey) return
      e.preventDefault()
      zoomBy(e.deltaY > 0 ? -SCALE_STEP / 3 : SCALE_STEP / 3)
    }
    el.addEventListener('wheel', handleWheel, { passive: false })
    return () => el.removeEventListener('wheel', handleWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function handleExport() {
    if (!plan) return
    setExporting(true)
    try {
      let attachmentsByPointId: Record<string, Attachment[]> | undefined
      if (includeTicketPages) {
        attachmentsByPointId = {}
        for (const point of points) {
          attachmentsByPointId[point.id] = await listAttachments(point.id)
        }
      }
      await exportPlansToPdf([{ plan, points, attachmentsByPointId }], { includeTicketPages, categories, users })
    } finally {
      setExporting(false)
    }
  }

  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement
    if (target.dataset.pinMarker) return
    const rect = e.currentTarget.getBoundingClientRect()
    const relX = (e.clientX - rect.left) / rect.width
    const relY = (e.clientY - rect.top) / rect.height
    onCanvasClick(relX, relY)
  }

  if (error) {
    return (
      <div>
        <p style={{ color: 'var(--color-danger)' }}>PDF konnte nicht geladen werden: {error}</p>
        <button type="button" className="icon-btn" onClick={() => setRetryCount((c) => c + 1)}>
          Erneut versuchen
        </button>
      </div>
    )
  }

  return (
    <>
    <div
      ref={cardRef}
      onClick={handleClick}
      className="card"
      style={{
        position: 'relative',
        display: 'inline-block',
        flexShrink: 0,
        width: size?.width,
        height: size?.height,
        cursor: 'crosshair',
        overflow: 'hidden',
        boxShadow: 'var(--shadow-sm)',
      }}
    >
      <canvas ref={canvasRef} style={{ display: 'block' }} />
      {points.map((point) => {
        const category = point.category_id ? categoryById.get(point.category_id) : undefined
        const color = category?.color ?? FALLBACK_COLOR
        const glyph = category?.glyph ?? FALLBACK_GLYPH
        const isSelected = point.id === selectedPointId
        return (
          <button
            key={point.id}
            data-pin-marker="true"
            onClick={(e) => {
              e.stopPropagation()
              onPointClick(point)
            }}
            title={`${point.ticket_number ? `${point.ticket_number} – ` : ''}${point.title}${category ? ` (${category.name})` : ''}`}
            style={{
              position: 'absolute',
              left: `${point.x * 100}%`,
              top: `${point.y * 100}%`,
              transform: isSelected ? 'translate(-50%, -100%) scale(1.25)' : 'translate(-50%, -100%)',
              transformOrigin: 'bottom center',
              background: color,
              color: '#fff',
              border: isSelected ? '2px solid #1a73e8' : '2px solid #fff',
              boxShadow: isSelected
                ? '0 0 0 3px rgba(26, 115, 232, 0.45), 0 1px 4px rgba(0,0,0,0.35)'
                : '0 1px 4px rgba(0,0,0,0.35)',
              borderRadius: '50% 50% 50% 0',
              width: 26,
              height: 26,
              padding: 0,
              cursor: 'pointer',
              lineHeight: '22px',
              fontSize: 12,
              fontWeight: 700,
              zIndex: isSelected ? 1 : 0,
              transition: 'transform 0.12s ease, box-shadow 0.12s ease',
            }}
          >
            {glyph}
          </button>
        )
      })}
    </div>
      <div
        className="pdf-zoom-toolbar"
        onClick={(e) => e.stopPropagation()}
        style={{
          position: 'absolute',
          top: 8,
          right: 8,
          zIndex: 1,
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          background: 'var(--color-surface)',
          border: '1px solid var(--color-border)',
          borderRadius: 'var(--radius-sm)',
          boxShadow: 'var(--shadow-sm)',
          padding: 4,
        }}
      >
        <button
          type="button"
          className="icon-btn"
          onClick={() => zoomBy(-SCALE_STEP)}
          disabled={scale <= MIN_SCALE}
          title="Verkleinern"
        >
          −
        </button>
        <span style={{ fontSize: 12, minWidth: 40, textAlign: 'center', color: 'var(--color-text-muted)' }}>
          {Math.round((scale / DEFAULT_SCALE) * 100)}%
        </span>
        <button
          type="button"
          className="icon-btn"
          onClick={() => zoomBy(SCALE_STEP)}
          disabled={scale >= MAX_SCALE}
          title="Vergrößern"
        >
          +
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => setScale(DEFAULT_SCALE)}
          disabled={scale === DEFAULT_SCALE}
          title="Zoom zurücksetzen"
        >
          ⟲
        </button>
        <span style={{ width: 1, alignSelf: 'stretch', background: 'var(--color-border)' }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 3, fontSize: 11, color: 'var(--color-text-muted)', cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={includeTicketPages}
            onChange={(e) => setIncludeTicketPages(e.target.checked)}
          />
          Tickets als Anhang
        </label>
        <button
          type="button"
          className="icon-btn"
          onClick={handleExport}
          disabled={exporting || !plan}
          title="Plan mit Pins als PDF exportieren"
        >
          {exporting ? '…' : '⬇'}
        </button>
      </div>
    </>
  )
}
