import { PDFDocument, PDFFont, PDFImage, PDFPage } from 'pdf-lib'
import type { Attachment } from '@poi-app/shared'
import { attachmentFileUrl, getToken } from '../api/client'

export const THUMB_W = 150
export const THUMB_H = 112
export const THUMB_GAP = 15
export const THUMBS_PER_ROW = 3

export function authHeaders(): Record<string, string> | undefined {
  const token = getToken()
  return token ? { Authorization: `Bearer ${token}` } : undefined
}

// Standard-PDF-Fonts (Helvetica) unterstuetzen nur WinAnsi - Emoji/Sonderzeichen aus
// Ticket-Titeln, Beschreibungen oder kuratierten Symbolen wuerden sonst einen harten
// Fehler beim Speichern der PDF ausloesen. Zeichenweise auf Codierbarkeit pruefen und
// nicht darstellbare Zeichen durch "?" ersetzen, statt den gesamten Export abzubrechen.
export function sanitizeForFont(font: PDFFont, text: string): string {
  let result = ''
  for (const ch of text) {
    try {
      font.widthOfTextAtSize(ch, 10)
      result += ch
    } catch {
      result += '?'
    }
  }
  return result
}

export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const attempt = current ? `${current} ${word}` : word
    if (current && font.widthOfTextAtSize(attempt, size) > maxWidth) {
      lines.push(current)
      current = word
    } else {
      current = attempt
    }
  }
  if (current) lines.push(current)
  return lines
}

// Anhang-Bild fuers PDF vorbereiten: unabhaengig vom Original-Format (JPEG/PNG/WEBP/...)
// ueber Canvas nach PNG umwandeln, damit pdf-lib es einheitlich per embedPng einbetten kann.
export async function loadAttachmentAsPng(attachment: Attachment): Promise<{ bytes: Uint8Array } | null> {
  try {
    const res = await fetch(attachmentFileUrl(attachment.id), { headers: authHeaders() })
    if (!res.ok) return null
    const blob = await res.blob()
    if (!blob.type.startsWith('image/')) return null
    const bitmap = await createImageBitmap(blob)
    const canvas = document.createElement('canvas')
    canvas.width = bitmap.width
    canvas.height = bitmap.height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(bitmap, 0, 0)
    const pngBlob: Blob = await new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas-Export fehlgeschlagen'))), 'image/png')
    })
    return { bytes: new Uint8Array(await pngBlob.arrayBuffer()) }
  } catch {
    return null
  }
}

export function drawImageFit(page: PDFPage, image: PDFImage, x: number, y: number, boxW: number, boxH: number): void {
  const scale = Math.min(boxW / image.width, boxH / image.height)
  const w = image.width * scale
  const h = image.height * scale
  page.drawImage(image, { x: x + (boxW - w) / 2, y: y + (boxH - h) / 2, width: w, height: h })
}

export function downloadPdfBytes(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export interface PhotoGridPageLayout {
  pageWidth: number
  pageHeight: number
  margin: number
}

// Zeichnet ein Vorschaubild-Raster fuer die Foto-Anhaenge eines Tickets, mit
// automatischem Seitenumbruch bei Platzmangel. Gibt die (ggf. neue) aktuelle
// Seite + den fortgeschriebenen Y-Cursor zurueck, damit der Aufrufer danach
// weiterzeichnen kann - plus alle waehrend des Aufrufs beruehrten Seiten
// (inkl. der Startseite), falls der Aufrufer jede Seite noch eigenstaendig
// dekorieren muss (z.B. Fusszeile).
export async function drawAttachmentPhotoGrid(
  pdfDoc: PDFDocument,
  initialPage: PDFPage,
  initialCursorY: number,
  attachments: Attachment[],
  boldFont: PDFFont,
  continuationTitle: string,
  layout: PhotoGridPageLayout
): Promise<{ page: PDFPage; cursorY: number; pages: PDFPage[] }> {
  const photoAttachments = attachments.filter((a) => a.mime_type.startsWith('image/'))
  if (photoAttachments.length === 0) return { page: initialPage, cursorY: initialCursorY, pages: [] }

  const { pageWidth, pageHeight, margin } = layout
  let currentPage = initialPage
  let cursorY = initialCursorY - 14
  const pages: PDFPage[] = [initialPage]
  currentPage.drawText('Fotos:', { x: margin, y: cursorY, size: 11, font: boldFont })
  cursorY -= THUMB_H + THUMB_GAP

  let col = 0
  for (const attachment of photoAttachments) {
    if (cursorY < margin) {
      currentPage = pdfDoc.addPage([pageWidth, pageHeight])
      pages.push(currentPage)
      cursorY = pageHeight - margin
      currentPage.drawText(continuationTitle, { x: margin, y: cursorY, size: 12, font: boldFont })
      cursorY -= 20 + THUMB_H
      col = 0
    }
    const loaded = await loadAttachmentAsPng(attachment)
    if (loaded) {
      const embedded = await pdfDoc.embedPng(loaded.bytes)
      const x = margin + col * (THUMB_W + THUMB_GAP)
      drawImageFit(currentPage, embedded, x, cursorY, THUMB_W, THUMB_H)
    }
    col++
    if (col >= THUMBS_PER_ROW) {
      col = 0
      cursorY -= THUMB_H + THUMB_GAP
    }
  }
  return { page: currentPage, cursorY, pages }
}
