import { useState } from 'react'
import type { Category, Project } from '@poi-app/shared'
import type { ProjectMember, UserSummary } from '../api/client'
import { updateProjectDates } from '../api/client'
import { CategoryAdmin } from './CategoryAdmin'
import { CategoryBadge } from './ui/Badge'

interface ProjectSettingsPanelProps {
  projectId: string
  project?: Project
  categories: Category[]
  members: ProjectMember[]
  users: UserSummary[]
  onAddMember: (email: string) => Promise<void>
  memberStatus: string
  onCategoryCreated: () => void
  onProjectUpdated: (project: Project) => void
  onClose: () => void
  canDelete: boolean
  onDeleteProject: () => Promise<void>
}

export function ProjectSettingsPanel({
  projectId,
  project,
  categories,
  members,
  users,
  onAddMember,
  memberStatus,
  onCategoryCreated,
  onProjectUpdated,
  onClose,
  canDelete,
  onDeleteProject,
}: ProjectSettingsPanelProps) {
  const [tab, setTab] = useState<'categories' | 'members' | 'dates'>('categories')
  const [newMemberEmail, setNewMemberEmail] = useState('')
  const [deleteStatus, setDeleteStatus] = useState('')
  const [baubeginn, setBaubeginn] = useState(project?.baubeginn ?? '')
  const [fertigstellung, setFertigstellung] = useState(project?.fertigstellung ?? '')
  const [datesStatus, setDatesStatus] = useState('')

  async function handleSaveDates(e: React.FormEvent) {
    e.preventDefault()
    setDatesStatus('Speichert…')
    try {
      const updated = await updateProjectDates(projectId, {
        baubeginn: baubeginn || null,
        fertigstellung: fertigstellung || null,
      })
      onProjectUpdated(updated)
      setDatesStatus('')
    } catch (err) {
      setDatesStatus(`Fehler: ${err}`)
    }
  }

  async function handleDelete() {
    if (!confirm('Projekt wirklich löschen? Es verschwindet aus allen Ansichten (Daten bleiben in der Datenbank erhalten).')) {
      return
    }
    setDeleteStatus('Löscht…')
    try {
      await onDeleteProject()
    } catch (err) {
      setDeleteStatus(`Fehler: ${err}`)
    }
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault()
    if (!newMemberEmail) return
    await onAddMember(newMemberEmail)
    setNewMemberEmail('')
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Projekt-Einstellungen</h3>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {canDelete && (
              <>
                {deleteStatus && (
                  <span style={{ fontSize: 12, color: 'var(--color-text-muted)' }}>{deleteStatus}</span>
                )}
                <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)' }} onClick={handleDelete}>
                  Projekt löschen
                </button>
              </>
            )}
            <button type="button" className="icon-btn" onClick={onClose} aria-label="Schließen">
              ✕
            </button>
          </div>
        </div>
        <div className="tabs">
          <button
            type="button"
            className={`tab ${tab === 'categories' ? 'active' : ''}`}
            onClick={() => setTab('categories')}
          >
            Kategorien
          </button>
          <button
            type="button"
            className={`tab ${tab === 'members' ? 'active' : ''}`}
            onClick={() => setTab('members')}
          >
            Mitglieder
          </button>
          <button
            type="button"
            className={`tab ${tab === 'dates' ? 'active' : ''}`}
            onClick={() => setTab('dates')}
          >
            Termine
          </button>
        </div>
        <div className="modal-body">
          {tab === 'categories' && (
            <div>
              <div className="field-row" style={{ marginBottom: 12 }}>
                {categories.map((c) => (
                  <CategoryBadge key={c.id} color={c.color} name={c.name} />
                ))}
              </div>
              <CategoryAdmin projectId={projectId} onCreated={onCategoryCreated} />
            </div>
          )}

          {tab === 'members' && (
            <div>
              <form onSubmit={handleAddMember} className="field-row" style={{ marginBottom: 12 }}>
                <input
                  type="email"
                  value={newMemberEmail}
                  onChange={(e) => setNewMemberEmail(e.target.value)}
                  placeholder="E-Mail des Nutzers"
                  style={{ flex: 1 }}
                />
                <button type="submit" className="btn btn-primary btn-sm">
                  Hinzufügen
                </button>
              </form>
              {memberStatus && <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{memberStatus}</p>}
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {members.map((m) => {
                  const user = users.find((u) => u.id === m.user_id)
                  return (
                    <li key={m.user_id} className="card-body" style={{ padding: '8px 12px', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)' }}>
                      {user ? (
                        <>
                          <strong>{user.display_name}</strong> · {user.email} ·{' '}
                          <span className="badge badge-neutral">{user.role}</span>
                        </>
                      ) : (
                        m.user_id
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}

          {tab === 'dates' && (
            <form onSubmit={handleSaveDates}>
              <div className="field-row" style={{ marginBottom: 12 }}>
                <div className="field" style={{ flex: 1 }}>
                  <span className="field-label">Baubeginn</span>
                  <input type="date" value={baubeginn} onChange={(e) => setBaubeginn(e.target.value)} />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <span className="field-label">Fertigstellung</span>
                  <input type="date" value={fertigstellung} onChange={(e) => setFertigstellung(e.target.value)} />
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button type="submit" className="btn btn-primary btn-sm">
                  Speichern
                </button>
                {datesStatus && <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{datesStatus}</span>}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
