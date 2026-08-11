import { useState } from 'react'
import { login } from '../api/client'

interface LoginFormProps {
  onLoggedIn: () => void
}

export function LoginForm({ onLoggedIn }: LoginFormProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    try {
      await login(email, password)
      onLoggedIn()
    } catch (err) {
      setError(String(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg)',
      }}
    >
      <div className="card" style={{ width: 340, padding: 32 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>🏗️</div>
          <h1 style={{ fontSize: 18 }}>POI-App</h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
            Baustellen-Mängel &amp; Ticket-Tracking
          </p>
        </div>
        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="field">
            <span className="field-label">E-Mail</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@firma.de"
              required
              autoFocus
            />
          </div>
          <div className="field">
            <span className="field-label">Passwort</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              required
            />
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={loading} style={{ marginTop: 8 }}>
            {loading ? 'Anmelden…' : 'Anmelden'}
          </button>
        </form>
        {error && (
          <p style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 12, textAlign: 'center' }}>{error}</p>
        )}
      </div>
    </div>
  )
}
