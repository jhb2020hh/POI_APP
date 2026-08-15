/**
 * Zeigt, was die Planansicht gerade tut.
 *
 * Bleibt nach der laufenden Fehlersuche in der Anwendung: ein Betrachter, der
 * auf Nachfrage sagt, was er tut, erspart die naechste Ratespirale. Die Form
 * der Werte und ihre Aufbereitung stehen in utils/planDiagnose.ts.
 */
import { useState } from 'react'
import { Zeichen } from './Zeichen'
import {
  alsText,
  aufloesungPasst,
  bilddehnung,
  gezeichneteDpi,
  type PlanDiagnose,
} from '../utils/planDiagnose'

/**
 * Der eine Satz, auf den es ankommt.
 *
 * Trennt die beiden Faelle, die von auszen gleich aussehen: eine zu grob
 * gezeichnete Vektorzeichnung (behebbar) und ein hochskaliertes Rasterbild
 * (nicht behebbar - die Bildinformation ist nicht da).
 */
function befund(d: PlanDiagnose): { text: string; gut: boolean } {
  if (d.scharf.massstab === null) {
    return { text: 'Es liegt noch keine scharfe Ebene vor.', gut: false }
  }
  if (!aufloesungPasst(d)) {
    return {
      text:
        `Der Ausschnitt wird zu grob gezeichnet: Maßstab ${d.scharf.massstab.toFixed(2)} ` +
        `statt ${d.scharf.benoetigt?.toFixed(2) ?? '?'}. Das ist ein Fehler in der Anwendung.`,
      gut: false,
    }
  }

  if (!d.inhalt) {
    return { text: 'Der sichtbare Ausschnitt wird punktgenau gezeichnet.', gut: true }
  }

  const gez = gezeichneteDpi(d)
  const dehnung = gez === null ? null : bilddehnung(d.inhalt, gez)

  // Die Aussage stuetzt sich auf die *Struktur* der Seite, nicht auf die
  // Bildmasze: die sind ein Zusatz und nicht immer zu bekommen. Eine Zeichnung
  // ohne einen einzigen Textbefehl besteht nicht aus Text - dann steckt die
  // Beschriftung im Bild und kann nie schaerfer werden als dieses.
  if (d.inhalt.bilder > 0 && d.inhalt.textstellen === 0) {
    const masze = d.inhalt.groesstesBild
      ? ` (${d.inhalt.groesstesBild.breite} × ${d.inhalt.groesstesBild.hoehe} px` +
        (d.inhalt.dpi ? `, ${d.inhalt.dpi.toFixed(0)} dpi` : '') +
        (dehnung ? `, hier ${dehnung.toFixed(1)}× gedehnt` : '') +
        ')'
      : ''
    return {
      text:
        `Gezeichnet wird punktgenau — aber die Seite enthält keinen einzigen ` +
        `Textbefehl und ${d.inhalt.bilder} Bild(er)${masze}. Die Zeichnung liegt ` +
        `also als Rasterbild in der Datei, nicht als Linien und Text. Mehr ` +
        `Bildinformation ist nicht vorhanden; daran kann kein Betrachter etwas ` +
        `ändern — auch Acrobat nicht. Abhilfe: den Plan aus dem CAD als ` +
        `Vektor-PDF ausgeben statt als Bild.`,
      gut: false,
    }
  }

  if (d.inhalt.bilder > 0 && dehnung !== null && dehnung > 1.5) {
    return {
      text:
        `Gezeichnet wird punktgenau. Linien und Text bleiben scharf, aber ein ` +
        `enthaltenes Bild mit ${d.inhalt.dpi?.toFixed(0)} dpi wird ` +
        `${dehnung.toFixed(1)}× gedehnt und bleibt deshalb weich.`,
      gut: false,
    }
  }

  if (d.inhalt.bilder === 0) {
    return {
      text: 'Punktgenau gezeichnet, und die Seite besteht aus Linien und Text — sie muss in jedem Maßstab scharf sein.',
      gut: true,
    }
  }
  return { text: 'Der sichtbare Ausschnitt wird punktgenau gezeichnet.', gut: true }
}

interface Props {
  diagnose: PlanDiagnose
  onClose: () => void
}

export function PlanDiagnoseDialog({ diagnose, onClose }: Props) {
  const [kopiert, setKopiert] = useState(false)
  // Einmal beim Oeffnen festgehalten: die Werte beschreiben genau diesen
  // Augenblick, und der Verlauf soll waehrend des Lesens nicht wandern.
  // Der Inhaltsbefund wird nachgereicht - deshalb bei jeder Aenderung neu.
  const text = alsText(diagnose, Date.now())
  const { text: urteil, gut } = befund(diagnose)

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
          <p className={`hinweis ${gut ? '' : 'hinweis-fehler'}`}>{urteil}</p>

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
