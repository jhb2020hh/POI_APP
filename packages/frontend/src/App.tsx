import { useEffect, useState } from 'react'
import type { Attachment, Category, Plan, PlanFolder, Point, PointStats, Project } from '@poi-app/shared'
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
  deleteProject,
  listGlobalCategories,
  listPlanFolders,
  listPlans,
  listPoints,
  listProjectMembers,
  listProjectPoints,
  listProjects,
  listProjectStats,
  listUsers,
  logout,
  makeProjectAvailableOffline,
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
import { STATUS_LABELS } from './constants'
import { genId } from './utils/id'
import { exportPlansToPdf } from './utils/planExportPdf'
import { exportAbnahmeprotokoll } from './utils/abnahmeprotokollExport'
import { AbnahmeprotokollDialog } from './components/AbnahmeprotokollDialog'
import { getLetterhead } from './api/client'
import './App.css'

type DrawerState = { mode: 'create'; x: number; y: number } | { mode: 'edit'; point: Point }

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(() => Boolean(getToken()))
  const [currentUser, setCurrentUser] = useState(() => getCurrentUser())
  const [adminMenuOpen, setAdminMenuOpen] = useState(false)
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
      return
    }
    listProjectMembers(selectedProjectId)
      .then(setMembers)
      .catch((err) => {
        if (!handleAuthError(err)) throw err
      })
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

  const currentFilters: PointFilters = {
    planId: filterPlanId || undefined,
    bauabschnitt: filterBauabschnitt || undefined,
    from: filterFrom || undefined,
    to: filterTo || undefined,
    status: filterStatus || undefined,
    assignedTo: filterAssignedTo || undefined,
    gewerk: filterGewerk || undefined,
    categoryId: filterCategoryId || undefined,
  }

  useEffect(() => {
    if (!isAuthenticated) return
    if (selectedPlanId) {
      refreshPoints(selectedPlanId)
    } else {
      setPoints([])
    }
    setDrawer(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPlanId, isAuthenticated, filterBauabschnitt, filterFrom, filterTo, filterStatus, filterAssignedTo])

  function refreshPoints(planId: string) {
    listPoints(planId, currentFilters)
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
  }, [
    selectedProjectId,
    showTicketOverview,
    isAuthenticated,
    filterPlanId,
    filterBauabschnitt,
    filterFrom,
    filterTo,
    filterStatus,
    filterAssignedTo,
    filterGewerk,
    filterCategoryId,
  ])

  const [pendingPointId, setPendingPointId] = useState<string | null>(null)
  const [reportSelection, setReportSelection] = useState<string[]>([])
  const [showReportDialog, setShowReportDialog] = useState(false)
  const [reportPointsOverride, setReportPointsOverride] = useState<PointWithPlan[] | null>(null)

  function toggleReportSelection(id: string) {
    setReportSelection((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

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
  // alle Tickets der ausgewaehlten Plaene laden und den bestehenden
  // Abnahmeprotokoll-Dialog (Ort/Datum) damit vorbelegt oeffnen.
  async function handleExportAbnahmeprotokoll(planIds: string[]) {
    const allPoints: PointWithPlan[] = []
    for (const planId of planIds) {
      const plan = plans.find((p) => p.id === planId)
      const planPoints = await listPoints(planId)
      allPoints.push(...planPoints.map((p) => ({ ...p, plan_name: plan?.name ?? null })))
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
      setMemberStatus(`Fehler: ${err}`)
    }
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

  async function handleExportPlans(planIds: string[], includeTicketPages: boolean): Promise<string> {
    const entries = []
    for (const planId of planIds) {
      const plan = plans.find((p) => p.id === planId)
      if (!plan) continue
      const planPoints = await listPoints(planId)
      let attachmentsByPointId: Record<string, Attachment[]> | undefined
      if (includeTicketPages) {
        attachmentsByPointId = {}
        for (const point of planPoints) {
          attachmentsByPointId[point.id] = await listAttachments(point.id)
        }
      }
      entries.push({ plan, points: planPoints, attachmentsByPointId })
    }
    return exportPlansToPdf(entries, { includeTicketPages, categories, users })
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
      />

      <div className="app-body">
        <Sidebar
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
                <input
                  value={filterBauabschnitt}
                  onChange={(e) => setFilterBauabschnitt(e.target.value)}
                  placeholder="Bauabschnitt"
                  style={{ width: 140 }}
                />
                <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} title="von" />
                <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} title="bis" />
                <select value={filterPlanId} onChange={(e) => setFilterPlanId(e.target.value)}>
                  <option value="">Zeichnung: alle</option>
                  {plans.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                  <option value="">Status: alle</option>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <select value={filterAssignedTo} onChange={(e) => setFilterAssignedTo(e.target.value)}>
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
                  style={{ width: 120 }}
                />
                <select value={filterCategoryId} onChange={(e) => setFilterCategoryId(e.target.value)}>
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
                <div className="toolbar-spacer" />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    downloadPointsCsv(selectedProjectId, currentFilters).catch((err) =>
                      setSyncStatus(`CSV-Export fehlgeschlagen: ${err}`)
                    )
                  }}
                >
                  CSV-Export
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  disabled={reportSelection.length === 0}
                  onClick={() => setShowReportDialog(true)}
                >
                  Abnahmeprotokoll erstellen ({reportSelection.length})
                </button>
              </div>
              <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
                <TicketOverview
                  points={overviewPoints}
                  categories={categories}
                  users={users}
                  onSelect={handleOverviewSelect}
                  selectedIds={reportSelection}
                  onToggleSelect={toggleReportSelection}
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
                <input
                  value={filterBauabschnitt}
                  onChange={(e) => setFilterBauabschnitt(e.target.value)}
                  placeholder="Bauabschnitt"
                  style={{ width: 140 }}
                />
                <input type="date" value={filterFrom} onChange={(e) => setFilterFrom(e.target.value)} title="von" />
                <input type="date" value={filterTo} onChange={(e) => setFilterTo(e.target.value)} title="bis" />
                <select value={filterStatus} onChange={(e) => setFilterStatus(e.target.value)}>
                  <option value="">Status: alle</option>
                  {Object.entries(STATUS_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
                <select value={filterAssignedTo} onChange={(e) => setFilterAssignedTo(e.target.value)}>
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
                <div className="toolbar-spacer" />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    if (!selectedProjectId) return
                    downloadPointsCsv(selectedProjectId, { ...currentFilters, planId: selectedPlanId }).catch((err) =>
                      setSyncStatus(`CSV-Export fehlgeschlagen: ${err}`)
                    )
                  }}
                >
                  CSV-Export
                </button>
              </div>

              <div className="plan-workspace">
                <div className="plan-canvas-area">
                  <PdfViewer
                    fileUrl={planFileUrl(selectedPlanId)}
                    points={points}
                    categories={categories}
                    plan={plans.find((p) => p.id === selectedPlanId)}
                    users={users}
                    selectedPointId={drawer?.mode === 'edit' ? drawer.point.id : undefined}
                    onCanvasClick={handleCanvasClick}
                    onPointClick={handlePointClick}
                  />
                </div>
                <div className="plan-ticket-panel">
                  <div className="plan-ticket-panel-header">Tickets ({points.length})</div>
                  <TicketList points={points} categories={categories} users={users} onSelect={handlePointClick} />
                </div>
              </div>
            </>
          )}
        </main>
      </div>

      <footer className="app-footer">
        POI-App v{__APP_VERSION__} · Stand {new Date(__BUILD_DATE__).toLocaleDateString('de-DE')}
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
          onDeleteProject={async () => {
            await deleteProject(selectedProjectId)
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
          onUserCreated={() => listUsers().then(setUsers)}
          onTemplatesChanged={refreshTemplates}
          onClose={() => setAdminMenuOpen(false)}
        />
      )}

      {syncStatus && (
        <div className="toast">
          {syncStatus}
          <button type="button" className="icon-btn" onClick={() => setSyncStatus('')}>
            ✕
          </button>
        </div>
      )}

      {conflictWarning && (
        <div className="toast">
          {conflictWarning}
          <button type="button" className="icon-btn" onClick={() => setConflictWarning(null)}>
            ✕
          </button>
        </div>
      )}

      {actionError && (
        <div className="toast">
          {actionError}
          <button type="button" className="icon-btn" onClick={() => setActionError(null)}>
            ✕
          </button>
        </div>
      )}
    </div>
  )
}

export default App
