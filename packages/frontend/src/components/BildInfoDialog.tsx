import type { Category } from '@poi-app/shared'
import type { AttachmentWithPoint, UserSummary } from '../api/client'
import type { Bildangaben } from '../utils/bildangaben'
import { STATUS_LABELS } from '../constants'
import { Zeichen } from './Zeichen'

interface BildInfoDialogProps {
  anhang: AttachmentWithPoint
  angaben?: Bildangaben
  categories: Category[]
  users: UserSummary[]
  vorschauUrl?: string
  onOeffneTicket: () => void
  onClose: () => void
}

interface Zeile {
  bezeichnung: string
  wert: string
}

interface Abschnitt {
  titel: string
  zeilen: Zeile[]
}

function alsDatumZeit(iso: string | null | undefined): string | null {
  if (!iso) return null
  const datum = new Date(iso)
  if (Number.isNaN(datum.getTime())) return null
  return datum.toLocaleString('de-DE', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function alsGroesse(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 1,3 Megapixel bei 4032 × 3024 - hilft beim Einschätzen der Qualität. */
function alsAufloesung(breite: number | null, hoehe: number | null): string | null {
  if (!breite || !hoehe) return null
  const megapixel = (breite * hoehe) / 1_000_000
  return `${breite} × ${hoehe} (${megapixel.toFixed(1)} MP)`
}

const AUSRICHTUNGEN: Record<number, string> = {
  1: 'normal',
  3: 'um 180° gedreht',
  6: 'um 90° im Uhrzeigersinn gedreht',
  8: 'um 90° gegen den Uhrzeigersinn gedreht',
}

/**
 * Alle Angaben zu einem Foto - aus der Datei selbst und aus dem Ticket, an dem
 * es hängt.
 *
 * Die Reihenfolge ist nach Nützlichkeit auf der Baustelle sortiert: wann wurde
 * das aufgenommen, wozu gehört es, wo war das, und erst danach das Technische.
 * Zeilen ohne Wert entfallen ganz, statt "—" anzuzeigen.
 */
export function BildInfoDialog({
  anhang,
  angaben,
  categories,
  users,
  vorschauUrl,
  onOeffneTicket,
  onClose,
}: BildInfoDialogProps) {
  const kategorie = categories.find((c) => c.id === anhang.category_id)
  const zustaendig = users.find((u) => u.id === anhang.assigned_to)
  const hochgeladenVon = users.find((u) => u.id === anhang.uploaded_by)

  const aufnahme = alsDatumZeit(angaben?.aufnahmeZeitpunkt)
  const hochgeladen = alsDatumZeit(anhang.uploaded_at)

  const abschnitte: Abschnitt[] = [
    {
      titel: 'Aufnahme',
      zeilen: [
        // Das Aufnahmedatum steht oben: auf der Baustelle ist es die Angabe,
        // nach der am häufigsten gefragt wird.
        { bezeichnung: 'Aufgenommen am', wert: aufnahme ?? '' },
        {
          bezeichnung: aufnahme ? 'Hochgeladen am' : 'Hochgeladen am (kein Aufnahmedatum im Bild)',
          wert: hochgeladen ?? '',
        },
        { bezeichnung: 'Hochgeladen von', wert: hochgeladenVon?.display_name ?? '' },
      ],
    },
    {
      titel: 'Ticket',
      zeilen: [
        { bezeichnung: 'Ticket-Nr.', wert: anhang.ticket_number ?? '' },
        { bezeichnung: 'Titel', wert: anhang.point_title },
        { bezeichnung: 'Status', wert: STATUS_LABELS[anhang.point_status] ?? anhang.point_status },
        { bezeichnung: 'Kategorie', wert: kategorie?.name ?? '' },
        { bezeichnung: 'Gewerk', wert: anhang.gewerk ?? '' },
        { bezeichnung: 'Zuständig', wert: zustaendig?.display_name ?? '' },
        { bezeichnung: 'Zeichnung', wert: anhang.plan_name ?? '' },
      ],
    },
    {
      titel: 'Ort',
      zeilen: [
        {
          bezeichnung: 'Koordinaten',
          wert:
            angaben?.breitengrad != null && angaben?.laengengrad != null
              ? `${angaben.breitengrad.toFixed(5)}, ${angaben.laengengrad.toFixed(5)}`
              : '',
        },
      ],
    },
    {
      titel: 'Datei',
      zeilen: [
        { bezeichnung: 'Dateiname', wert: anhang.file_name },
        { bezeichnung: 'Auflösung', wert: alsAufloesung(angaben?.breite ?? null, angaben?.hoehe ?? null) ?? '' },
        { bezeichnung: 'Größe', wert: alsGroesse(anhang.size_bytes) },
        { bezeichnung: 'Format', wert: anhang.mime_type },
      ],
    },
    {
      titel: 'Technik',
      zeilen: [
        { bezeichnung: 'Kamera', wert: angaben?.kamera ?? '' },
        {
          bezeichnung: 'Ausrichtung',
          wert:
            angaben?.ausrichtung != null
              ? AUSRICHTUNGEN[angaben.ausrichtung] ?? `Kennung ${angaben.ausrichtung}`
              : '',
        },
      ],
    },
  ]

  const gefuellt = abschnitte
    .map((a) => ({ ...a, zeilen: a.zeilen.filter((z) => z.wert) }))
    .filter((a) => a.zeilen.length > 0)

  const koordinaten =
    angaben?.breitengrad != null && angaben?.laengengrad != null
      ? `${angaben.breitengrad},${angaben.laengengrad}`
      : null

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Angaben zum Foto</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Schließen">
            <Zeichen name="schliessen" />
          </button>
        </div>
        <div className="modal-body">
          {vorschauUrl && <img className="bildinfo-vorschau" src={vorschauUrl} alt={anhang.file_name} />}

          {angaben === undefined && (
            <p className="hinweis">Angaben werden gelesen…</p>
          )}

          {gefuellt.map((abschnitt) => (
            <div key={abschnitt.titel}>
              <div className="field-label">{abschnitt.titel}</div>
              <dl className="bildinfo-liste">
                {abschnitt.zeilen.map((zeile) => (
                  <div key={zeile.bezeichnung} className="bildinfo-zeile">
                    <dt>{zeile.bezeichnung}</dt>
                    <dd>{zeile.wert}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}

          <div className="bildinfo-aktionen">
            <button type="button" className="btn btn-primary btn-sm" onClick={onOeffneTicket}>
              Ticket öffnen
            </button>
            {koordinaten && (
              /* Kein eingebetteter Kartendienst: das waere ein Abruf an einen
                 Dritten mit den Koordinaten einer Baustelle. Der Link geht erst,
                 wenn jemand ihn bewusst anklickt. */
              <a
                className="btn btn-secondary btn-sm"
                href={`https://www.openstreetmap.org/?mlat=${angaben!.breitengrad}&mlon=${angaben!.laengengrad}#map=18/${angaben!.breitengrad}/${angaben!.laengengrad}`}
                target="_blank"
                rel="noreferrer noopener"
              >
                Aufnahmeort auf der Karte
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
