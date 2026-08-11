import { PDFDocument, PDFFont, PDFPage, StandardFonts, rgb } from 'pdf-lib'
import type { Attachment } from '@poi-app/shared'
import type { CompanyLetterhead, PointWithPlan } from '../api/client'
import { downloadPdfBytes, drawAttachmentPhotoGrid, sanitizeForFont, wrapText } from './pdfImageEmbed'

const PAGE_WIDTH = 595
const PAGE_HEIGHT = 842
const MARGIN = 56
const FOOTER_Y = 34
// Untere Grenze fuer Foto-Vorschaubilder - etwas oberhalb der Fusszeile, damit
// nichts mit ihr ueberlappt.
const PHOTO_BOTTOM_MARGIN = FOOTER_Y + 36

function drawFooter(page: PDFPage, font: PDFFont, letterhead: CompanyLetterhead): void {
  const line = sanitizeForFont(
    font,
    [
      letterhead.firma_name,
      letterhead.adresse_zeile1,
      letterhead.plz_ort,
      letterhead.telefon && `Tel. ${letterhead.telefon}`,
      letterhead.email,
      letterhead.geschaeftsfuehrer && `Geschäftsführer: ${letterhead.geschaeftsfuehrer}`,
      letterhead.handelsregister,
      letterhead.ust_idnr,
    ]
      .filter(Boolean)
      .join(' · ')
  )
  page.drawLine({
    start: { x: MARGIN, y: FOOTER_Y + 14 },
    end: { x: PAGE_WIDTH - MARGIN, y: FOOTER_Y + 14 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  })
  const footerLines = wrapText(line, font, 7, PAGE_WIDTH - MARGIN * 2).slice(0, 2)
  footerLines.forEach((chunk, i) => {
    page.drawText(chunk, { x: MARGIN, y: FOOTER_Y - i * 9, size: 7, font, color: rgb(0.45, 0.45, 0.45) })
  })
}

function drawCheckbox(page: PDFPage, x: number, y: number): void {
  page.drawRectangle({
    x,
    y,
    width: 9,
    height: 9,
    borderColor: rgb(0.2, 0.2, 0.2),
    borderWidth: 1,
  })
}

interface CheckboxLine {
  text: string
}

function drawCheckboxSection(
  page: PDFPage,
  font: PDFFont,
  boldFont: PDFFont,
  title: string,
  lines: CheckboxLine[],
  startY: number
): number {
  let y = startY
  page.drawText(title, { x: MARGIN, y, size: 11, font: boldFont })
  y -= 18
  const textMaxWidth = PAGE_WIDTH - MARGIN * 2 - 20
  for (const line of lines) {
    const wrapped = wrapText(sanitizeForFont(font, line.text), font, 10, textMaxWidth)
    drawCheckbox(page, MARGIN, y - 8)
    wrapped.forEach((textLine, i) => {
      page.drawText(textLine, { x: MARGIN + 16, y: y - i * 13, size: 10, font })
    })
    y -= Math.max(16, wrapped.length * 13 + 4)
  }
  y -= 6
  page.drawText('Kommentar:', { x: MARGIN, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) })
  page.drawLine({
    start: { x: MARGIN + 60, y: y - 2 },
    end: { x: PAGE_WIDTH - MARGIN, y: y - 2 },
    thickness: 0.5,
    color: rgb(0.7, 0.7, 0.7),
  })
  y -= 24
  return y
}

export interface AbnahmeprotokollOptions {
  projectName: string
  baubeginn: string | null
  fertigstellung: string | null
  ort: string
  datum: string
  letterhead: CompanyLetterhead
  points: PointWithPlan[]
  attachmentsByPointId?: Record<string, Attachment[]>
}

export async function exportAbnahmeprotokoll(options: AbnahmeprotokollOptions): Promise<void> {
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  // --- Kopfseite ---
  const cover = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  let y = PAGE_HEIGHT - MARGIN
  cover.drawText('Abnahmeprotokoll', { x: MARGIN, y, size: 22, font: boldFont })
  y -= 40

  cover.drawText(`Baumaßnahme: ${sanitizeForFont(font, options.projectName)}`, { x: MARGIN, y, size: 11, font })
  y -= 16
  cover.drawText(`Baubeginn: ${options.baubeginn ?? '-'}`, { x: MARGIN, y, size: 11, font })
  y -= 16
  cover.drawText(`Fertigstellung: ${options.fertigstellung ?? '-'}`, { x: MARGIN, y, size: 11, font })
  y -= 32

  cover.drawText('Mängelfeststellung / Restleistungen:', { x: MARGIN, y, size: 12, font: boldFont })
  y -= 18
  cover.drawText('Mängel gemäß Anlage Nr. 1', { x: MARGIN, y, size: 10, font })
  y -= 14
  cover.drawText('Restleistungen gemäß Anlage Nr. 1', { x: MARGIN, y, size: 10, font })
  y -= 32

  cover.drawText('Fristen:', { x: MARGIN, y, size: 12, font: boldFont })
  y -= 18
  for (const line of wrapText(
    'Die Mängel sind unverzüglich, spätestens bis zu den unten angeführten Fristen zu beseitigen.',
    font,
    10,
    PAGE_WIDTH - MARGIN * 2
  )) {
    cover.drawText(line, { x: MARGIN, y, size: 10, font })
    y -= 14
  }
  y -= 32

  cover.drawText('Unterlagen:', { x: MARGIN, y, size: 12, font: boldFont })
  y -= 18
  cover.drawText('Es wurden die in Anlage Nr. 1 aufgeführten Unterlagen übergeben.', { x: MARGIN, y, size: 10, font })
  y -= 48

  cover.drawText(`${sanitizeForFont(font, options.ort)}, den ${options.datum}`, { x: MARGIN, y, size: 10, font })
  y -= 60

  cover.drawText('für den Bauherrn:', { x: MARGIN, y, size: 10, font })
  cover.drawText('für den Auftragnehmer:', { x: PAGE_WIDTH / 2 + 10, y, size: 10, font })
  y -= 40
  cover.drawLine({ start: { x: MARGIN, y }, end: { x: MARGIN + 180, y }, thickness: 0.7, color: rgb(0, 0, 0) })
  cover.drawLine({
    start: { x: PAGE_WIDTH / 2 + 10, y },
    end: { x: PAGE_WIDTH / 2 + 190, y },
    thickness: 0.7,
    color: rgb(0, 0, 0),
  })
  y -= 12
  cover.drawText('(Unterschrift)', { x: MARGIN, y, size: 8, font, color: rgb(0.4, 0.4, 0.4) })
  cover.drawText('(Unterschrift)', { x: PAGE_WIDTH / 2 + 10, y, size: 8, font, color: rgb(0.4, 0.4, 0.4) })

  drawFooter(cover, font, options.letterhead)

  // --- Anlage-Deckblatt ---
  const annexCover = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
  annexCover.drawText('Anlage Nr. 1', { x: MARGIN, y: PAGE_HEIGHT / 2 + 20, size: 20, font: boldFont })
  annexCover.drawText(`(zum Abnahmeprotokoll vom ${options.datum})`, {
    x: MARGIN,
    y: PAGE_HEIGHT / 2 - 4,
    size: 11,
    font,
  })
  drawFooter(annexCover, font, options.letterhead)

  // --- Pro Ticket ein Abschnitt ---
  for (const point of options.points) {
    const page = pdfDoc.addPage([PAGE_WIDTH, PAGE_HEIGHT])
    let cursor = PAGE_HEIGHT - MARGIN

    page.drawText(sanitizeForFont(boldFont, point.title), { x: MARGIN, y: cursor, size: 14, font: boldFont })
    cursor -= 18
    page.drawText(sanitizeForFont(font, point.ticket_number ?? 'wird vergeben'), {
      x: MARGIN,
      y: cursor,
      size: 9,
      font,
      color: rgb(0.4, 0.4, 0.4),
    })
    cursor -= 22

    cursor = drawCheckboxSection(
      page,
      font,
      boldFont,
      'Vorbehalte des Bauherrn:',
      [
        { text: 'Der Bauherr behält sich die Geltendmachung der Vertragsstrafe vor.' },
        {
          text: 'Der Bauherr behält sich vor, alle Rechte wegen beanstandeter Mängel, Restleistungen und Vorbehalte geltend zu machen.',
        },
      ],
      cursor
    )

    cursor = drawCheckboxSection(
      page,
      font,
      boldFont,
      'Erklärung des Bauherrn:',
      [
        { text: 'Der Bauherr erklärt die Leistung als abgenommen.' },
        { text: 'Die Leistung wird vom Bauherrn aufgrund wesentlicher Mängel nicht abgenommen.' },
        { text: 'Diese Abnahme ersetzt nicht notwendige behördliche und bauaufsichtliche Abnahmen.' },
      ],
      cursor
    )

    cursor = drawCheckboxSection(
      page,
      font,
      boldFont,
      'Einsprüche des Auftragnehmers:',
      [{ text: 'Für die in diesem Ticket aufgeführten Sachverhalte konnte bei der Abnahme keine Einigung erzielt werden.' }],
      cursor
    )

    const photoResult = await drawAttachmentPhotoGrid(
      pdfDoc,
      page,
      cursor,
      options.attachmentsByPointId?.[point.id] ?? [],
      boldFont,
      `Fotos zu: ${sanitizeForFont(boldFont, point.title)} (Fortsetzung)`,
      { pageWidth: PAGE_WIDTH, pageHeight: PAGE_HEIGHT, margin: PHOTO_BOTTOM_MARGIN }
    )
    for (const p of photoResult.pages.length > 0 ? photoResult.pages : [page]) {
      drawFooter(p, font, options.letterhead)
    }
  }

  const bytes = await pdfDoc.save()
  downloadPdfBytes(bytes, `Abnahmeprotokoll-${options.projectName}.pdf`)
}
