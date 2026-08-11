import type { PointStats, Project } from '@poi-app/shared'

interface DashboardProps {
  projects: Project[]
  stats: PointStats[]
  onSelectProject: (id: string) => void
}

export function Dashboard({ projects, stats, onSelectProject }: DashboardProps) {
  const statsByProject = new Map(stats.map((s) => [s.projectId, s]))

  if (projects.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🏗️</div>
        <div className="empty-state-title">Noch keine Projekte</div>
        <p>Lege links über „+ Neu" dein erstes Projekt an.</p>
      </div>
    )
  }

  return (
    <div className="dashboard">
      <h2 className="dashboard-heading">Projekte</h2>
      <div className="dashboard-grid">
        {projects.map((project) => {
          const s = statsByProject.get(project.id)
          const open = s?.byStatus.open ?? 0
          const inProgress = s?.byStatus.in_bearbeitung ?? 0
          const overdue = s?.overdue ?? 0
          const total = s?.total ?? 0
          return (
            <button
              key={project.id}
              type="button"
              className="card dashboard-card"
              onClick={() => onSelectProject(project.id)}
            >
              <div className="dashboard-card-header">
                <span className="dashboard-card-title">{project.name}</span>
                {(project.project_number || project.customer) && (
                  <span className="dashboard-card-meta">
                    {[project.project_number, project.customer].filter(Boolean).join(' · ')}
                  </span>
                )}
              </div>
              <div className="dashboard-kpis">
                <div className="dashboard-kpi">
                  <span className="dashboard-kpi-value">{open}</span>
                  <span className="dashboard-kpi-label">Offen</span>
                </div>
                <div className="dashboard-kpi">
                  <span className="dashboard-kpi-value">{inProgress}</span>
                  <span className="dashboard-kpi-label">In Bearbeitung</span>
                </div>
                <div className="dashboard-kpi dashboard-kpi-danger">
                  <span className="dashboard-kpi-value">{overdue}</span>
                  <span className="dashboard-kpi-label">Überfällig</span>
                </div>
                <div className="dashboard-kpi">
                  <span className="dashboard-kpi-value">{total}</span>
                  <span className="dashboard-kpi-label">Gesamt</span>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
