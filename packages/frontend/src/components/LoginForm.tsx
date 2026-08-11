import { useState } from 'react'
import { login, register } from '../api/client'

interface LoginFormProps {
  onLoggedIn: () => void
}

type Modus = 'anmelden' | 'registrieren'

export function LoginForm({ onLoggedIn }: LoginFormProps) {
  const [modus, setModus] = useState<Modus>('anmelden')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [hinweis, setHinweis] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function wechsle(zielModus: Modus) {
    setModus(zielModus)
    setError(null)
    setHinweis(null)
    setPassword('')
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setHinweis(null)
    setLoading(true)
    try {
      if (modus === 'anmelden') {
        await login(email, password)
        onLoggedIn()
      } else {
        const { bestaetigungNoetig } = await register({ email, password, displayName })
        setHinweis(
          bestaetigungNoetig
            ? 'Konto angelegt. Bitte bestätige zuerst die E-Mail, die wir dir geschickt haben. Anschließend muss ein Administrator den Zugang freischalten — du wirst benachrichtigt.'
            : 'Konto angelegt. Ein Administrator muss den Zugang noch freischalten.',
        )
        setModus('anmelden')
        setPassword('')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  const istRegistrierung = modus === 'registrieren'

  return (
    <div
      style={{
        minHeight: '100%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--color-bg)',
        padding: 16,
      }}
    >
      {/* maxWidth statt fester Breite: bei 320-px-Geraeten lief die Karte sonst
          ueber den Bildschirmrand hinaus. */}
      <div className="card" style={{ width: '100%', maxWidth: 340, padding: 32 }}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>🏗️</div>
          <h1 style={{ fontSize: 18 }}>POI-App</h1>
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginTop: 4 }}>
            Baustellen-Mängel &amp; Ticket-Tracking
          </p>
        </div>

        <div style={{ display: 'flex', gap: 4, marginBottom: 16 }}>
          <button
            type="button"
            className={`btn btn-sm ${modus === 'anmelden' ? 'btn-primary' : 'btn-ghost'}`}
            style={{ flex: 1 }}
            onClick={() => wechsle('anmelden')}
          >
            Anmelden
          </button>
          <button
            type="button"
            className={`btn btn-sm ${istRegistrierung ? 'btn-primary' : 'btn-ghost'}`}
            style={{ flex: 1 }}
            onClick={() => wechsle('registrieren')}
          >
            Registrieren
          </button>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {istRegistrierung && (
            <div className="field">
              <span className="field-label">Name</span>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Vor- und Nachname"
                required
                autoFocus
              />
            </div>
          )}
          <div className="field">
            <span className="field-label">E-Mail</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@firma.de"
              required
              autoFocus={!istRegistrierung}
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
              minLength={istRegistrierung ? 8 : undefined}
              autoComplete={istRegistrierung ? 'new-password' : 'current-password'}
            />
          </div>
          <button type="submit" className="btn btn-primary btn-block" disabled={loading} style={{ marginTop: 8 }}>
            {loading
              ? istRegistrierung
                ? 'Wird angelegt…'
                : 'Anmelden…'
              : istRegistrierung
                ? 'Konto anlegen'
                : 'Anmelden'}
          </button>
        </form>

        {istRegistrierung && !hinweis && (
          <p style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 12 }}>
            Neue Zugänge werden von einem Administrator geprüft und freigeschaltet.
          </p>
        )}
        {hinweis && (
          <p style={{ color: 'var(--color-success)', fontSize: 13, marginTop: 12 }}>{hinweis}</p>
        )}
        {error && (
          <p style={{ color: 'var(--color-danger)', fontSize: 13, marginTop: 12, textAlign: 'center' }}>{error}</p>
        )}
      </div>
    </div>
  )
}
