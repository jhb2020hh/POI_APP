import { useState } from 'react'

interface AbnahmeprotokollDialogProps {
  ticketCount: number
  onConfirm: (input: { ort: string; datum: string }) => Promise<void>
  onClose: () => void
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

export function AbnahmeprotokollDialog({ ticketCount, onConfirm, onClose }: AbnahmeprotokollDialogProps) {
  const [ort, setOrt] = useState('')
  const [datum, setDatum] = useState(todayIso())
  const [status, setStatus] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('Erzeuge PDF…')
    try {
      await onConfirm({ ort, datum })
      onClose()
    } catch (err) {
      setStatus(`Fehler: ${err}`)
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h3>Abnahmeprotokoll erstellen</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Schließen">
            ✕
          </button>
        </div>
        <form onSubmit={handleSubmit} className="modal-body">
          <p className="hinweis" style={{ marginBottom: 12 }}>
            {ticketCount} ausgewählte Ticket{ticketCount === 1 ? '' : 's'} werden in den Bericht aufgenommen.
          </p>
          <label className="field" style={{ marginBottom: 10 }}>
            <span className="field-label">Ort</span>
            <input value={ort} onChange={(e) => setOrt(e.target.value)} placeholder="z.B. München" required />
          </label>
          <label className="field" style={{ marginBottom: 14 }}>
            <span className="field-label">Datum</span>
            <input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} required />
          </label>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <button type="submit" className="btn btn-primary btn-sm">
              PDF erzeugen
            </button>
            {status && <span className="hinweis">{status}</span>}
          </div>
        </form>
      </div>
    </div>
  )
}
