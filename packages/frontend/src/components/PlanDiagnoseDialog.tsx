/**
 * Zeigt, was die Planansicht gerade tut.
 *
 * Bleibt nach der laufenden Fehlersuche in der Anwendung: ein Betrachter, der
 * auf Nachfrage sagt, was er tut, erspart die naechste Ratespirale. Die Form
 * der Werte und ihre Aufbereitung stehen in utils/planDiagnose.ts.
 */
import { useState } from 'react'
import { Zeichen } from './Zeichen'
import { alsText, aufloesungPasst, type PlanDiagnose } from '../utils/planDiagnose'

interface Props {
  diagnose: PlanDiagnose
  onClose: () => void
}

export function PlanDiagnoseDialog({ diagnose, onClose }: Props) {
  const [kopiert, setKopiert] = useState(false)
  // Einmal beim Oeffnen festgehalten: die Werte beschreiben genau diesen
  // Augenblick, und der Verlauf soll waehrend des Lesens nicht wandern.
  const [text] = useState(() => alsText(diagnose, Date.now()))
  const passt = aufloesungPasst(diagnose)

  async function kopieren() {
    try {
      await navigator.clipboard.writeText(text)
      setKopiert(true)
      window.setTimeout(() => setKopiert(false), 2000)
    } catch {
      // Ohne Recht auf die Zwischenablage bleibt der Text im Feld markierbar.
      setKopiert(false)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Angaben zur Planansicht</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Schließen">
            <Zeichen name="schliessen" />
          </button>
        </div>

        <div className="modal-body">
          <p className={`hinweis ${passt ? '' : 'hinweis-fehler'}`}>
            {diagnose.scharf.massstab === null
              ? 'Es liegt noch keine scharfe Ebene vor — der Plan wird gerade nur grob dargestellt.'
              : passt
                ? 'Der sichtbare Ausschnitt wird punktgenau gezeichnet.'
                : `Der Ausschnitt wird zu grob gezeichnet: Maßstab ${diagnose.scharf.massstab.toFixed(2)} statt ${diagnose.scharf.benoetigt?.toFixed(2) ?? '?'}.`}
          </p>

          <label className="field">
            <span className="field-label">Auszug zum Weitergeben</span>
            <textarea
              className="diagnose-text"
              readOnly
              value={text}
              rows={22}
              spellCheck={false}
              onFocus={(e) => e.currentTarget.select()}
            />
          </label>

          <div className="diagnose-knopfleiste">
            <button type="button" className="btn btn-primary btn-sm" onClick={kopieren}>
              {kopiert ? 'Kopiert' : 'In die Zwischenablage kopieren'}
            </button>
            <span className="hinweis">
              Bitte mit gesetztem Zoom öffnen — die Werte beschreiben genau diesen Augenblick.
            </span>
          </div>
        </div>
      </div>
    </div>
  )
}
