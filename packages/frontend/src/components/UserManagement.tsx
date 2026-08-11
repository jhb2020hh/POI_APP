import { useState } from 'react'
import { createUser, type UserSummary } from '../api/client'

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
