import { useEffect, useState } from 'react'
import { getLetterhead, updateLetterhead, type CompanyLetterhead } from '../api/client'

const FIELDS: { key: keyof Omit<CompanyLetterhead, 'id'>; label: string }[] = [
  { key: 'firma_name', label: 'Firmenname' },
  { key: 'adresse_zeile1', label: 'Straße/Hausnummer' },
  { key: 'plz_ort', label: 'PLZ/Ort' },
  { key: 'telefon', label: 'Telefon' },
  { key: 'fax', label: 'Fax' },
  { key: 'email', label: 'E-Mail' },
  { key: 'geschaeftsfuehrer', label: 'Geschäftsführer' },
  { key: 'sitz_gesellschaft', label: 'Sitz der Gesellschaft' },
  { key: 'handelsregister', label: 'Handelsregister' },
  { key: 'ust_idnr', label: 'USt-IdNr.' },
]

export function LetterheadManagement() {
  const [values, setValues] = useState<Omit<CompanyLetterhead, 'id'> | null>(null)
  const [status, setStatus] = useState('')

  useEffect(() => {
    getLetterhead().then(({ id: _id, ...rest }) => setValues(rest))
  }, [])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!values) return
    setStatus('Speichert…')
    try {
      await updateLetterhead({
        firmaName: values.firma_name,
        adresseZeile1: values.adresse_zeile1,
        plzOrt: values.plz_ort,
        telefon: values.telefon,
        fax: values.fax,
        email: values.email,
        geschaeftsfuehrer: values.geschaeftsfuehrer,
        sitzGesellschaft: values.sitz_gesellschaft,
        handelsregister: values.handelsregister,
        ustIdnr: values.ust_idnr,
      })
      setStatus('Gespeichert')
    } catch (err) {
      setStatus(`Fehler: ${err}`)
    }
  }

  if (!values) return <p className="hinweis">Lädt…</p>

  return (
    <form onSubmit={handleSubmit}>
      <p className="hinweis" style={{ marginBottom: 12 }}>
        Diese Absender-Angaben erscheinen im Briefkopf/der Fußzeile von generierten Berichten (z. B.
        Abnahmeprotokoll).
      </p>
      {FIELDS.map(({ key, label }) => (
        <label className="field" key={key} style={{ marginBottom: 8 }}>
          <span className="field-label">{label}</span>
          <input
            value={values[key]}
            onChange={(e) => setValues((prev) => (prev ? { ...prev, [key]: e.target.value } : prev))}
          />
        </label>
      ))}
      <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="submit" className="btn btn-primary btn-sm">
          Speichern
        </button>
        {status && <span className="hinweis">{status}</span>}
      </div>
    </form>
  )
}
