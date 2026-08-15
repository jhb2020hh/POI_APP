import { useEffect, useMemo, useState } from 'react'
import type { Attachment, Category, Plan, PlanFolder, Point, PointStats, Project } from '@poi-app/shared'
import { leseSpalten } from '@poi-app/shared'
import {
  AuthError,
  addProjectMember,
  type CreateProjectInput,
  createPoint,
  createProject,
  deletePoint,
  downloadPointsCsv,
  getCurrentUser,
  getPendingChangeCount,
  getToken,
  listAttachments,
  listCategories,
  archiveProject,
  listGlobalCategories,
  listPlanFolders,
  listPlans,
  listVisiblePlanPoints,
  listExportTemplates,
  listFieldSuggestions,
  listProjectMembers,
  type ExportTemplate,
  listProjectPoints,
  listProjects,
  listProjectStats,
  listUsers,
  logout,
  makeProjectAvailableOffline,
  removeProjectMember,
  planFileUrl,
  type PointFilters,
  type PointWithPlan,
  type ProjectMember,
  type UserSummary,
  syncProject,
  updatePoint,
  uploadAttachment,
  uploadPlan,
  type AttachmentWithPoint,
} from './api/client'
import { connectPlanSocket } from './api/socket'
import { PdfViewer } from './components/PdfViewer'
import { Dashboard } from './components/Dashboard'
import { LoginForm } from './components/LoginForm'
import { TicketList } from './components/TicketList'
import { TicketOverview } from './components/TicketOverview'
import { ProjectGallery } from './components/ProjectGallery'
import { ProjectLandingPage } from './components/ProjectLandingPage'
import { TicketDrawer, type TicketFormInput } from './components/TicketDrawer'
import { ProjectSettingsPanel } from './components/ProjectSettingsPanel'
import { TopBar } from './components/layout/TopBar'
import { Sidebar } from './components/layout/Sidebar'
import { AdminMenu } from './components/AdminMenu'
import { BenachrichtigungenDialog } from './components/BenachrichtigungenDialog'
import { istSchmalerBildschirm, useLeistenSichtbarkeit } from './hooks/useLeistenSichtbarkeit'
import { STATUS_LABELS } from './constants'
import { genId } from './utils/id'
import { exportPlansToPdf } from './utils/planExportPdf'
import { exportAbnahmeprotokoll } from './utils/abnahmeprotokollExport'
import { AbnahmeprotokollDialog } from './components/AbnahmeprotokollDialog'
import { getLetterhead } from './api/client'
import { Zeichen } from './components/Zeichen'
import './App.css'

type DrawerState = { mode: 'create'; x: number; y: number } | { mode: 'edit'; point: Point }

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(getToken()))
  const [currentUser, setCurrentUser] = useState(() => getCurrentUser())
  const [adminMenuOpen, setAdminMenuOpen] = useState(false)
  const [benachrichtigungenOffen, setBenachrichtigungenOffen] = useState(false)
  const [templates, setTemplates] = useState<Category[]>([])

  const [projects, setProjects] = useState<Project[]>([])
  const [projectStats, setProjectStats] = useState<PointStats[]>([])
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null)
  const [plans, setPlans] = useState<Plan[]>([])
  const [planFolders, setPlanFolders] = useState<PlanFolder[]>([])
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null)
  const [points, setPoints] = useState<Point[]>([])
  const [showTicketOverview, setShowTicketOverview] = useState(false)
  const [showGallery, setShowGallery] = useState(false)
  const [overviewPoints, setOverviewPoints] = useState<PointWithPlan[]>([])
  const [users, setUsers] = useState<UserSummary[]>([])
  const [members, setMembers] = useState<ProjectMember[]>([])
  const [exportTemplates, setExportTemplates] = useState<ExportTemplate[]>([])
  const [categories, setCategories] = useState<Category[]>([])

  const [createProjectStatus, setCreateProjectStatus] = useState('')
  const [planUploadStatus, setPlanUploadStatus] = useState('')
  const [memberStatus, setMemberStatus] = useState('')
  const [settingsOpen, setSettingsOpen] = useState(false)

  const [drawer, setDrawer] = useState<DrawerState | null>(null)

  const [filterPlanId, setFilterPlanId] = useState('')
  const [filterGewerk, setFilterGewerk] = useState('')
  const [filterCategoryId, setFilterCategoryId] = useState('')
  const [filterBauabschnitt, setFilterBauabschnitt] = useState('')
  const [filterFrom, setFilterFrom] = useState('')
  const [filterTo, setFilterTo] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [filterAssignedTo, setFilterAssignedTo] = useState('')

  const [isOnline, setIsOnline] = useState(() => navigator.onLine)
  const [offlineStatus, setOfflineStatus] = useState('')
  const [conflictWarning, setConflictWarning] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncStatus, setSyncStatus] = useState('')

  // Zustand des mobilen Layouts. Am Rechner ohne Wirkung: die zugehoerigen
  // CSS-Regeln greifen erst unterhalb des Umbruchpunkts.
  // Ein Begriff für beide Bildschirmgrößen: sichtbar heißt am Rechner
  // ausgeklappt, am Smartphone eingeblendet.
  const [navigationSichtbar, setNavigationSichtbar] = useLeistenSichtbarkeit('poi.leiste.navigation')
  const [ticketleisteSichtbar, setTicketleisteSichtbar] = useLeistenSichtbarkeit('poi.leiste.tickets')
  const [filterOffen, setFilterOffen] = useState(false)
  // Plan und Ticketliste haben nebeneinander keinen Platz - es wird umgeschaltet.
  const [mobilAnsicht, setMobilAnsicht] = useState<'plan' | 'tickets'>('plan')

  function refreshPendingCount() {
    getPendingChangeCount().then(setPendingCount)
  }

  async function handleSync() {
    if (!selectedProjectId) return
    setSyncStatus('Synchronisiere…')
    try {
      const summary = await syncProject(selectedProjectId)
      setSyncStatus(
        `Sync abgeschlossen: ${summary.applied} übernommen, ${summary.conflicts} Konflikte, ${summary.errors} Fehler, ${summary.pulled} empfangen.`
      )
      refreshPendingCount()
      if (selectedPlanId) refreshPoints(selectedPlanId)
    } catch (err) {
      setSyncStatus(`Sync fehlgeschlagen: ${err}`)
    }
  }

  useEffect(() => {
    refreshPendingCount()
    const goOnline = () => {
      setIsOnline(true)
      if (selectedProjectId) handleSync()
    }
    const goOffline = () => setIsOnline(false)
    window.addEventListener('online', goOnline)
    window.addEventListener('offline', goOffline)
    return () => {
      window.removeEventListener('online', goOnline)
      window.removeEventListener('offline', goOffline)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId])

  async function handleMakeOffline() {
    if (!selectedProjectId) return
    try {
      await makeProjectAvailableOffline(selectedProjectId, setOfflineStatus)
    } catch (err) {
      setOfflineStatus(`Fehler: ${err}`)
    }
  }

  function handleAuthError(err: unknown) {
    if (err instanceof AuthError) {
      setIsAuthenticated(false)
      setCurrentUser(null)
      return true
    }
    return false
  }

  useEffect(() => {
    if (!isAuthenticated) return
    listProjects()
      .then(setProjects)
      .catch((err) => {
        if (!handleAuthError(err)) throw err
      })
    listProjectStats()
      .then(setProjectStats)
      .catch((err) => {
        if (!handleAuthError(err)) throw err
      })
    listUsers()
      .then(setUsers)
      .catch((err) => {
        if (!handleAuthError(err)) throw err
      })
  }, [isAuthenticated])

  function refreshTemplates() {
    listGlobalCategories()
      .then(setTemplates)
      .catch((err) => {
        if (!handleAuthError(err)) throw err
      })
  }

  useEffect(() => {
    if (!isAuthenticated || currentUser?.role !== 'admin') {
      setTemplates([])
      return
    }
    refreshTemplates()
  }, [isAuthenticated, currentUser?.role])

  useEffect(() => {
    if (!isAuthenticated || !selectedProjectId) {
      setMembers([])
      setExportTemplates([])
      return
    }
    listProjectMembers(selectedProjectId)
      .then(setMembers)
      .catch((err) => {
        if (!handleAuthError(err)) throw err
      })
    refreshExportTemplates(selectedProjectId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, isAuthenticated])

  function refreshCategories(projectId: string) {
    listCategories(projectId)
      .then(setCategories)
      .catch((err) => {
        if (!handleAuthError(err)) throw err
      })
  }

  useEffect(() => {
    if (!isAuthenticated || !selectedProjectId) {
      setCategories([])
      return
    }
    refreshCategories(selectedProjectId)
  }, [selectedProjectId, isAuthenticated])

  useEffect(() => {
    if (!isAuthenticated) return
    if (selectedProjectId) {
      listPlans(selectedProjectId)
        .then(setPlans)
        .catch((err) => {
          if (!handleAuthError(err)) throw err
        })
      refreshPlanFolders(selectedProjectId)
    } else {
      setPlans([])
      setPlanFolders([])
    }
    setSelectedPlanId(null)
    setShowTicketOverview(false)
    setShowGallery(false)
  }, [selectedProjectId, isAuthenticated])

  function refreshPlanFolders(projectId: string) {
    listPlanFolders(projectId)
      .then(setPlanFolders)
      .catch((err) => {
        if (!handleAuthError(err)) throw err
      })
  }

  /**
   * Die gesetzten Filter als ein Wert.
   *
   * Bewusst gebuendelt und gemerkt: solange die Effekte unten jeden Filter
   * einzeln in ihrer Abhaengigkeitsliste auffuehrten, fehlten dort drei davon -
   * die Pins im Planfenster wurden bei einer Aenderung von Gewerk oder
   * Kategorie schlicht nicht neu geladen. Mit einem einzigen Wert kann das
   * nicht mehr passieren.
   */
  const currentFilters = useMemo<PointFilters>(
    () => ({
      planId: filterPlanId || undefined,
      bauabschnitt: filterBauabschnitt || undefined,
      from: filterFrom || undefined,
      to: filterTo || undefined,
      status: filterStatus || undefined,
      assignedTo: filterAssignedTo || undefined,
      gewerk: filterGewerk || undefined,
      categoryId: filterCategoryId || undefined,
    }),
    [
      filterPlanId,
      filterBauabschnitt,
      filterFrom,
      filterTo,
      filterStatus,
      filterAssignedTo,
      filterGewerk,
      filterCategoryId,
    ]
  )

  useEffect(() => {
    if (!isAuthenticated) return
    if (selectedPlanId) {
      refreshPoints(selectedPlanId)
    } else {
      setPoints([])
    }
    setDrawer(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlanId, isAuthenticated, currentFilters])

  function refreshPoints(planId: string) {
    // Dieselbe Funktion, die auch die Ausgaben verwenden - siehe
    // sichtbareTicketsDesPlans. Dass Ansicht und PDF dieselbe Menge zeigen,
    // ist damit nicht mehr Absprache, sondern Bauart.
    sichtbareTicketsDesPlans(planId)
      .then(setPoints)
      .catch((err) => {
        if (!handleAuthError(err)) throw err
      })
  }

  useEffect(() => {
    if (!isAuthenticated || !selectedProjectId || !showTicketOverview) {
      setOverviewPoints([])
      return
    }
    listProjectPoints(selectedProjectId, currentFilters)
      .then(setOverviewPoints)
      .catch((err) => {
        if (!handleAuthError(err)) throw err
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProjectId, showTicketOverview, isAuthenticated, currentFilters])

  const [pendingPointId, setPendingPointId] = useState<string | null>(null)
  const [reportSelection, setReportSelection] = useState<string[]>([])
  const [showReportDialog, setShowReportDialog] = useState(false)
  const [reportPointsOverride, setReportPointsOverride] = useState<PointWithPlan[] | null>(null)

  async function handleGenerateReport({ ort, datum }: { ort: string; datum: string }) {
    if (!selectedProjectId) return
    const letterhead = await getLetterhead()
    const sourcePoints = reportPointsOverride ?? overviewPoints
    const selectedPoints = sourcePoints.filter((p) => reportSelection.includes(p.id))
    const attachmentsByPointId: Record<string, Attachment[]> = {}
    for (const point of selectedPoints) {
      attachmentsByPointId[point.id] = await listAttachments(point.id)
    }
    await exportAbnahmeprotokoll({
      projectName: selectedProject?.name ?? '',
      baubeginn: selectedProject?.baubeginn ?? null,
      fertigstellung: selectedProject?.fertigstellung ?? null,
      ort,
      datum,
      letterhead,
      points: selectedPoints,
      attachmentsByPointId,
    })
    setReportSelection([])
    setReportPointsOverride(null)
  }

  // Vom Sidebar-Export ausgeloest: "Abnahmeprotokoll" als Vorlage gewaehlt ->
  // die gefilterten Tickets der ausgewaehlten Plaene laden und den bestehenden
  // Abnahmeprotokoll-Dialog (Ort/Datum) damit vorbelegt oeffnen.
  async function handleExportAbnahmeprotokoll(planIds: string[]) {
    const allPoints: PointWithPlan[] = []
    for (const planId of planIds) {
      const plan = plans.find((p) => p.id === planId)
      const planPoints = await sichtbareTicketsDesPlans(planId)
      allPoints.push(...planPoints.map((p) => ({ ...p, plan_name: p.plan_name ?? plan?.name ?? null })))
    }
    if (allPoints.length === 0) {
      throw new Error('Keine Tickets im aktuellen Filter — nichts zu exportieren.')
    }
    setReportPointsOverride(allPoints)
    setReportSelection(allPoints.map((p) => p.id))
    setShowReportDialog(true)
  }

  function handleOverviewSelect(point: PointWithPlan) {
    setShowTicketOverview(false)
    setSelectedPlanId(point.plan_id)
    setPendingPointId(point.id)
  }

  function handleGallerySelect(attachment: AttachmentWithPoint) {
    setShowGallery(false)
    setSelectedPlanId(attachment.plan_id)
    setPendingPointId(attachment.point_id)
  }

  function handleLandingPageNavigate(filters: { status?: string; assignedTo?: string; gewerk?: string; categoryId?: string }) {
    setFilterPlanId('')
    setFilterBauabschnitt('')
    setFilterFrom('')
    setFilterTo('')
    setFilterStatus(filters.status ?? '')
    setFilterAssignedTo(filters.assignedTo ?? '')
    setFilterGewerk(filters.gewerk ?? '')
    setFilterCategoryId(filters.categoryId ?? '')
    setShowGallery(false)
    setShowTicketOverview(true)
  }

  useEffect(() => {
    if (!pendingPointId) return
    const found = points.find((p) => p.id === pendingPointId)
    if (found) {
      setDrawer({ mode: 'edit', point: found })
      setPendingPointId(null)
    }
  }, [points, pendingPointId])

  useEffect(() => {
    if (!isAuthenticated || !selectedPlanId) return
    const disconnect = connectPlanSocket(selectedPlanId, (event) => {
      if (event.type === 'point.created') {
        setPoints((prev) => (prev.some((p) => p.id === event.point.id) ? prev : [...prev, event.point]))
      } else if (event.type === 'point.updated') {
        setPoints((prev) => prev.map((p) => (p.id === event.point.id ? event.point : p)))
      } else if (event.type === 'point.deleted') {
        setPoints((prev) => prev.filter((p) => p.id !== event.pointId))
      }
    })
    return disconnect
  }, [selectedPlanId, isAuthenticated])

  async function handleCreateProject(input: CreateProjectInput): Promise<boolean> {
    setCreateProjectStatus('Lege an…')
    try {
      const project = await createProject(input)
      setProjects((prev) => [project, ...prev])
      setSelectedProjectId(project.id)
      setCreateProjectStatus('')
      return true
    } catch (err) {
      if (!handleAuthError(err)) setCreateProjectStatus(`Fehler: ${err}`)
      return false
    }
  }

  async function handleAddMember(email: string) {
    if (!selectedProjectId) return
    setMemberStatus('Füge hinzu…')
    try {
      await addProjectMember(selectedProjectId, email)
      setMemberStatus('')
      listProjectMembers(selectedProjectId).then(setMembers)
    } catch (err) {
      setMemberStatus(`Fehler: ${err instanceof Error ? err.message : err}`)
    }
  }

  async function handleRemoveMember(userId: string) {
    if (!selectedProjectId) return
    await removeProjectMember(selectedProjectId, userId)
    const aktuell = await listProjectMembers(selectedProjectId)
    setMembers(aktuell)
  }

  // Gibt zurueck, ob es geklappt hat. Der Aufrufer muss das wissen: schliesst
  // er das Formular auch im Fehlerfall, verschwindet die Meldung mit ihm, denn
  // sie wird innerhalb des Formulars angezeigt.
  async function handleUploadPlan(name: string, file: File): Promise<boolean> {
    if (!selectedProjectId) return false
    setPlanUploadStatus('Lädt hoch…')
    try {
      const plan = await uploadPlan(selectedProjectId, name, file)
      setPlans((prev) => [plan, ...prev])
      setSelectedPlanId(plan.id)
      setPlanUploadStatus('')
      return true
    } catch (err) {
      setPlanUploadStatus(`Fehler: ${err instanceof Error ? err.message : err}`)
      return false
    }
  }

  /**
   * Die Tickets eines Plans, so wie sie unter den aktuellen Filtern sichtbar
   * sind - fuer die Anzeige *und* fuer jede Ausgabe.
   *
   * Diese eine Funktion zu haben ist der Kern der Sache: solange Ansicht und
   * Export ueber verschiedene Wege luden, konnten sie verschiedene Mengen
   * zeigen, und genau das taten sie auch.
   */
  async function sichtbareTicketsDesPlans(planId: string): Promise<PointWithPlan[]> {
    if (!selectedProjectId) return []
    return listVisiblePlanPoints(selectedProjectId, planId, currentFilters)
  }

  async function handleExportPlans(
    planIds: string[],
    includeTicketPages: boolean,
    ticketTemplateId?: string
  ): Promise<string> {
    const entries = []
    for (const planId of planIds) {
      const plan = plans.find((p) => p.id === planId)
      if (!plan) continue
      const planPoints = await sichtbareTicketsDesPlans(planId)
      let attachmentsByPointId: Record<string, Attachment[]> | undefined
      if (includeTicketPages) {
        attachmentsByPointId = {}
        for (const point of planPoints) {
          attachmentsByPointId[point.id] = await listAttachments(point.id)
        }
      }
      entries.push({ plan, points: planPoints, attachmentsByPointId })
    }
    const vorlage = ticketTemplateId
      ? exportTemplates.find((v) => v.id === ticketTemplateId)
      : undefined
    // Die Anzeigenamen der frei definierten Felder kommen aus derselben Quelle
    // wie im Vorlagen-Editor.
    const feldLabels: Record<string, string> = {}
    if (vorlage) {
      for (const feld of await listFieldSuggestions().catch(() => [])) {
        feldLabels[feld.key] = feld.label
      }
    }

    return exportPlansToPdf(entries, {
      includeTicketPages,
      categories,
      users,
      ticketSpalten: vorlage ? leseSpalten(vorlage.columns_json) : undefined,
      feldLabels,
      planNameById: Object.fromEntries(plans.map((p) => [p.id, p.name])),
    })
  }

  async function handleExportCsv(templateId?: string): Promise<string> {
    if (!selectedProjectId) return 'Kein Projekt ausgewählt.'
    try {
      await downloadPointsCsv(selectedProjectId, currentFilters, templateId)
      return ''
    } catch (err) {
      return `Fehler: ${err instanceof Error ? err.message : err}`
    }
  }

  function refreshExportTemplates(projectId: string) {
    listExportTemplates(projectId)
      .then(setExportTemplates)
      .catch(() => setExportTemplates([]))
  }

  function handleCanvasClick(relX: number, relY: number) {
    setDrawer({ mode: 'create', x: relX, y: relY })
  }

  function handlePointClick(point: Point) {
    setDrawer({ mode: 'edit', point })
  }

  async function handleSaveTicket(input: TicketFormInput) {
    if (!drawer || !selectedPlanId) return
    try {
      if (drawer.mode === 'create') {
        const created = await createPoint({
          id: genId(),
          planId: selectedPlanId,
          x: drawer.x,
          y: drawer.y,
          title: input.title,
          description: input.description,
          categoryId: input.categoryId,
          customFields: input.customFields,
          bauabschnitt: input.bauabschnitt,
          priority: input.priority,
          assignedTo: input.assignedTo,
          dueDate: input.dueDate,
          gewerk: input.gewerk,
          raumBereich: input.raumBereich,
        })
        if (input.stagedFiles?.length && navigator.onLine) {
          for (const file of input.stagedFiles) {
            await uploadAttachment(created.id, file).catch((err) =>
              setActionError(`Anlage "${file.name}" konnte nicht hochgeladen werden: ${err}`)
            )
          }
        }
      } else {
        const result = await updatePoint(drawer.point.id, {
          title: input.title,
          description: input.description,
          categoryId: input.categoryId,
          customFields: input.customFields,
          bauabschnitt: input.bauabschnitt,
          status: input.status,
          priority: input.priority,
          assignedTo: input.assignedTo,
          dueDate: input.dueDate,
          gewerk: input.gewerk,
          raumBereich: input.raumBereich,
          version: drawer.point.version,
          planId: selectedPlanId,
        })
        if (result.conflict) {
          const who = result.previousValue?.updated_by ?? 'einem anderen Nutzer'
          setConflictWarning(
            `Dieser Punkt wurde inzwischen von ${who} geändert. Deine Änderung wurde trotzdem übernommen — der vorherige Stand ("${result.previousValue?.title}") ist im Verlauf nachvollziehbar.`
          )
        }
      }
      refreshPoints(selectedPlanId)
      refreshPendingCount()
      setDrawer(null)
    } catch (err) {
      if (!handleAuthError(err)) setActionError(`Ticket konnte nicht gespeichert werden: ${err}`)
    }
  }

  async function handleDeleteTicket() {
    if (!drawer || drawer.mode !== 'edit' || !selectedPlanId) return
    try {
      await deletePoint(drawer.point.id, selectedPlanId)
      refreshPoints(selectedPlanId)
      refreshPendingCount()
      setDrawer(null)
    } catch (err) {
      if (!handleAuthError(err)) setActionError(`Ticket konnte nicht gelöscht werden: ${err}`)
    }
  }

  if (!isAuthenticated) {
    return (
      <LoginForm
        onLoggedIn={() => {
          setIsAuthenticated(true)
          setCurrentUser(getCurrentUser())
        }}
      />
    )
  }

  const selectedProject = projects.find((p) => p.id === selectedProjectId)
  const canAccessAdminMenu = currentUser?.role === 'admin'

  return (
    <div className="app-shell">
      <TopBar
        projectName={selectedProject?.name}
        isOnline={isOnline}
        pendingCount={pendingCount}
        onSync={handleSync}
        onLogout={() => {
          logout()
          setIsAuthenticated(false)
          setCurrentUser(null)
        }}
        canAccessAdminMenu={canAccessAdminMenu}
        onOpenAdminMenu={() => setAdminMenuOpen(true)}
        onOpenBenachrichtigungen={() => setBenachrichtigungenOffen(true)}
        navigationSichtbar={navigationSichtbar}
        onToggleSidebar={() => setNavigationSichtbar((v) => !v)}
      />

      <div className="app-body">
        {/* Fangflaeche, um die ausgefahrene Leiste wieder zu schliessen. Nur
            unterhalb des Umbruchpunkts sichtbar (siehe .sidebar-backdrop). */}
        {navigationSichtbar && (
          <button
            type="button"
            className="sidebar-backdrop nur-mobil"
            aria-label="Navigation schließen"
            onClick={() => setNavigationSichtbar(false)}
          />
        )}
        <Sidebar
          istSichtbar={navigationSichtbar}
          onNavigiert={() => {
            // Nur am Smartphone im Weg: dort liegt die Leiste ueber dem Inhalt,
            // den man gerade aufgerufen hat. Am Rechner bleibt sie stehen.
            if (istSchmalerBildschirm()) setNavigationSichtbar(false)
          }}
          projects={projects}
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
          onCreateProject={handleCreateProject}
          createProjectStatus={createProjectStatus}
          plans={plans}
          planFolders={planFolders}
          onFoldersChanged={() => selectedProjectId && refreshPlanFolders(selectedProjectId)}
          onPlanMoved={(updated) => setPlans((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))}
          selectedPlanId={selectedPlanId}
          onSelectPlan={(id) => {
            setShowTicketOverview(false)
            setShowGallery(false)
            setSelectedPlanId(id)
          }}
          onUploadPlan={handleUploadPlan}
          planUploadStatus={planUploadStatus}
          dashboardActive={!selectedPlanId && !showTicketOverview && !showGallery}
          onShowDashboard={() => {
            setSelectedPlanId(null)
            setShowTicketOverview(false)
            setShowGallery(false)
          }}
          ticketOverviewActive={showTicketOverview}
          onShowTicketOverview={() => {
            setShowTicketOverview(true)
            setShowGallery(false)
          }}
          galleryActive={showGallery}
          onShowGallery={() => {
            setShowGallery(true)
            setShowTicketOverview(false)
          }}
          onExportPlans={handleExportPlans}
          onExportAbnahmeprotokoll={handleExportAbnahmeprotokoll}
          onExportCsv={handleExportCsv}
          exportTemplates={exportTemplates}
          onOpenSettings={() => setSettingsOpen(true)}
          onMakeOffline={handleMakeOffline}
          offlineStatus={offlineStatus}
          isOnline={isOnline}
        />

        <main className="app-main">
          {!selectedProjectId && (
            <Dashboard projects={projects} stats={projectStats} onSelectProject={setSelectedProjectId} />
          )}

          {selectedProjectId && showTicketOverview && (
            <>
              <div className="toolbar">
                <span className="toolbar-title">Alle Tickets ({overviewPoints.length})</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm nur-mobil"
                  onClick={() => setFilterOffen((v) => !v)}
                >
                  {filterOffen ? 'Filter ausblenden' : 'Filter'}
                </button>
                <div className={`toolbar-filter ${filterOffen ? 'ist-offen' : ''}`}>
                <input
                  value={filterBauabschnitt}
                  onChange={(e) => setFilterBauabschnitt(e.target.value)}
                  placeholder="Bauabschnitt"
                  aria-label="Nach Bauabschnitt filtern"
                  style={{ width: 140 }}
                />
                <input
                  type="date"
                  value={filterFrom}
                  onChange={(e) => setFilterFrom(e.target.value)}
                  title="Erstellt ab"
                  aria-label="Erstellt ab"
                />
                <input
                  type="date"
                  value={filterTo}
                  onChange={(e) => setFilterTo(e.target.value)}
                  title="Erstellt bis"
                  aria-label="Erstellt bis"
                />
                <select
                  value={filterPlanId}
                  onChange={(e) => setFilterPlanId(e.target.value)}
                  aria-label="Nach Zeichnung filtern"
                >
                  <option value="">Zeichnung: alle</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  aria-label="Nach Status filtern"
                >
                  <option value="">Status: alle</option>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  value={filterAssignedTo}
                  onChange={(e) => setFilterAssignedTo(e.target.value)}
                  aria-label="Nach Zuständigem filtern"
                >
                  <option value="">Zuständig: alle</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.display_name}
                    </option>
                  ))}
                </select>
                <input
                  value={filterGewerk}
                  onChange={(e) => setFilterGewerk(e.target.value)}
                  placeholder="Gewerk"
                  aria-label="Nach Gewerk filtern"
                  style={{ width: 120 }}
                />
                <select
                  value={filterCategoryId}
                  onChange={(e) => setFilterCategoryId(e.target.value)}
                  aria-label="Nach Kategorie filtern"
                >
                  <option value="">Kategorie: alle</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setFilterPlanId('')
                    setFilterBauabschnitt('')
                    setFilterFrom('')
                    setFilterTo('')
                    setFilterStatus('')
                    setFilterAssignedTo('')
                    setFilterGewerk('')
                    setFilterCategoryId('')
                  }}
                >
                  Filter zurücksetzen
                </button>
                </div>
                {/* Export-Schaltflaechen entfallen hier: saemtliche Ausgaben
                    laufen jetzt ueber den Export-Bereich in der Baumleiste und
                    richten sich nach den hier gesetzten Filtern. */}
              </div>
              <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
                <TicketOverview
                  points={overviewPoints}
                  categories={categories}
                  users={users}
                  onSelect={handleOverviewSelect}
                />
              </div>
            </>
          )}

          {showReportDialog && (
            <AbnahmeprotokollDialog
              ticketCount={reportSelection.length}
              onConfirm={handleGenerateReport}
              onClose={() => setShowReportDialog(false)}
            />
          )}

          {selectedProjectId && showGallery && (
            <ProjectGallery
              projectId={selectedProjectId}
              categories={categories}
              plans={plans}
              users={users}
              onSelectAttachment={handleGallerySelect}
            />
          )}

          {selectedProjectId && !selectedPlanId && !showTicketOverview && !showGallery && (
            <ProjectLandingPage
              projectId={selectedProjectId}
              categories={categories}
              users={users}
              onNavigateFiltered={handleLandingPageNavigate}
            />
          )}

          {selectedPlanId && !showTicketOverview && !showGallery && (
            <>
              <div className="toolbar">
                <span className="toolbar-title">{plans.find((p) => p.id === selectedPlanId)?.name}</span>
                {/* Plan und Ticketliste haben auf schmalen Bildschirmen
                    nebeneinander keinen Platz - hier wird umgeschaltet. */}
                <span className="nur-mobil ansicht-umschalter">
                  <button
                    type="button"
                    className={`btn btn-sm ${mobilAnsicht === 'plan' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setMobilAnsicht('plan')}
                  >
                    Plan
                  </button>
                  <button
                    type="button"
                    className={`btn btn-sm ${mobilAnsicht === 'tickets' ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setMobilAnsicht('tickets')}
                  >
                    Tickets ({points.length})
                  </button>
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm nur-mobil"
                  onClick={() => setFilterOffen((v) => !v)}
                >
                  {filterOffen ? 'Filter ausblenden' : 'Filter'}
                </button>
                <div className={`toolbar-filter ${filterOffen ? 'ist-offen' : ''}`}>
                <input
                  value={filterBauabschnitt}
                  onChange={(e) => setFilterBauabschnitt(e.target.value)}
                  placeholder="Bauabschnitt"
                  aria-label="Nach Bauabschnitt filtern"
                  style={{ width: 140 }}
                />
                <input
                  type="date"
                  value={filterFrom}
                  onChange={(e) => setFilterFrom(e.target.value)}
                  title="Erstellt ab"
                  aria-label="Erstellt ab"
                />
                <input
                  type="date"
                  value={filterTo}
                  onChange={(e) => setFilterTo(e.target.value)}
                  title="Erstellt bis"
                  aria-label="Erstellt bis"
                />
                <select
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  aria-label="Nach Status filtern"
                >
                  <option value="">Status: alle</option>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <select
                  value={filterAssignedTo}
                  onChange={(e) => setFilterAssignedTo(e.target.value)}
                  aria-label="Nach Zuständigem filtern"
                >
                  <option value="">Zuständig: alle</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.display_name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => {
                    setFilterBauabschnitt('')
                    setFilterFrom('')
                    setFilterTo('')
                    setFilterStatus('')
                    setFilterAssignedTo('')
                  }}
                >
                  Filter zurücksetzen
                </button>
                </div>
              </div>

              <div className={`plan-workspace ${mobilAnsicht === 'plan' ? 'zeigt-plan' : 'zeigt-tickets'}`}>
                <div className="plan-canvas-area">
                  <PdfViewer
                    fileUrl={planFileUrl(selectedPlanId)}
                    points={points}
                    categories={categories}
                    selectedPointId={drawer?.mode === 'edit' ? drawer.point.id : undefined}
                    onCanvasClick={handleCanvasClick}
                    onPointClick={handlePointClick}
                    seitenzahl={plans.find((p) => p.id === selectedPlanId)?.page_count}
                  />
                </div>
                <div className={`plan-ticket-panel ${ticketleisteSichtbar ? '' : 'ist-verborgen'}`}>
                  <div className="plan-ticket-panel-header">
                    <span>Tickets ({points.length})</span>
                    <button
                      type="button"
                      className="icon-btn nur-rechner"
                      onClick={() => setTicketleisteSichtbar(false)}
                      title="Ticketliste ausblenden"
                      aria-label="Ticketliste ausblenden"
                    >
                      <Zeichen name="chevron-rechts" groesse={14} />
                    </button>
                  </div>
                  <TicketList points={points} categories={categories} users={users} onSelect={handlePointClick} />
                </div>
                {/* Griff zum Wiederöffnen. Er sitzt im Arbeitsbereich, nicht in
                    der Leiste — die ist ja gerade auf Breite null. */}
                {!ticketleisteSichtbar && (
                  <button
                    type="button"
                    className="leisten-griff nur-rechner"
                    onClick={() => setTicketleisteSichtbar(true)}
                    title="Ticketliste einblenden"
                    aria-label="Ticketliste einblenden"
                  >
                    <Zeichen name="chevron-links" groesse={14} />
                  </button>
                )}
              </div>
            </>
          )}
        </main>
      </div>

      {/* Der Commit steht bewusst mit dabei: ohne ihn liesz sich eine gemeldete
          Beobachtung nicht dem Stand zuordnen, aus dem sie stammt. Vercel
          vergibt je Commit eine eigene Preview-Adresse, und eine gemerkte
          aeltere zeigt dauerhaft alten Code. */}
      <footer className="app-footer">
        POI-App v{__APP_VERSION__} · Stand{' '}
        {new Date(__BUILD_DATE__).toLocaleDateString('de-DE')} ·{' '}
        <span title="Commit, aus dem dieses Bündel gebaut wurde">{__BUILD_COMMIT__}</span>
      </footer>

      {drawer && (
        <TicketDrawer
          mode={drawer.mode}
          point={drawer.mode === 'edit' ? drawer.point : undefined}
          categories={categories}
          users={users}
          isOnline={isOnline}
          onSave={handleSaveTicket}
          onDelete={drawer.mode === 'edit' ? handleDeleteTicket : undefined}
          onClose={() => setDrawer(null)}
        />
      )}

      {settingsOpen && selectedProjectId && (
        <ProjectSettingsPanel
          projectId={selectedProjectId}
          project={selectedProject}
          categories={categories}
          members={members}
          users={users}
          onAddMember={handleAddMember}
          memberStatus={memberStatus}
          onCategoryCreated={() => refreshCategories(selectedProjectId)}
          onProjectUpdated={(updated) => setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))}
          onClose={() => setSettingsOpen(false)}
          canDelete={currentUser?.role === 'admin'}
          canManageMembers={currentUser?.role === 'admin'}
          onExportTemplatesChanged={() => refreshExportTemplates(selectedProjectId)}
          onRemoveMember={handleRemoveMember}
          onArchiveProject={async () => {
            await archiveProject(selectedProjectId)
            // Aus der Liste nehmen statt neu zu laden: die Liste der aktiven
            // Projekte enthaelt archivierte ohnehin nicht mehr.
            setProjects((prev) => prev.filter((p) => p.id !== selectedProjectId))
            setSettingsOpen(false)
            setSelectedProjectId(null)
          }}
        />
      )}

      {adminMenuOpen && (
        <AdminMenu
          users={users}
          templates={templates}
          projects={projects}
          onUserCreated={() => listUsers().then(setUsers)}
          onTemplatesChanged={refreshTemplates}
          onProjectsChanged={() => {
            listProjects().then(setProjects)
            // Ein archiviertes oder geloeschtes Projekt darf nicht ausgewaehlt
            // bleiben - die Ansicht zeigte sonst Daten, die es nicht mehr gibt.
            setSelectedProjectId((bisher) => {
              if (!bisher) return bisher
              return projects.some((p) => p.id === bisher) ? bisher : null
            })
          }}
          onClose={() => setAdminMenuOpen(false)}
        />
      )}

      {benachrichtigungenOffen && (
        <BenachrichtigungenDialog
          aktiv={currentUser?.emailBenachrichtigungen !== false}
          onGeaendert={(aktiv) =>
            setCurrentUser((bisher) => (bisher ? { ...bisher, emailBenachrichtigungen: aktiv } : bisher))
          }
          onClose={() => setBenachrichtigungenOffen(false)}
        />
      )}

      {/* Die drei Meldungen lagen alle auf derselben festen Position und damit
          deckungsgleich uebereinander - waren mehrere aktiv, sah man nur eine.
          Der Stapel setzt sie untereinander. */}
      {(syncStatus || conflictWarning || actionError) && (
        <div className="toast-stack">
          {syncStatus && (
            <div className="toast">
              {syncStatus}
              <button
                type="button"
                className="icon-btn"
                onClick={() => setSyncStatus('')}
                aria-label="Meldung schließen"
                title="Meldung schließen"
              >
                <Zeichen name="schliessen" groesse={14} />
              </button>
            </div>
          )}
          {conflictWarning && (
            <div className="toast">
              {conflictWarning}
              <button
                type="button"
                className="icon-btn"
                onClick={() => setConflictWarning(null)}
                aria-label="Meldung schließen"
                title="Meldung schließen"
              >
                <Zeichen name="schliessen" groesse={14} />
              </button>
            </div>
          )}
          {actionError && (
            <div className="toast">
              {actionError}
              <button
                type="button"
                className="icon-btn"
                onClick={() => setActionError(null)}
                aria-label="Meldung schließen"
                title="Meldung schließen"
              >
                <Zeichen name="schliessen" groesse={14} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default App
