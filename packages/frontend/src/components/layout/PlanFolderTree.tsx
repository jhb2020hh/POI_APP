import { useState } from 'react'
import type { Plan, PlanFolder } from '@poi-app/shared'
import {
  createPlanFolder,
  deletePlanFolder,
  movePlanToFolder,
  renamePlanFolder,
} from '../../api/client'
import { Zeichen } from '../Zeichen'

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
            <Zeichen name="datei" />
            <span className="sidebar-item-label">{plan.name}</span>
          </label>
        ) : (
          <div className="baum-zeile">
            <button
              type="button"
              className={`sidebar-item sidebar-plan-item ${selectedPlanId === plan.id ? 'active' : ''}`}
              onClick={() => onSelectPlan(plan.id)}
              style={{ flex: 1, paddingLeft: 12 + depth * 14 }}
            >
              <Zeichen name="datei" />
              <span className="sidebar-item-label">{plan.name}</span>
            </button>
            {/* Vorher ein 26 px schmales Auswahlfeld, dessen einzige sichtbare
                Beschriftung "📂" war - es sah aus wie eine Eingabe, war aber
                ein Verschiebebefehl. Das native Auswahlfeld bleibt erhalten
                und liegt jetzt unsichtbar ueber den Zeichen: Tastatur,
                Vorleseprogramm und das systemeigene Auswahlfenster bleiben
                damit unveraendert, nur das Aussehen wechselt. Ein selbst
                gebautes Klappmenue muesste all das nachbauen. */}
            <span className="baum-verschieben" title="In Ordner verschieben">
              <Zeichen name="ordner" groesse={14} />
              <Zeichen name="chevron-unten" groesse={10} />
              <select
                value={plan.folder_id ?? ''}
                onChange={(e) => handleMovePlan(plan, e.target.value)}
                aria-label={`${plan.name} in einen Ordner verschieben`}
              >
                <option value="">Kein Ordner</option>
                {folders.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.name}
                  </option>
                ))}
              </select>
            </span>
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
        <div className="sidebar-item baum-ordnerzeile" style={{ paddingLeft: 12 + depth * 14 }}>
          <button
            type="button"
            className="icon-btn icon-btn-klein baum-klappe"
            onClick={() => toggleCollapsed(folder.id)}
            aria-label={isCollapsed ? 'Aufklappen' : 'Zuklappen'}
            aria-expanded={!isCollapsed}
          >
            <Zeichen name={isCollapsed ? 'chevron-rechts' : 'chevron-unten'} groesse={14} />
          </button>
          <Zeichen name="ordner" />
          <span className="sidebar-item-label">{folder.name}</span>
          {!exportMode && (
            <>
              {/* Die Masze standen frueher inline (18 x 18) und schlugen damit
                  sowohl die Knopfgroesze als auch die Touchregel, die bei
                  grober Zeigereingabe auf 44 px anheben soll. */}
              <button
                type="button"
                className="icon-btn icon-btn-klein"
                title={`Ordner "${folder.name}" umbenennen`}
                onClick={() => handleRenameFolder(folder)}
              >
                <Zeichen name="bearbeiten" groesse={14} />
              </button>
              <button
                type="button"
                className="icon-btn icon-btn-klein"
                title={`Unterordner in "${folder.name}" anlegen`}
                onClick={() => handleCreateFolder(folder.id)}
              >
                <Zeichen name="plus" groesse={14} />
              </button>
              <button
                type="button"
                className="icon-btn icon-btn-klein"
                title={`Ordner "${folder.name}" löschen`}
                onClick={() => handleDeleteFolder(folder)}
              >
                <Zeichen name="loeschen" groesse={14} />
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
            <Zeichen name="plus" groesse={14} />
            Ordner
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
