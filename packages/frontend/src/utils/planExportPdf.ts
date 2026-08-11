import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import * as pdfjsLib from 'pdfjs-dist'
import type { Attachment, Category, Plan, Point } from '@poi-app/shared'
import { planFileUrl, type UserSummary } from '../api/client'
import { STATUS_LABELS } from '../constants'
import { authHeaders, downloadPdfBytes, drawAttachmentPhotoGrid, sanitizeForFont, wrapText } from './pdfImageEmbed'

const FALLBACK_COLOR_HEX = '#888888'
const FALLBACK_GLYPH = '!'
const EXPORT_SCALE = 1.5
const PIN_RADIUS = 13
const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842
const MARGIN = 50

function hexToRgb01(hex: string): { r: number; g: number; b: number } {
  const clean = hex.replace('#', '')
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean
  const bigint = parseInt(full, 16) || 0
  return { r: ((bigint >> 16) & 255) / 255, g: ((bigint >> 8) & 255) / 255, b: (bigint & 255) / 255 }
}

async function renderPlanToPngBytes(planId: string): Promise<{ bytes: Uint8Array; width: number; height: number }> {
  const loadingTask = pdfjsLib.getDocument({
    url: planFileUrl(planId),
    httpHeaders: authHeaders(),
  })
  const pdf = await loadingTask.promise
  const page = await pdf.getPage(1)
  const viewport = page.getViewport({ scale: EXPORT_SCALE })
  const canvas = document.createElement('canvas')
  canvas.width = viewport.width
  canvas.height = viewport.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas-Kontext nicht verfügbar')
  await page.render({ canvasContext: context, viewport, canvas }).promise
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas-Export fehlgeschlagen'))), 'image/png')
  })
  const bytes = new Uint8Array(await blob.arrayBuffer())
  return { bytes, width: canvas.width, height: canvas.height }
}

// pdf.js meldet bei einer fehlerhaften Server-Antwort nur den HTTP-Status, nicht den
// vom Backend mitgelieferten JSON-Fehlertext. Fuer eine praezise Fehlermeldung an den
// Nutzer holen wir die Datei hier separat per einfachem fetch() und lesen den Grund aus.
async function fetchPlanFileErrorReason(planId: string): Promise<string> {
  try {
    const res = await fetch(planFileUrl(planId), { headers: authHeaders() })
    if (res.ok) return 'Unbekannter Fehler beim Laden der PDF-Datei'
    const body = await res.json().catch(() => null)
    if (body && typeof body.error === 'string') return body.error
    return `Serverfehler (${res.status})`
  } catch (err) {
    return `Netzwerkfehler: ${err}`
  }
}

export interface PlanExportEntry {
  plan: Plan
  points: Point[]
  attachmentsByPointId?: Record<string, Attachment[]>
}

export interface PlanPdfExportOptions {
  includeTicketPages: boolean
  categories: Category[]
  users: UserSummary[]
}

// Gibt bei vollstaendigem Erfolg einen leeren String zurueck, sonst eine
// Zusammenfassung der uebersprungenen Plaene samt Grund. Wirft nur, wenn KEIN
// einziger Plan exportiert werden konnte.
export async function exportPlansToPdf(entries: PlanExportEntry[], options: PlanPdfExportOptions): Promise<string> {
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)
  const categoryById = new Map(options.categories.map((c) => [c.id, c]))
  const userById = new Map(options.users.map((u) => [u.id, u]))

  const failures: { planName: string; reason: string }[] = []
  const succeededPlanNames: string[] = []

  for (const entry of entries) {
    let rendered: { bytes: Uint8Array; width: number; height: number }
    try {
      rendered = await renderPlanToPngBytes(entry.plan.id)
    } catch {
      const reason = await fetchPlanFileErrorReason(entry.plan.id)
      failures.push({ planName: entry.plan.name, reason })
      continue
    }

    const { bytes, width, height } = rendered
    const image = await pdfDoc.embedPng(bytes)
    const planPage = pdfDoc.addPage([width, height])
    planPage.drawImage(image, { x: 0, y: 0, width, height })

    const pins: { point: Point; px: number; centerY: number }[] = []
    for (const point of entry.points) {
      const category = point.category_id ? categoryById.get(point.category_id) : undefined
      const { r, g, b } = hexToRgb01(category?.color ?? FALLBACK_COLOR_HEX)
      const glyph = sanitizeForFont(boldFont, category?.glyph ?? FALLBACK_GLYPH)
      const px = point.x * width
      const centerY = height - point.y * height + PIN_RADIUS

      planPage.drawCircle({
        x: px,
        y: centerY,
        size: PIN_RADIUS,
        color: rgb(r, g, b),
        borderColor: rgb(1, 1, 1),
        borderWidth: 2,
      })
      const glyphSize = 13
      const glyphWidth = boldFont.widthOfTextAtSize(glyph, glyphSize)
      planPage.drawText(glyph, {
        x: px - glyphWidth / 2,
        y: centerY - glyphSize / 2 + 1,
        size: glyphSize,
        font: boldFont,
        color: rgb(1, 1, 1),
      })
      pins.push({ point, px, centerY })
    }

    if (options.includeTicketPages) {
      for (const { point, px, centerY } of pins) {
        const ticketPage = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
        let currentPage = ticketPage
        let cursorY = PAGE_HEIGHT - MARGIN

        currentPage.drawText(sanitizeForFont(boldFont, point.title), {
          x: MARGIN,
          y: cursorY,
          size: 16,
          font: boldFont,
        })
        cursorY -= 28

        const category = point.category_id ? categoryById.get(point.category_id) : undefined
        const fields: [string, string][] = [
          ['Ticket-Nr.', point.ticket_number ?? 'wird vergeben'],
          ['Status', STATUS_LABELS[point.status] ?? point.status],
          ['Kategorie', category?.name ?? '-'],
          ['Priorität', point.priority ?? '-'],
          ['Zuständig', point.assigned_to ? userById.get(point.assigned_to)?.display_name ?? '-' : '-'],
          ['Fällig am', point.due_date ?? '-'],
          ['Gewerk', point.gewerk ?? '-'],
          ['Raum/Bereich', point.raum_bereich ?? '-'],
        ]
        for (const [label, value] of fields) {
          currentPage.drawText(sanitizeForFont(font, `${label}: ${value}`), {
            x: MARGIN,
            y: cursorY,
            size: 11,
            font,
          })
          cursorY -= 16
        }

        cursorY -= 10
        currentPage.drawText('Beschreibung:', { x: MARGIN, y: cursorY, size: 11, font: boldFont })
        cursorY -= 16
        const description = sanitizeForFont(font, point.description ?? '-')
        for (const line of wrapText(description, font, 11, PAGE_WIDTH - MARGIN * 2)) {
          currentPage.drawText(line, { x: MARGIN, y: cursorY, size: 11, font })
          cursorY -= 14
        }

        const photoResult = await drawAttachmentPhotoGrid(
          pdfDoc,
          currentPage,
          cursorY,
          entry.attachmentsByPointId?.[point.id] ?? [],
          boldFont,
          `Fotos zu: ${sanitizeForFont(boldFont, point.title)} (Fortsetzung)`,
          { pageWidth: PAGE_WIDTH, pageHeight: PAGE_HEIGHT, margin: MARGIN }
        )
        currentPage = photoResult.page
        cursorY = photoResult.cursorY

        const linkDict = pdfDoc.context.obj({
          Type: 'Annot',
          Subtype: 'Link',
          Rect: [px - PIN_RADIUS, centerY - PIN_RADIUS, px + PIN_RADIUS, centerY + PIN_RADIUS],
          Border: [0, 0, 0],
          A: {
            Type: 'Action',
            S: 'GoTo',
            D: [ticketPage.ref, 'XYZ', null, PAGE_HEIGHT, null],
          },
        })
        const linkRef = pdfDoc.context.register(linkDict)
        planPage.node.addAnnot(linkRef)
      }
    }

    succeededPlanNames.push(entry.plan.name)
  }

  if (succeededPlanNames.length === 0) {
    const details = failures.map((f) => `${f.planName}: ${f.reason}`).join('; ')
    throw new Error(`Kein Plan konnte exportiert werden. ${details}`)
  }

  const bytes = await pdfDoc.save()
  const filename =
    succeededPlanNames.length === 1
      ? `${succeededPlanNames[0]}-export.pdf`
      : `Plaene-Export-${succeededPlanNames.length}.pdf`
  downloadPdfBytes(bytes, filename)

  if (failures.length === 0) return ''
  return `PDF mit ${succeededPlanNames.length} von ${entries.length} Plänen erstellt. Übersprungen: ${failures
    .map((f) => `${f.planName} (${f.reason})`)
    .join('; ')}`
}
