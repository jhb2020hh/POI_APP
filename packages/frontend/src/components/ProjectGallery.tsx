import { useEffect, useMemo, useRef, useState } from 'react'
import type { Category, Plan } from '@poi-app/shared'
import {
  attachmentFileUrl,
  getToken,
  listProjectAttachments,
  type AttachmentWithPoint,
  type UserSummary,
} from '../api/client'
import { leseBildangaben, type Bildangaben } from '../utils/bildangaben'
import { BildInfoDialog } from './BildInfoDialog'
import { Zeichen } from './Zeichen'

interface ProjectGalleryProps {
  projectId: string
  categories: Category[]
  plans: Plan[]
  users: UserSummary[]
  onSelectAttachment: (attachment: AttachmentWithPoint) => void
}

type Angabenkarte = Record<string, Bildangaben>

/**
 * Wonach sich sortieren lässt.
 *
 * Bewusst eine Tabelle und keine Kette von Fallunterscheidungen: ein weiterer
 * Parameter kostet damit eine Zeile. `lies` liefert eine Zahl oder eine
 * Zeichenkette; `null` heißt "für diesen Eintrag unbekannt" und landet
 * unabhängig von der Richtung am Ende.
 */
interface Sortierschluessel {
  wert: string
  beschriftung: string
  lies: (a: AttachmentWithPoint, angaben?: Bildangaben) => string | number | null
}

const SORTIERSCHLUESSEL: Sortierschluessel[] = [
  {
    wert: 'aufnahme',
    beschriftung: 'Aufnahmedatum',
    // Ohne Aufnahmedatum zählt ersatzweise der Hochladezeitpunkt - sonst
    // rutschten alle Bildschirmausschnitte und weitergeleiteten Bilder ans Ende.
    lies: (a, m) => m?.aufnahmeZeitpunkt ?? a.uploaded_at,
  },
  { wert: 'hochgeladen', beschriftung: 'Hochgeladen am', lies: (a) => a.uploaded_at },
  { wert: 'ticket', beschriftung: 'Ticket-Nr.', lies: (a) => a.ticket_number },
  { wert: 'titel', beschriftung: 'Tickettitel', lies: (a) => a.point_title },
  { wert: 'status', beschriftung: 'Status', lies: (a) => a.point_status },
  { wert: 'gewerk', beschriftung: 'Gewerk', lies: (a) => a.gewerk },
  { wert: 'zeichnung', beschriftung: 'Zeichnung', lies: (a) => a.plan_name },
  { wert: 'dateiname', beschriftung: 'Dateiname', lies: (a) => a.file_name },
  { wert: 'groesse', beschriftung: 'Dateigröße', lies: (a) => a.size_bytes },
  {
    wert: 'aufloesung',
    beschriftung: 'Auflösung',
    lies: (_a, m) => (m?.breite && m?.hoehe ? m.breite * m.hoehe : null),
  },
]

export function ProjectGallery({
  projectId,
  categories,
  plans,
  users,
  onSelectAttachment,
}: ProjectGalleryProps) {
  const [attachments, setAttachments] = useState<AttachmentWithPoint[]>([])
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const [angaben, setAngaben] = useState<Angabenkarte>({})
  const [filterCategoryId, setFilterCategoryId] = useState('')
  const [filterPlanId, setFilterPlanId] = useState('')
  const [sortSchluessel, setSortSchluessel] = useState('aufnahme')
  const [absteigend, setAbsteigend] = useState(true)
  const [infoFuer, setInfoFuer] = useState<AttachmentWithPoint | null>(null)

  // Die erzeugten Objekt-URLs muessen wieder freigegeben werden - sonst haelt
  // der Browser jedes geladene Bild bis zum Neuladen der Seite im Speicher.
  const urlsRef = useRef<string[]>([])

  useEffect(() => {
    listProjectAttachments(projectId).then(setAttachments)
  }, [projectId])

  useEffect(() => {
    let abgebrochen = false
    const token = getToken()

    attachments.forEach((a) => {
      if (previewUrls[a.id]) return
      fetch(attachmentFileUrl(a.id), {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
        .then((res) => res.blob())
        .then(async (blob) => {
          if (abgebrochen) return
          const url = URL.createObjectURL(blob)
          urlsRef.current.push(url)
          setPreviewUrls((prev) => ({ ...prev, [a.id]: url }))
          // Die Datei liegt hier ohnehin schon vor - die Angaben mitzulesen
          // kostet keinen zusaetzlichen Abruf.
          const gelesen = await leseBildangaben(blob)
          if (!abgebrochen) setAngaben((prev) => ({ ...prev, [a.id]: gelesen }))
        })
        .catch(() => {
          /* Ein fehlendes Bild darf die uebrige Galerie nicht aufhalten. */
        })
    })

    return () => {
      abgebrochen = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments])

  useEffect(() => {
    const urls = urlsRef
    return () => {
      urls.current.forEach((url) => URL.revokeObjectURL(url))
      urls.current = []
    }
  }, [])

  const sichtbar = useMemo(() => {
    const schluessel =
      SORTIERSCHLUESSEL.find((s) => s.wert === sortSchluessel) ?? SORTIERSCHLUESSEL[0]

    const gefiltert = attachments.filter(
      (a) =>
        (!filterCategoryId || a.category_id === filterCategoryId) &&
        (!filterPlanId || a.plan_id === filterPlanId)
    )

    const richtung = absteigend ? -1 : 1
    return [...gefiltert].sort((a, b) => {
      const links = schluessel.lies(a, angaben[a.id])
      const rechts = schluessel.lies(b, angaben[b.id])
      // Unbekanntes ans Ende, unabhaengig von der Richtung - sonst fuellt sich
      // beim Umschalten der Anfang mit lauter leeren Eintraegen.
      if (links == null && rechts == null) return 0
      if (links == null) return 1
      if (rechts == null) return -1
      if (typeof links === 'number' && typeof rechts === 'number') {
        return (links - rechts) * richtung
      }
      return String(links).localeCompare(String(rechts), 'de') * richtung
    })
  }, [attachments, angaben, filterCategoryId, filterPlanId, sortSchluessel, absteigend])

  const nochAmLesen = attachments.length - Object.keys(angaben).length

  return (
    <div className="galerie">
      <div className="toolbar">
        <span className="toolbar-title">Galerie ({sichtbar.length})</span>
        <select
          value={filterCategoryId}
          onChange={(e) => setFilterCategoryId(e.target.value)}
          aria-label="Nach Ticketart filtern"
        >
          <option value="">Ticketart: alle</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select
          value={filterPlanId}
          onChange={(e) => setFilterPlanId(e.target.value)}
          aria-label="Nach Zeichnung filtern"
        >
          <option value="">Zeichnung: alle</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>

        <select
          value={sortSchluessel}
          onChange={(e) => setSortSchluessel(e.target.value)}
          title="Sortieren nach"
          aria-label="Sortieren nach"
        >
          {SORTIERSCHLUESSEL.map((s) => (
            <option key={s.wert} value={s.wert}>
              Sortiert nach: {s.beschriftung}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={() => setAbsteigend((v) => !v)}
          title={
            absteigend
              ? 'Absteigend — umschalten auf aufsteigend'
              : 'Aufsteigend — umschalten auf absteigend'
          }
        >
          <Zeichen name={absteigend ? 'pfeil-runter' : 'pfeil-hoch'} groesse={14} />
          {absteigend ? 'absteigend' : 'aufsteigend'}
        </button>

        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setFilterCategoryId('')
            setFilterPlanId('')
          }}
        >
          Filter zurücksetzen
        </button>
      </div>

      {nochAmLesen > 0 && (
        <p className="hinweis galerie-hinweis">
          {nochAmLesen} {nochAmLesen === 1 ? 'Bild wird' : 'Bilder werden'} noch gelesen — die
          Sortierung nach Aufnahmedatum und Auflösung ordnet sich danach neu.
        </p>
      )}

      <div className="galerie-raster">
        {sichtbar.map((a) =>
          a.mime_type.startsWith('image/') ? (
            <figure
              key={a.id}
              className="galerie-kachel"
              /* Rechtsklick oeffnet die Angaben - und zusaetzlich der Knopf auf
                 der Kachel, weil es am Touchgeraet keinen Rechtsklick gibt. */
              onContextMenu={(e) => {
                e.preventDefault()
                setInfoFuer(a)
              }}
            >
              <button
                type="button"
                className="galerie-bildknopf"
                onClick={() => onSelectAttachment(a)}
                title={a.point_title}
              >
                <img src={previewUrls[a.id]} alt={a.file_name} />
              </button>
              <button
                type="button"
                className="galerie-infoknopf"
                onClick={() => setInfoFuer(a)}
                title="Angaben zum Foto"
                aria-label={`Angaben zu ${a.file_name}`}
              >
                i
              </button>
              <figcaption className="meta galerie-bildunterschrift">
                {a.ticket_number ?? a.point_title}
              </figcaption>
            </figure>
          ) : (
            <button
              key={a.id}
              type="button"
              onClick={() => setInfoFuer(a)}
              className="badge badge-neutral galerie-datei"
              title="Angaben zur Datei"
            >
              <Zeichen name="anhang" groesse={13} />
              {a.file_name}
            </button>
          )
        )}
        {sichtbar.length === 0 && attachments.length > 0 && (
          <span className="meta">Keine Fotos/Anlagen für diesen Filter</span>
        )}
        {attachments.length === 0 && (
          <span className="meta">Noch keine Fotos/Anlagen im Projekt</span>
        )}
      </div>

      {infoFuer && (
        <BildInfoDialog
          anhang={infoFuer}
          angaben={angaben[infoFuer.id]}
          categories={categories}
          users={users}
          vorschauUrl={previewUrls[infoFuer.id]}
          onOeffneTicket={() => {
            const ziel = infoFuer
            setInfoFuer(null)
            onSelectAttachment(ziel)
          }}
          onClose={() => setInfoFuer(null)}
        />
      )}
    </div>
  )
}
