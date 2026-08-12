import { useState } from 'react'
import { setEmailBenachrichtigungen } from '../api/client'
import { Zeichen } from './Zeichen'

interface BenachrichtigungenDialogProps {
  /** Aktueller Stand aus dem Profil. */
  aktiv: boolean
  onGeaendert: (aktiv: boolean) => void
  onClose: () => void
}

/**
 * Abmeldung von den taeglichen Erinnerungsmails.
 *
 * Eigener Dialog statt eines Reiters im Admin-Menue: die Einstellung gilt fuer
 * das eigene Konto und muss deshalb jedem offenstehen, nicht nur Admins.
 */
export function BenachrichtigungenDialog({
  aktiv,
  onGeaendert,
  onClose,
}: BenachrichtigungenDialogProps) {
  const [wird, setWird] = useState(false)
  const [fehler, setFehler] = useState('')

  async function umschalten(neuerWert: boolean) {
    setWird(true)
    setFehler('')
    try {
      const bestaetigt = await setEmailBenachrichtigungen(neuerWert)
      onGeaendert(bestaetigt)
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Änderung fehlgeschlagen')
    } finally {
      setWird(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-schmal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Benachrichtigungen</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Schließen">
            <Zeichen name="schliessen" />
          </button>
        </div>
        <div className="modal-body">
          <label className="einstellung-zeile">
            <input
              type="checkbox"
              checked={aktiv}
              disabled={wird}
              onChange={(e) => umschalten(e.target.checked)}
            />
            <span>
              <strong>Erinnerungen per E-Mail</strong>
              <br />
              <span className="einstellung-hinweis">
                Eine Nachricht am Morgen, wenn Tickets in den nächsten drei Tagen fällig
                werden, heute fällig sind oder die Frist überschritten haben. Überfällige
                Tickets werden höchstens einmal pro Woche wiederholt.
              </span>
            </span>
          </label>
          {fehler && (
            <p className="hinweis hinweis-fehler" style={{ margin: 0 }}>{fehler}</p>
          )}
        </div>
      </div>
    </div>
  )
}
