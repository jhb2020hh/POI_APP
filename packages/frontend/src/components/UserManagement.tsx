import { useCallback, useEffect, useState } from 'react'
import {
  approveUser,
  createUser,
  listPendingUsers,
  rejectUser,
  type UserSummary,
} from '../api/client'

interface UserManagementProps {
  users: UserSummary[]
  onUserCreated: () => void
}

const ROLE_OPTIONS: { value: string; label: string }[] = [
  { value: 'extern', label: 'Extern (nur eigene Tickets)' },
  { value: 'mitarbeiter', label: 'Mitarbeiter (alles außer Verwaltung)' },
  { value: 'admin', label: 'Admin' },
]

export function UserManagement({ users, onUserCreated }: UserManagementProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState('extern')
  const [status, setStatus] = useState('')

  const [offeneAntraege, setOffeneAntraege] = useState<UserSummary[]>([])
  const [antragStatus, setAntragStatus] = useState('')

  const ladeAntraege = useCallback(() => {
    listPendingUsers()
      .then(setOffeneAntraege)
      .catch((err) => setAntragStatus(`Fehler: ${err instanceof Error ? err.message : err}`))
  }, [])

  useEffect(() => {
    ladeAntraege()
  }, [ladeAntraege])

  async function entscheide(nutzer: UserSummary, freischalten: boolean) {
    if (
      !freischalten &&
      !confirm(`Zugang für ${nutzer.email} ablehnen? Das Konto wird dabei entfernt.`)
    ) {
      return
    }
    setAntragStatus(freischalten ? 'Wird freigeschaltet…' : 'Wird abgelehnt…')
    try {
      if (freischalten) {
        await approveUser(nutzer.id)
      } else {
        await rejectUser(nutzer.id)
      }
      setAntragStatus('')
      ladeAntraege()
      // Freigeschaltete Konten gehoeren in die Gesamtliste - die laedt der
      // Aufrufer, weil er sie auch an anderen Stellen verwendet.
      if (freischalten) onUserCreated()
    } catch (err) {
      setAntragStatus(`Fehler: ${err instanceof Error ? err.message : err}`)
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email || !password || !displayName) return
    setStatus('Legt an…')
    try {
      await createUser({ email, password, displayName, role })
      setEmail('')
      setPassword('')
      setDisplayName('')
      setRole('extern')
      setStatus('')
      onUserCreated()
    } catch (err) {
      setStatus(`Fehler: ${err}`)
    }
  }

  return (
    <div>
      {/* Offene Anträge zuerst: sie sind das Einzige hier, was auf eine Handlung
          wartet. Ohne offene Anträge bleibt der Bereich unsichtbar. */}
      {offeneAntraege.length > 0 && (
        <div
          className="card"
          style={{
            padding: 14,
            marginBottom: 16,
            borderColor: 'var(--color-warning)',
            background: 'var(--color-warning-bg)',
          }}
        >
          <h4 style={{ marginBottom: 4 }}>
            Wartet auf Freischaltung ({offeneAntraege.length})
          </h4>
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginBottom: 10 }}>
            Selbst registrierte Zugänge. Bis zur Freischaltung ist keine Anmeldung möglich.
            Nach dem Freischalten gilt die Rolle „Extern"; Projekte werden separat zugeordnet.
          </p>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {offeneAntraege.map((u) => (
              <li
                key={u.id}
                style={{
                  padding: '8px 12px',
                  border: '1px solid var(--color-border)',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--color-surface)',
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: 10,
                  flexWrap: 'wrap',
                }}
              >
                <span>
                  <strong>{u.display_name}</strong>{' '}
                  <span style={{ color: 'var(--color-text-muted)' }}>· {u.email}</span>
                </span>
                <span style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn btn-primary btn-sm" onClick={() => entscheide(u, true)}>
                    Freischalten
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => entscheide(u, false)}>
                    Ablehnen
                  </button>
                </span>
              </li>
            ))}
          </ul>
          {antragStatus && (
            <p
              style={{
                fontSize: 12,
                marginTop: 8,
                color: antragStatus.startsWith('Fehler') ? 'var(--color-danger)' : 'var(--color-text-muted)',
              }}
            >
              {antragStatus}
            </p>
          )}
        </div>
      )}

      <form onSubmit={handleSubmit} className="card" style={{ padding: 14, marginBottom: 16 }}>
        <h4 style={{ marginBottom: 10 }}>Neuen Nutzer anlegen</h4>
        <div className="field-row" style={{ marginBottom: 10 }}>
          <div className="field" style={{ flex: 1 }}>
            <span className="field-label">Name</span>
            <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Max Mustermann" required />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <span className="field-label">E-Mail</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="max@firma.de"
              required
            />
          </div>
        </div>
        <div className="field-row" style={{ marginBottom: 10 }}>
          <div className="field" style={{ flex: 1 }}>
            <span className="field-label">Passwort</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mindestens 6 Zeichen"
              required
            />
          </div>
          <div className="field" style={{ flex: 1 }}>
            <span className="field-label">Rolle</span>
            <select value={role} onChange={(e) => setRole(e.target.value)}>
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button type="submit" className="btn btn-primary btn-sm">
            Nutzer anlegen
          </button>
          {status && <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{status}</span>}
        </div>
      </form>

      <div>
        <h4 style={{ marginBottom: 8 }}>Alle Nutzer ({users.length})</h4>
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {users.map((u) => (
            <li
              key={u.id}
              style={{
                padding: '8px 12px',
                border: '1px solid var(--color-border)',
                borderRadius: 'var(--radius-sm)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span>
                <strong>{u.display_name}</strong>{' '}
                <span style={{ color: 'var(--color-text-muted)' }}>· {u.email}</span>
              </span>
              <span className="badge badge-neutral">{u.role}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
