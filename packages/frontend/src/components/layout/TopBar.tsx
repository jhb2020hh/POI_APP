interface TopBarProps {
  projectName?: string
  isOnline: boolean
  pendingCount: number
  onSync: () => void
  onLogout: () => void
  canAccessAdminMenu: boolean
  onOpenAdminMenu: () => void
  /** Blendet die Seitenleiste ein/aus - nur auf schmalen Bildschirmen sichtbar. */
  onToggleSidebar: () => void
}

export function TopBar({
  projectName,
  isOnline,
  pendingCount,
  onSync,
  onLogout,
  canAccessAdminMenu,
  onOpenAdminMenu,
  onToggleSidebar,
}: TopBarProps) {
  return (
    <header className="app-topbar">
      <div className="app-topbar-left">
        <button
          type="button"
          className="icon-btn nur-mobil"
          onClick={onToggleSidebar}
          aria-label="Navigation ein-/ausblenden"
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
