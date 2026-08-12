interface TopBarProps {
  projectName?: string
  isOnline: boolean
  pendingCount: number
  onSync: () => void
  onLogout: () => void
  canAccessAdminMenu: boolean
  onOpenAdminMenu: () => void
  /** Erinnerungsmails ein- oder ausschalten - steht jedem Konto offen. */
  onOpenBenachrichtigungen: () => void
  /** Blendet die Navigationsleiste ein oder aus - auf jeder Bildschirmgroesse. */
  onToggleSidebar: () => void
  navigationSichtbar: boolean
}

export function TopBar({
  projectName,
  isOnline,
  pendingCount,
  onSync,
  onLogout,
  canAccessAdminMenu,
  onOpenAdminMenu,
  onOpenBenachrichtigungen,
  onToggleSidebar,
  navigationSichtbar,
}: TopBarProps) {
  return (
    <header className="app-topbar">
      <div className="app-topbar-left">
        {/* Frueher nur am Smartphone sichtbar. Am Rechner gibt es jetzt
            dieselbe Schaltflaeche, damit der Grundriss mehr Platz bekommt. */}
        <button
          type="button"
          className="icon-btn"
          onClick={onToggleSidebar}
          aria-label={navigationSichtbar ? 'Navigation ausblenden' : 'Navigation einblenden'}
          aria-expanded={navigationSichtbar}
          title={navigationSichtbar ? 'Navigation ausblenden' : 'Navigation einblenden'}
        >
          ☰
        </button>
        <span className="app-topbar-brand">POI-App</span>
        {projectName && (
          <>
            <span className="app-topbar-crumb">/</span>
            <span className="app-topbar-project">{projectName}</span>
          </>
        )}
      </div>
      <div className="app-topbar-right">
        <span className="status-pill">
          <span className={`online-dot ${isOnline ? 'online' : 'offline'}`} />
          {isOnline ? 'Online' : 'Offline'}
        </span>
        {pendingCount > 0 && (
          <span className="badge badge-in_bearbeitung">{pendingCount} ausstehend</span>
        )}
        <button type="button" className="btn btn-secondary btn-sm" onClick={onSync} disabled={!isOnline}>
          Synchronisieren
        </button>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={onOpenBenachrichtigungen}
          title="Erinnerungen per E-Mail"
        >
          ✉
        </button>
        {canAccessAdminMenu && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onOpenAdminMenu}>
            ⚙ Admin
          </button>
        )}
        <button type="button" className="btn btn-ghost btn-sm" onClick={onLogout}>
          Abmelden
        </button>
      </div>
    </header>
  )
}
