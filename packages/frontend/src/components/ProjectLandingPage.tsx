import { useEffect, useState } from 'react'
import type { Category } from '@poi-app/shared'
import { listProjectPoints, type PointWithPlan, type UserSummary } from '../api/client'
import { STATUS_LABELS } from '../constants'

interface ProjectLandingPageProps {
  projectId: string
  categories: Category[]
  users: UserSummary[]
  onNavigateFiltered: (filters: { status?: string; assignedTo?: string; gewerk?: string; categoryId?: string }) => void
}

const OPEN_STATUSES = new Set(['open', 'in_bearbeitung', 'geprueft'])

interface GroupRow {
  key: string
  label: string
  count: number
}

function groupBy(points: PointWithPlan[], keyFn: (p: PointWithPlan) => string | null, labelFn: (key: string) => string): GroupRow[] {
  const counts = new Map<string, number>()
  for (const p of points) {
    const key = keyFn(p) ?? '__none__'
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return [...counts.entries()]
    .map(([key, count]) => ({ key, label: key === '__none__' ? 'Ohne Angabe' : labelFn(key), count }))
    .sort((a, b) => b.count - a.count)
}

function Panel({
  title,
  rows,
  onSelect,
}: {
  title: string
  rows: GroupRow[]
  onSelect: (key: string) => void
}) {
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <div className="card" style={{ padding: 14, flex: '1 1 260px', minWidth: 260 }}>
      <h4 style={{ marginBottom: 10 }}>{title}</h4>
      {rows.length === 0 && <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Keine Tickets</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {rows.map((row) => (
          <button
            key={row.key}
            type="button"
            onClick={() => row.key !== '__none__' && onSelect(row.key)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'none',
              border: 'none',
              padding: 0,
              cursor: row.key === '__none__' ? 'default' : 'pointer',
              textAlign: 'left',
            }}
            title={row.key === '__none__' ? undefined : `Nach "${row.label}" filtern`}
          >
            <span style={{ width: 110, fontSize: 12.5, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {row.label}
            </span>
            <span style={{ flex: 1, background: 'var(--color-border)', borderRadius: 4, height: 14, position: 'relative' }}>
              <span
                style={{
                  display: 'block',
                  height: '100%',
                  width: `${(row.count / max) * 100}%`,
                  background: 'var(--color-primary)',
                  borderRadius: 4,
                }}
              />
            </span>
            <span style={{ width: 24, fontSize: 12.5, textAlign: 'right' }}>{row.count}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export function ProjectLandingPage({ projectId, categories, users, onNavigateFiltered }: ProjectLandingPageProps) {
  const [points, setPoints] = useState<PointWithPlan[]>([])

  useEffect(() => {
    listProjectPoints(projectId).then(setPoints)
  }, [projectId])

  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const userById = new Map(users.map((u) => [u.id, u]))

  const today = new Date().toISOString().slice(0, 10)
  const overdueCount = points.filter((p) => p.due_date && p.due_date < today && OPEN_STATUSES.has(p.status)).length

  const statusRows = groupBy(points, (p) => p.status, (key) => STATUS_LABELS[key] ?? key)
  const gewerkRows = groupBy(points, (p) => p.gewerk, (key) => key)
  const categoryRows = groupBy(points, (p) => p.category_id, (key) => categoryById.get(key)?.name ?? key)
  const assignedRows = groupBy(points, (p) => p.assigned_to, (key) => userById.get(key)?.display_name ?? key)

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16 }}>
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>Tickets gesamt</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{points.length}</div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div style={{ fontSize: 12.5, color: 'var(--color-text-muted)' }}>Überfällig</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: overdueCount > 0 ? 'var(--color-danger)' : undefined }}>
            {overdueCount}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16 }}>
        <Panel title="Nach Status" rows={statusRows} onSelect={(key) => onNavigateFiltered({ status: key })} />
        <Panel title="Nach Gewerk" rows={gewerkRows} onSelect={(key) => onNavigateFiltered({ gewerk: key })} />
        <Panel title="Nach Kategorie" rows={categoryRows} onSelect={(key) => onNavigateFiltered({ categoryId: key })} />
        <Panel title="Nach Zuständigkeit" rows={assignedRows} onSelect={(key) => onNavigateFiltered({ assignedTo: key })} />
      </div>
    </div>
  )
}
