import { useEffect, useState } from 'react'
import type { Plan, PlanFolder, Project } from '@poi-app/shared'
import type { CreateProjectInput } from '../../api/client'
import { PlanFolderTree } from './PlanFolderTree'

// Sämtliche Ausgaben laufen über diesen einen Bereich. Früher lagen sie an vier
// verschiedenen Stellen verteilt, teils mit abweichendem Ergebnis.
type ExportTemplate = 'plaene' | 'abnahmeprotokoll' | 'csv'

const EXPORT_VORLAGEN: { wert: ExportTemplate; beschriftung: string }[] = [
  { wert: 'plaene', beschriftung: 'Pläne (PDF)' },
  { wert: 'abnahmeprotokoll', beschriftung: 'Protokoll' },
  { wert: 'csv', beschriftung: 'CSV' },
]

interface SidebarProps {
  /**
   * Am Rechner ausgeklappt, am Smartphone eingeblendet - derselbe Begriff fuer
   * beide Bildschirmgroessen. Die Leiste selbst muss den Unterschied nicht
   * kennen, das erledigt das Stylesheet.
   */
  istSichtbar: boolean
  /** Nach einer Auswahl schliesst sich die Leiste auf schmalen Bildschirmen. */
  onNavigiert: () => void

  projects: Project[]
  selectedProjectId: string | null
  onSelectProject: (id: string) => void
  onCreateProject: (input: CreateProjectInput) => Promise<boolean>
  createProjectStatus: string

  plans: Plan[]
  planFolders: PlanFolder[]
  onFoldersChanged: () => void
  onPlanMoved: (plan: Plan) => void
  selectedPlanId: string | null
  onSelectPlan: (id: string) => void
  // Gibt zurueck, ob der Upload geklappt hat - das Formular bleibt sonst offen,
  // damit die Fehlermeldung darin sichtbar bleibt.
  onUploadPlan: (name: string, file: File) => Promise<boolean>
  planUploadStatus: string

  dashboardActive: boolean
  onShowDashboard: () => void
  ticketOverviewActive: boolean
  onShowTicketOverview: () => void
  galleryActive: boolean
  onShowGallery: () => void
  // Alle drei Ausgaben liefern eine Fehlermeldung als Zeichenkette zurueck -
  // leer bedeutet Erfolg. So bleibt die Meldung im Export-Bereich stehen,
  // statt mit ihm zu verschwinden.
  onExportPlans: (planIds: string[], includeTicketPages: boolean) => Promise<string>
  onExportCsv: () => Promise<string>
  onExportAbnahmeprotokoll: (planIds: string[]) => Promise<void>

  onOpenSettings: () => void
  onMakeOffline: () => void
  offlineStatus: string
  isOnline: boolean
}

export function Sidebar({
  istSichtbar,
  onNavigiert,
  projects,
  selectedProjectId,
  onSelectProject,
  onCreateProject,
  createProjectStatus,
  plans,
  planFolders,
  onFoldersChanged,
  onPlanMoved,
  selectedPlanId,
  onSelectPlan,
  onUploadPlan,
  planUploadStatus,
  ticketOverviewActive,
  onShowTicketOverview,
  dashboardActive,
  onShowDashboard,
  galleryActive,
  onShowGallery,
  onExportPlans,
  onExportAbnahmeprotokoll,
  onExportCsv,
  onOpenSettings,
  onMakeOffline,
  offlineStatus,
  isOnline,
}: SidebarProps) {
  const [showCreateProject, setShowCreateProject] = useState(false)
  const [newName, setNewName] = useState('')
  const [newNumber, setNewNumber] = useState('')
  const [newAddress, setNewAddress] = useState('')
  const [newCustomer, setNewCustomer] = useState('')

  const [showUploadPlan, setShowUploadPlan] = useState(false)
  const [planName, setPlanName] = useState('')
  const [planFile, setPlanFile] = useState<File | null>(null)
  const [planFormError, setPlanFormError] = useState('')

  const [exportMode, setExportMode] = useState(false)
  const [exportSelection, setExportSelection] = useState<string[]>([])
  const [exportStatus, setExportStatus] = useState('')
  const [exportIncludeTickets, setExportIncludeTickets] = useState(false)
  const [exportTemplate, setExportTemplate] = useState<ExportTemplate>('plaene')

  const [projectsCollapsed, setProjectsCollapsed] = useState(false)
  const selectedProject = projects.find((p) => p.id === selectedProjectId)

  useEffect(() => {
    if (selectedProjectId) setProjectsCollapsed(true)
  }, [selectedProjectId])

  async function handleCreateProject(e: React.FormEvent) {
    e.preventDefault()
    if (!newName || !newNumber.trim()) return
    const success = await onCreateProject({
      name: newName,
      projectNumber: newNumber.trim(),
      address: newAddress || undefined,
      customer: newCustomer || undefined,
    })
    if (success) {
      setNewName('')
      setNewNumber('')
      setNewAddress('')
      setNewCustomer('')
      setShowCreateProject(false)
    }
  }

  async function handleUploadPlan(e: React.FormEvent) {
    e.preventDefault()
    // Fehlende Eingaben wurden hier frueher wortlos verworfen - der Klick auf
    // "Hochladen" blieb dann folgenlos, ohne erkennbaren Grund.
    if (!planName.trim()) {
      setPlanFormError('Bitte einen Namen für den Plan angeben.')
      return
    }
    if (!planFile) {
      setPlanFormError('Bitte eine PDF-Datei auswählen.')
      return
    }
    setPlanFormError('')

    const erfolgreich = await onUploadPlan(planName, planFile)
    // Nur bei Erfolg schliessen: sonst verschwindet mit dem Formular auch die
    // Fehlermeldung, die darin angezeigt wird.
    if (!erfolgreich) return

    setPlanName('')
    setPlanFile(null)
    setShowUploadPlan(false)
  }

  function toggleExportSelection(planId: string) {
    setExportSelection((prev) =>
      prev.includes(planId) ? prev.filter((id) => id !== planId) : [...prev, planId]
    )
  }

  /**
   * Nach einer Auswahl schliesst sich die Leiste - auf schmalen Bildschirmen
   * liegt sie ueber dem Inhalt, den man gerade sehen will. Am Rechner hat der
   * Aufruf keine Wirkung, weil die Leiste dort fest im Layout steht.
   */
  function navigiere<T extends unknown[]>(handler: (...args: T) => void) {
    return (...args: T) => {
      handler(...args)
      onNavigiert()
    }
  }

  function schliesseExport() {
    setExportMode(false)
    setExportSelection([])
  }

  async function handleExportSelected() {
    // CSV betrifft das ganze Projekt, nicht einzelne Zeichnungen - daher ohne
    // Planauswahl.
    if (exportTemplate === 'csv') {
      setExportStatus('Erzeuge CSV…')
      try {
        const fehler = await onExportCsv()
        setExportStatus(fehler)
        if (!fehler) schliesseExport()
      } catch (err) {
        setExportStatus(`Fehler: ${err instanceof Error ? err.message : err}`)
      }
      return
    }

    if (exportSelection.length === 0) return

    if (exportTemplate === 'abnahmeprotokoll') {
      setExportStatus('Lade Tickets…')
      try {
        await onExportAbnahmeprotokoll(exportSelection)
        setExportStatus('')
        schliesseExport()
      } catch (err) {
        setExportStatus(`Fehler: ${err instanceof Error ? err.message : err}`)
      }
      return
    }

    setExportStatus('Exportiere…')
    try {
      const summary = await onExportPlans(exportSelection, exportIncludeTickets)
      setExportStatus(summary)
      if (!summary) schliesseExport()
    } catch (err) {
      setExportStatus(`Fehler: ${err instanceof Error ? err.message : err}`)
    }
  }

  return (
    // inert statt aria-hidden: die eingeklappte Leiste hat zwar keine Breite,
    // ihre Schaltflaechen blieben aber mit der Tabulatortaste erreichbar - man
    // haette in etwas hineingetabbt, das man nicht sieht.
    <aside className={`app-sidebar ${istSichtbar ? '' : 'ist-verborgen'}`} inert={!istSichtbar}>
      <div className="sidebar-section">
        <div className="sidebar-section-header">
          <span className="sidebar-section-title">Projekte</span>
          {projectsCollapsed && selectedProjectId ? (
            <button
              type="button"
              className="btn btn-ghost-inverse btn-sm"
              onClick={() => setProjectsCollapsed(false)}
            >
              Wechseln
            </button>
          ) : (
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                className="btn btn-ghost-inverse btn-sm"
                onClick={() => setShowCreateProject((v) => !v)}
              >
                + Neu
              </button>
              {selectedProjectId && (
                <button
                  type="button"
                  className="btn btn-ghost-inverse btn-sm"
                  onClick={() => setProjectsCollapsed(true)}
                  title="Projektliste einklappen"
                >
                  ▲
                </button>
              )}
            </div>
          )}
        </div>

        {projectsCollapsed && selectedProjectId ? (
          <button
            type="button"
            className="sidebar-item active sidebar-current-project"
            onClick={() => setProjectsCollapsed(false)}
          >
            <span className="sidebar-item-label">{selectedProject?.name}</span>
            {selectedProject?.project_number && (
              <span className="sidebar-item-meta">{selectedProject.project_number}</span>
            )}
          </button>
        ) : (
          <>
            {showCreateProject && (
              <form onSubmit={handleCreateProject} style={{ padding: '4px 8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Projektname" autoFocus required />
                <input
                  value={newNumber}
                  onChange={(e) => setNewNumber(e.target.value)}
                  placeholder="Projektnummer (Pflicht, z.B. BV-2026-014)"
                  required
                />
                <input value={newAddress} onChange={(e) => setNewAddress(e.target.value)} placeholder="Adresse" />
                <input value={newCustomer} onChange={(e) => setNewCustomer(e.target.value)} placeholder="Kunde" />
                <button type="submit" className="btn btn-primary btn-sm btn-block">
                  Anlegen
                </button>
                {createProjectStatus && (
                  <span style={{ fontSize: 12, color: 'var(--sidebar-text-muted)' }}>{createProjectStatus}</span>
                )}
              </form>
            )}

            <ul className="sidebar-list">
              {projects.length === 0 && !showCreateProject && (
                <li className="sidebar-empty">Noch keine Projekte</li>
              )}
              {projects.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className={`sidebar-item ${selectedProjectId === p.id ? 'active' : ''}`}
                    onClick={navigiere(() => onSelectProject(p.id))}
                  >
                    <span className="sidebar-item-label">{p.name}</span>
                    {p.project_number && <span className="sidebar-item-meta">{p.project_number}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {selectedProjectId && (
        <div className="sidebar-section">
          <div className="sidebar-section-header">
            <span className="sidebar-section-title">Pläne</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                className="btn btn-ghost-inverse btn-sm"
                onClick={() => {
                  setExportMode((v) => !v)
                  setExportSelection([])
                  setExportStatus('')
                }}
                title="Pläne, Abnahmeprotokoll oder Ticketliste ausgeben"
              >
                {exportMode ? 'Abbrechen' : '⬇ Export'}
              </button>
              <button
                type="button"
                className="btn btn-ghost-inverse btn-sm"
                onClick={() => setShowUploadPlan((v) => !v)}
              >
                + PDF
              </button>
            </div>
          </div>

          {showUploadPlan && (
            <form onSubmit={handleUploadPlan} style={{ padding: '4px 8px 10px', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <input value={planName} onChange={(e) => setPlanName(e.target.value)} placeholder="Name des Plans" autoFocus />
              <input type="file" accept="application/pdf" onChange={(e) => setPlanFile(e.target.files?.[0] ?? null)} />
              <button type="submit" className="btn btn-primary btn-sm btn-block">
                Hochladen
              </button>
              {/* Fehler deutlich abheben - als graue Statuszeile wurde er
                  bisher wie ein Fortschrittshinweis gelesen. */}
              {(planFormError || planUploadStatus) && (
                <span
                  style={{
                    fontSize: 12,
                    color:
                      planFormError || planUploadStatus.startsWith('Fehler')
                        ? 'var(--color-danger)'
                        : 'var(--sidebar-text-muted)',
                  }}
                >
                  {planFormError || planUploadStatus}
                </span>
              )}
            </form>
          )}

          <ul className="sidebar-list">
            <li>
              <button
                type="button"
                className={`sidebar-item ${dashboardActive ? 'active' : ''}`}
                onClick={navigiere(onShowDashboard)}
              >
                <span className="sidebar-item-label">🏠 Projekt-Dashboard</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className={`sidebar-item ${ticketOverviewActive ? 'active' : ''}`}
                onClick={navigiere(onShowTicketOverview)}
              >
                <span className="sidebar-item-label">📋 Alle Tickets</span>
              </button>
            </li>
            <li>
              <button
                type="button"
                className={`sidebar-item ${galleryActive ? 'active' : ''}`}
                onClick={navigiere(onShowGallery)}
              >
                <span className="sidebar-item-label">🖼 Galerie</span>
              </button>
            </li>
            {plans.length === 0 && !showUploadPlan && <li className="sidebar-empty">Noch keine Pläne</li>}
          </ul>

          {selectedProjectId && (
            <PlanFolderTree
              projectId={selectedProjectId}
              plans={plans}
              folders={planFolders}
              selectedPlanId={selectedPlanId}
              onSelectPlan={navigiere(onSelectPlan)}
              exportMode={exportMode}
              exportSelection={exportSelection}
              onToggleExportSelection={toggleExportSelection}
              onFoldersChanged={onFoldersChanged}
              onPlanMoved={onPlanMoved}
            />
          )}

          {exportMode && (
            <div style={{ padding: '4px 8px 10px' }}>
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                {EXPORT_VORLAGEN.map((vorlage) => (
                  <button
                    key={vorlage.wert}
                    type="button"
                    className={`btn btn-sm ${exportTemplate === vorlage.wert ? 'btn-primary' : 'btn-ghost-inverse'}`}
                    style={{ flex: 1 }}
                    onClick={() => {
                      setExportTemplate(vorlage.wert)
                      setExportStatus('')
                    }}
                  >
                    {vorlage.beschriftung}
                  </button>
                ))}
              </div>

              {/* Alle Ausgaben richten sich nach den Filtern der Werkzeugleiste.
                  Ohne diesen Hinweis waere nicht erkennbar, warum ein Export
                  weniger Tickets enthaelt als erwartet. */}
              <p style={{ fontSize: 12, color: 'var(--sidebar-text-muted)', marginBottom: 6 }}>
                Es werden die Tickets ausgegeben, die durch die aktuell gesetzten Filter sichtbar sind.
              </p>

              {exportTemplate === 'plaene' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--sidebar-text-muted)', marginBottom: 6, cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={exportIncludeTickets}
                    onChange={(e) => setExportIncludeTickets(e.target.checked)}
                  />
                  Tickets als Anhang beifügen
                </label>
              )}
              {exportTemplate === 'abnahmeprotokoll' && (
                <p style={{ fontSize: 12, color: 'var(--sidebar-text-muted)', marginBottom: 6 }}>
                  Ort und Datum werden im nächsten Schritt abgefragt.
                </p>
              )}
              {exportTemplate === 'csv' && (
                <p style={{ fontSize: 12, color: 'var(--sidebar-text-muted)', marginBottom: 6 }}>
                  Umfasst alle Zeichnungen des Projekts — eine Auswahl im Baum ist dafür nicht nötig.
                </p>
              )}

              <button
                type="button"
                className="btn btn-primary btn-sm btn-block"
                onClick={handleExportSelected}
                disabled={exportTemplate !== 'csv' && exportSelection.length === 0}
              >
                {exportTemplate === 'plaene' && `Ausgewählte Pläne exportieren (${exportSelection.length})`}
                {exportTemplate === 'abnahmeprotokoll' && `Abnahmeprotokoll vorbereiten (${exportSelection.length})`}
                {exportTemplate === 'csv' && 'CSV herunterladen'}
              </button>
              {exportStatus && (
                <span
                  style={{
                    fontSize: 12,
                    color: exportStatus.startsWith('Fehler')
                      ? 'var(--color-danger)'
                      : 'var(--sidebar-text-muted)',
                  }}
                >
                  {exportStatus}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {selectedProjectId && (
        <div className="sidebar-section" style={{ marginTop: 'auto' }}>
          <button type="button" className="btn btn-ghost-inverse btn-sm btn-block" onClick={onOpenSettings}>
            ⚙ Projekt-Einstellungen
          </button>
          <div style={{ height: 6 }} />
          <button
            type="button"
            className="btn btn-ghost-inverse btn-sm btn-block"
            onClick={onMakeOffline}
            disabled={!isOnline}
          >
            ⬇ Offline verfügbar machen
          </button>
          {offlineStatus && (
            <p style={{ fontSize: 12, color: 'var(--sidebar-text-muted)', padding: '4px 8px' }}>{offlineStatus}</p>
          )}
        </div>
      )}
    </aside>
  )
}
