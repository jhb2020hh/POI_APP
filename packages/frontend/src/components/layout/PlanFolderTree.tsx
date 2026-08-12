import { useState } from 'react'
import type { Plan, PlanFolder } from '@poi-app/shared'
import {
  createPlanFolder,
  deletePlanFolder,
  movePlanToFolder,
  renamePlanFolder,
} from '../../api/client'

interface PlanFolderTreeProps {
  projectId: string
  plans: Plan[]
  folders: PlanFolder[]
  selectedPlanId: string | null
  onSelectPlan: (id: string) => void
  exportMode: boolean
  exportSelection: string[]
  onToggleExportSelection: (planId: string) => void
  onFoldersChanged: () => void
  onPlanMoved: (plan: Plan) => void
}

export function PlanFolderTree({
  projectId,
  plans,
  folders,
  selectedPlanId,
  onSelectPlan,
  exportMode,
  exportSelection,
  onToggleExportSelection,
  onFoldersChanged,
  onPlanMoved,
}: PlanFolderTreeProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [status, setStatus] = useState('')

  function toggleCollapsed(folderId: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }

  async function handleCreateFolder(parentFolderId: string | null) {
    const name = prompt('Name des neuen Ordners:')
    if (!name) return
    try {
      await createPlanFolder(projectId, name, parentFolderId)
      onFoldersChanged()
    } catch (err) {
      setStatus(`Fehler: ${err}`)
    }
  }

  async function handleRenameFolder(folder: PlanFolder) {
    const name = prompt('Neuer Name:', folder.name)
    if (!name || name === folder.name) return
    try {
      await renamePlanFolder(folder.id, name)
      onFoldersChanged()
    } catch (err) {
      setStatus(`Fehler: ${err}`)
    }
  }

  async function handleDeleteFolder(folder: PlanFolder) {
    if (!confirm(`Ordner "${folder.name}" wirklich löschen?`)) return
    try {
      await deletePlanFolder(folder.id)
      onFoldersChanged()
    } catch (err) {
      setStatus(`Fehler: ${err}`)
    }
  }

  async function handleMovePlan(plan: Plan, folderId: string) {
    try {
      const updated = await movePlanToFolder(plan.id, folderId || null)
      onPlanMoved(updated)
    } catch (err) {
      setStatus(`Fehler: ${err}`)
    }
  }

  function renderPlan(plan: Plan, depth: number) {
    return (
      <li key={plan.id}>
        {exportMode ? (
          <label className="sidebar-item sidebar-plan-item" style={{ cursor: 'pointer', paddingLeft: 12 + depth * 14 }}>
            <input
              type="checkbox"
              checked={exportSelection.includes(plan.id)}
              onChange={() => onToggleExportSelection(plan.id)}
              style={{ marginRight: 6 }}
            />
            <span className="sidebar-item-label">📄 {plan.name}</span>
          </label>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <button
              type="button"
              className={`sidebar-item sidebar-plan-item ${selectedPlanId === plan.id ? 'active' : ''}`}
              onClick={() => onSelectPlan(plan.id)}
              style={{ flex: 1, paddingLeft: 12 + depth * 14 }}
            >
              <span className="sidebar-item-label">📄 {plan.name}</span>
            </button>
            <select
              value={plan.folder_id ?? ''}
              onChange={(e) => handleMovePlan(plan, e.target.value)}
              title="In Ordner verschieben"
              aria-label={`${plan.name} in einen Ordner verschieben`}
              className="baum-griff"
              style={{ width: 26, marginRight: 4 }}
            >
              <option value="">📂</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </li>
    )
  }

  function renderFolder(folder: PlanFolder, depth: number): React.ReactNode {
    const isCollapsed = collapsed.has(folder.id)
    const childFolders = folders.filter((f) => f.parent_folder_id === folder.id)
    const childPlans = plans.filter((p) => p.folder_id === folder.id)
    return (
      <li key={folder.id}>
        <div className="sidebar-item" style={{ paddingLeft: 12 + depth * 14, display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            onClick={() => toggleCollapsed(folder.id)}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', padding: 0, width: 14 }}
            aria-label={isCollapsed ? 'Aufklappen' : 'Zuklappen'}
          >
            {isCollapsed ? '▸' : '▾'}
          </button>
          <span className="sidebar-item-label" style={{ flex: 1 }}>
            📁 {folder.name}
          </span>
          {!exportMode && (
            <>
              <button type="button" className="icon-btn" title="Umbenennen" onClick={() => handleRenameFolder(folder)} style={{ width: 18, height: 18 }}>
                ✏
              </button>
              <button type="button" className="icon-btn" title="Unterordner anlegen" onClick={() => handleCreateFolder(folder.id)} style={{ width: 18, height: 18 }}>
                +
              </button>
              <button type="button" className="icon-btn" title="Löschen" onClick={() => handleDeleteFolder(folder)} style={{ width: 18, height: 18 }}>
                🗑
              </button>
            </>
          )}
        </div>
        {!isCollapsed && (
          <ul className="sidebar-list" style={{ marginBottom: 0 }}>
            {childFolders.map((f) => renderFolder(f, depth + 1))}
            {childPlans.map((p) => renderPlan(p, depth + 1))}
          </ul>
        )}
      </li>
    )
  }

  const rootFolders = folders.filter((f) => f.parent_folder_id === null)
  const rootPlans = plans.filter((p) => p.folder_id === null)

  return (
    <>
      {!exportMode && (
        <div style={{ padding: '2px 8px 6px' }}>
          <button type="button" className="btn btn-ghost-inverse btn-sm" onClick={() => handleCreateFolder(null)}>
            + Ordner
          </button>
        </div>
      )}
      {status && <p className="sidebar-hinweis" style={{ padding: '0 8px' }}>{status}</p>}
      <ul className="sidebar-list">
        {rootFolders.map((f) => renderFolder(f, 0))}
        {rootPlans.map((p) => renderPlan(p, 0))}
      </ul>
    </>
  )
}
