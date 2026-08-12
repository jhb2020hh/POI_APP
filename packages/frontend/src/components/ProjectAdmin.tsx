import { useEffect, useState } from 'react'
import type { Project } from '@poi-app/shared'
import {
  archiveProject,
  deleteProject,
  listArchivedProjects,
  unarchiveProject,
} from '../api/client'

interface ProjectAdminProps {
  projects: Project[]
  onChanged: () => void
}

/**
 * Projekte aufräumen: archivieren, zurückholen, endgültig löschen.
 *
 * Zwei getrennte Vorgänge, bewusst nicht in einem Knopf zusammengefasst.
 * Archivieren ist umkehrbar und darf schnell gehen; endgültiges Löschen ist es
 * nicht und geht nur aus dem Archiv heraus. Dazwischen liegt so viel Zeit, wie
 * jemand braucht — das ist der eigentliche Schutz, nicht die Rückfrage.
 */
export function ProjectAdmin({ projects, onChanged }: ProjectAdminProps) {
  const [archiv, setArchiv] = useState<Project[]>([])
  const [ansicht, setAnsicht] = useState<'aktiv' | 'archiv'>('aktiv')
  const [auswahl, setAuswahl] = useState<string[]>([])
  const [status, setStatus] = useState('')
  const [loeschKandidat, setLoeschKandidat] = useState<Project | null>(null)
  const [loeschBestaetigung, setLoeschBestaetigung] = useState('')

  function ladeArchiv() {
    listArchivedProjects().then(setArchiv).catch(() => setArchiv([]))
  }

  useEffect(ladeArchiv, [projects])

  const liste = ansicht === 'aktiv' ? projects : archiv
  const gewaehlt = liste.filter((p) => auswahl.includes(p.id))

  function umschalten(id: string) {
    setAuswahl((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function wechsleAnsicht(neu: 'aktiv' | 'archiv') {
    setAnsicht(neu)
    // Auswahl nicht mitnehmen: sie bezöge sich sonst auf Einträge, die in der
    // anderen Liste gar nicht stehen.
    setAuswahl([])
    setStatus('')
  }

  async function archiviereGewaehlte() {
    const namen = gewaehlt.map((p) => p.name).join(', ')
    if (
      !confirm(
        `${gewaehlt.length === 1 ? 'Dieses Projekt' : `Diese ${gewaehlt.length} Projekte`} archivieren?\n\n` +
          `${namen}\n\n` +
          'Archivierte Projekte bleiben vollständig erhalten und einsehbar, lassen sich aber ' +
          'nicht mehr bearbeiten: keine neuen Tickets, keine Änderungen, keine neuen Zeichnungen. ' +
          'Zurückholen ist jederzeit möglich.'
      )
    ) {
      return
    }
    setStatus('Archiviert…')
    try {
      for (const projekt of gewaehlt) await archiveProject(projekt.id)
      setAuswahl([])
      setStatus('')
      onChanged()
      ladeArchiv()
    } catch (err) {
      setStatus(`Fehler: ${err instanceof Error ? err.message : err}`)
    }
  }

  async function holeZurueck(projekt: Project) {
    setStatus('Holt zurück…')
    try {
      await unarchiveProject(projekt.id)
      setAuswahl([])
      setStatus('')
      onChanged()
      ladeArchiv()
    } catch (err) {
      setStatus(`Fehler: ${err instanceof Error ? err.message : err}`)
    }
  }

  async function loescheEndgueltig() {
    if (!loeschKandidat) return
    setStatus('Löscht…')
    try {
      await deleteProject(loeschKandidat.id)
      setLoeschKandidat(null)
      setLoeschBestaetigung('')
      setAuswahl([])
      setStatus('')
      onChanged()
      ladeArchiv()
    } catch (err) {
      setStatus(`Fehler: ${err instanceof Error ? err.message : err}`)
    }
  }

  return (
    <div>
      <div className="tabs" style={{ marginBottom: 12 }}>
        <button
          type="button"
          className={`tab ${ansicht === 'aktiv' ? 'active' : ''}`}
          onClick={() => wechsleAnsicht('aktiv')}
        >
          Aktive Projekte ({projects.length})
        </button>
        <button
          type="button"
          className={`tab ${ansicht === 'archiv' ? 'active' : ''}`}
          onClick={() => wechsleAnsicht('archiv')}
        >
          Archiv ({archiv.length})
        </button>
      </div>

      {ansicht === 'aktiv' ? (
        <p className="hinweis" style={{ marginBottom: 10 }}>
          Archivierte Projekte bleiben vollständig erhalten und einsehbar, lassen sich aber nicht
          mehr bearbeiten. Zurückholen ist jederzeit möglich.
        </p>
      ) : (
        <p className="hinweis" style={{ marginBottom: 10 }}>
          Endgültig gelöscht werden können Projekte nur von hier aus — mit allen Tickets,
          Zeichnungen und Fotos. Das lässt sich nicht rückgängig machen.
        </p>
      )}

      {status && (
        <p className={`hinweis ${status.startsWith('Fehler') ? 'hinweis-fehler' : ''}`}>{status}</p>
      )}

      {liste.length === 0 ? (
        <p className="hinweis">
          {ansicht === 'aktiv' ? 'Keine aktiven Projekte.' : 'Das Archiv ist leer.'}
        </p>
      ) : (
        <ul className="mitglieder-liste">
          {liste.map((projekt) => (
            <li key={projekt.id} className="mitglieder-zeile">
              <label className="knopfgruppe" style={{ cursor: 'pointer', flex: 1, minWidth: 0 }}>
                <input
                  type="checkbox"
                  checked={auswahl.includes(projekt.id)}
                  onChange={() => umschalten(projekt.id)}
                />
                <span style={{ minWidth: 0 }}>
                  <strong>{projekt.name}</strong>
                  <div className="meta">
                    {projekt.project_number ?? 'ohne Projektnummer'}
                    {projekt.customer ? ` · ${projekt.customer}` : ''}
                  </div>
                </span>
              </label>
              {ansicht === 'archiv' && (
                <div className="knopfgruppe">
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => holeZurueck(projekt)}
                  >
                    Zurückholen
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-ghost-gefahr btn-sm"
                    onClick={() => {
                      setLoeschKandidat(projekt)
                      setLoeschBestaetigung('')
                    }}
                  >
                    Endgültig löschen
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {ansicht === 'aktiv' && (
        <div className="knopfgruppe" style={{ marginTop: 12 }}>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={archiviereGewaehlte}
            disabled={gewaehlt.length === 0}
          >
            {gewaehlt.length === 0
              ? 'Archivieren'
              : `${gewaehlt.length} ${gewaehlt.length === 1 ? 'Projekt' : 'Projekte'} archivieren`}
          </button>
          {gewaehlt.length === 0 && (
            <span className="hinweis">Zuerst links ankreuzen, was archiviert werden soll.</span>
          )}
        </div>
      )}

      {/* Ein confirm() reicht hier nicht: es wird weggeklickt, ohne gelesen zu
          werden. Wer den Projektnamen abtippt, hat ihn zwangsläufig gelesen. */}
      {loeschKandidat && (
        <div className="modal-overlay" onClick={() => setLoeschKandidat(null)}>
          <div className="modal modal-schmal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Endgültig löschen</h3>
              <button
                type="button"
                className="icon-btn"
                onClick={() => setLoeschKandidat(null)}
                aria-label="Abbrechen"
              >
                ✕
              </button>
            </div>
            <div className="modal-body">
              <p className="hinweis hinweis-fehler">
                <strong>{loeschKandidat.name}</strong> wird mit allen Tickets, Zeichnungen,
                Kommentaren und Fotos gelöscht. Auch die Dateien in der Ablage werden entfernt.
                Das lässt sich nicht rückgängig machen.
              </p>
              <label className="field">
                <span className="field-label">
                  Zum Bestätigen den Projektnamen eintippen: {loeschKandidat.name}
                </span>
                <input
                  value={loeschBestaetigung}
                  onChange={(e) => setLoeschBestaetigung(e.target.value)}
                  placeholder={loeschKandidat.name}
                  autoFocus
                />
              </label>
              <div className="knopfgruppe">
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  disabled={loeschBestaetigung.trim() !== loeschKandidat.name}
                  onClick={loescheEndgueltig}
                >
                  Endgültig löschen
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setLoeschKandidat(null)}
                >
                  Abbrechen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
