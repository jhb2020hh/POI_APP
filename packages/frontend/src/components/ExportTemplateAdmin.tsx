import { useEffect, useState } from 'react'
import { Zeichen } from './Zeichen'
import {
  FESTE_EXPORT_SPALTEN,
  STANDARD_EXPORT_SPALTEN,
  alsKategoriefeld,
  leseSpalten,
} from '@poi-app/shared'
import {
  createExportTemplate,
  deleteExportTemplate,
  listExportTemplates,
  listFieldSuggestions,
  updateExportTemplate,
  type ExportTemplate,
  type FieldSuggestion,
} from '../api/client'

interface ExportTemplateAdminProps {
  projectId: string
  /** Projektübergreifende Vorlagen darf nur ein Admin anlegen und ändern. */
  istAdmin: boolean
  onChanged: () => void
}

interface Auswahlspalte {
  key: string
  label: string
  /** Kategoriefelder werden zur Laufzeit gefunden - das trennt sie sichtbar. */
  ausKategorie: boolean
}

/**
 * Verwaltung der Exportvorlagen: benannte Spaltensätze, die sowohl die
 * CSV-Datei als auch die Ticketseiten im Plan-PDF bestimmen.
 *
 * Die Reihenfolge ist Teil der Vorlage — deshalb links die gewählten Spalten
 * mit Pfeilen zum Umsortieren, rechts die noch verfügbaren zum Hinzufügen.
 * Ziehen mit der Maus wäre eleganter, wäre aber auf dem Smartphone kaum
 * bedienbar und für Tastaturbedienung gar nicht.
 */
export function ExportTemplateAdmin({ projectId, istAdmin, onChanged }: ExportTemplateAdminProps) {
  const [vorlagen, setVorlagen] = useState<ExportTemplate[]>([])
  const [felder, setFelder] = useState<FieldSuggestion[]>([])
  const [bearbeitet, setBearbeitet] = useState<ExportTemplate | null>(null)
  const [name, setName] = useState('')
  const [global, setGlobal] = useState(false)
  const [spalten, setSpalten] = useState<string[]>([...STANDARD_EXPORT_SPALTEN])
  const [status, setStatus] = useState('')
  const [formularOffen, setFormularOffen] = useState(false)

  const verfuegbar: Auswahlspalte[] = [
    ...FESTE_EXPORT_SPALTEN.map((s) => ({ key: s.key, label: s.label, ausKategorie: false })),
    ...felder.map((f) => ({
      key: alsKategoriefeld(f.key),
      label: f.label || f.key,
      ausKategorie: true,
    })),
  ]

  const beschriftung = (key: string) =>
    verfuegbar.find((s) => s.key === key)?.label ?? key

  function laden() {
    listExportTemplates(projectId).then(setVorlagen).catch(() => setVorlagen([]))
  }

  useEffect(laden, [projectId])

  useEffect(() => {
    listFieldSuggestions().then(setFelder).catch(() => setFelder([]))
  }, [])

  function neueVorlage() {
    setBearbeitet(null)
    setName('')
    setGlobal(false)
    setSpalten([...STANDARD_EXPORT_SPALTEN])
    setStatus('')
    setFormularOffen(true)
  }

  function bearbeiten(vorlage: ExportTemplate) {
    setBearbeitet(vorlage)
    setName(vorlage.name)
    setGlobal(vorlage.project_id === null)
    setSpalten(leseSpalten(vorlage.columns_json))
    setStatus('')
    setFormularOffen(true)
  }

  function verschiebe(index: number, richtung: -1 | 1) {
    setSpalten((prev) => {
      const ziel = index + richtung
      if (ziel < 0 || ziel >= prev.length) return prev
      const kopie = [...prev]
      ;[kopie[index], kopie[ziel]] = [kopie[ziel], kopie[index]]
      return kopie
    })
  }

  async function speichern(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) {
      setStatus('Fehler: Bitte einen Namen für die Vorlage angeben.')
      return
    }
    if (spalten.length === 0) {
      setStatus('Fehler: Mindestens eine Spalte auswählen.')
      return
    }
    setStatus('Speichert…')
    try {
      if (bearbeitet) {
        await updateExportTemplate(bearbeitet.id, { name: name.trim(), columns: spalten })
      } else {
        await createExportTemplate(projectId, { name: name.trim(), columns: spalten, global })
      }
      setStatus('')
      setFormularOffen(false)
      laden()
      onChanged()
    } catch (err) {
      setStatus(`Fehler: ${err instanceof Error ? err.message : err}`)
    }
  }

  async function entfernen(vorlage: ExportTemplate) {
    if (!confirm(`Exportvorlage „${vorlage.name}" entfernen?`)) return
    try {
      await deleteExportTemplate(vorlage.id)
      if (bearbeitet?.id === vorlage.id) setFormularOffen(false)
      laden()
      onChanged()
    } catch (err) {
      setStatus(`Fehler: ${err instanceof Error ? err.message : err}`)
    }
  }

  const nochVerfuegbar = verfuegbar.filter((s) => !spalten.includes(s.key))

  return (
    <div>
      <p className="hinweis" style={{ marginBottom: 12 }}>
        Eine Vorlage legt fest, welche Angaben ausgegeben werden und in welcher Reihenfolge. Sie
        gilt für die CSV-Datei und für die Ticketseiten im Plan-PDF. Ohne gewählte Vorlage bleibt
        es beim gewohnten Umfang.
      </p>

      <ul className="mitglieder-liste" style={{ marginBottom: 12 }}>
        {vorlagen.map((v) => (
          <li key={v.id} className="mitglieder-zeile">
            <div>
              <strong>{v.name}</strong>
              <div className="meta">
                {leseSpalten(v.columns_json).length} Spalten
                {v.project_id === null ? ' · gilt in allen Projekten' : ''}
              </div>
            </div>
            <div className="knopfgruppe">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => bearbeiten(v)}>
                Bearbeiten
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-ghost-gefahr btn-sm"
                onClick={() => entfernen(v)}
              >
                Entfernen
              </button>
            </div>
          </li>
        ))}
        {vorlagen.length === 0 && (
          <p className="hinweis">
            Noch keine Vorlage angelegt. Ohne Vorlage werden die gewohnten Spalten ausgegeben.
          </p>
        )}
      </ul>

      {!formularOffen ? (
        <button type="button" className="btn btn-primary btn-sm" onClick={neueVorlage}>
          + Neue Exportvorlage
        </button>
      ) : (
        <form onSubmit={speichern} className="card" style={{ padding: 14 }}>
          <h4 style={{ marginBottom: 10 }}>
            {bearbeitet ? `Vorlage bearbeiten: ${bearbeitet.name}` : 'Neue Exportvorlage'}
          </h4>

          <div className="field-row" style={{ marginBottom: 12, alignItems: 'flex-end' }}>
            <div className="field" style={{ flex: 1 }}>
              {/* Hier ausdrücklich htmlFor statt einer umschließenden
                  Beschriftung: eine Beschriftung in einer Beschriftung ist
                  ungültig, und ineinander verschachtelt verliert der Klick auf
                  den Text sein Ziel. */}
              <label className="field-label" htmlFor="exportvorlage-name">
                Name der Vorlage
              </label>
              <input
                id="exportvorlage-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z.B. Abnahme kurz"
                autoFocus
              />
            </div>
            {istAdmin && !bearbeitet && (
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={global}
                  onChange={(e) => setGlobal(e.target.checked)}
                />
                In allen Projekten verfügbar
              </label>
            )}
          </div>

          <div className="spaltenwahl">
            <div>
              <div className="field-label">Ausgegeben wird ({spalten.length})</div>
              <ul className="spaltenliste">
                {spalten.map((key, i) => (
                  <li key={key} className="spaltenzeile">
                    <span className="spaltenzeile-nummer">{i + 1}.</span>
                    <span className="spaltenzeile-name">{beschriftung(key)}</span>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => verschiebe(i, -1)}
                      disabled={i === 0}
                      title="Nach oben"
                      aria-label={`${beschriftung(key)} nach oben`}
                    >
                      <Zeichen name="pfeil-hoch" groesse={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => verschiebe(i, 1)}
                      disabled={i === spalten.length - 1}
                      title="Nach unten"
                      aria-label={`${beschriftung(key)} nach unten`}
                    >
                      <Zeichen name="pfeil-runter" groesse={14} />
                    </button>
                    <button
                      type="button"
                      className="icon-btn"
                      onClick={() => setSpalten((prev) => prev.filter((k) => k !== key))}
                      title="Entfernen"
                      aria-label={`${beschriftung(key)} entfernen`}
                    >
                      <Zeichen name="schliessen" groesse={14} />
                    </button>
                  </li>
                ))}
                {spalten.length === 0 && (
                  <li className="hinweis hinweis-fehler">Mindestens eine Spalte auswählen.</li>
                )}
              </ul>
            </div>

            <div>
              <div className="field-label">Noch verfügbar ({nochVerfuegbar.length})</div>
              <ul className="spaltenliste">
                {nochVerfuegbar.map((s) => (
                  <li key={s.key} className="spaltenzeile">
                    <span className="spaltenzeile-name">
                      {s.label}
                      {s.ausKategorie && <span className="meta"> · Kategoriefeld</span>}
                    </span>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => setSpalten((prev) => [...prev, s.key])}
                    >
                      Hinzufügen
                    </button>
                  </li>
                ))}
                {nochVerfuegbar.length === 0 && (
                  <li className="hinweis">Alle verfügbaren Angaben sind bereits gewählt.</li>
                )}
              </ul>
            </div>
          </div>

          <div className="knopfgruppe" style={{ marginTop: 14 }}>
            <button type="submit" className="btn btn-primary btn-sm">
              {bearbeitet ? 'Änderungen speichern' : 'Vorlage anlegen'}
            </button>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => setFormularOffen(false)}
            >
              Abbrechen
            </button>
            {status && (
              <span className={`hinweis ${status.startsWith('Fehler') ? 'hinweis-fehler' : ''}`}>
                {status}
              </span>
            )}
          </div>
        </form>
      )}
    </div>
  )
}
