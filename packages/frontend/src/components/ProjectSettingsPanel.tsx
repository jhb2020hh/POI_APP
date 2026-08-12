import { useState } from 'react'
import type { Category, Project } from '@poi-app/shared'
import type { ProjectMember, UserSummary } from '../api/client'
import { updateProjectDates } from '../api/client'
import { CategoryAdmin } from './CategoryAdmin'
import { ExportTemplateAdmin } from './ExportTemplateAdmin'
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
  /** Zuordnen und Entfernen sind serverseitig Admins vorbehalten. */
  canManageMembers: boolean
  onRemoveMember: (userId: string) => Promise<void>
  /** Damit das Klappmenü im Exportbereich die neue Vorlage kennt. */
  onExportTemplatesChanged: () => void
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
  canManageMembers,
  onRemoveMember,
  onExportTemplatesChanged,
}: ProjectSettingsPanelProps) {
  const [tab, setTab] = useState<'categories' | 'members' | 'dates' | 'export'>('categories')
  const [newMemberEmail, setNewMemberEmail] = useState('')
  const [removeStatus, setRemoveStatus] = useState('')
  const [bearbeiteteKategorie, setBearbeiteteKategorie] = useState<Category | null>(null)

  // Konten, die dem Projekt noch nicht zugeordnet sind - nur die gehoeren in
  // die Vorschlagsliste.
  const mitgliedIds = new Set(members.map((m) => m.user_id))
  const kandidaten = users.filter((u) => !mitgliedIds.has(u.id))

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
    if (!newMemberEmail.trim()) return
    await onAddMember(newMemberEmail.trim())
    setNewMemberEmail('')
  }

  async function handleRemoveMember(userId: string, name?: string) {
    if (!confirm(`${name ?? 'Dieses Konto'} aus dem Projekt entfernen?`)) return
    setRemoveStatus('')
    try {
      await onRemoveMember(userId)
    } catch (err) {
      setRemoveStatus(`Fehler: ${err instanceof Error ? err.message : err}`)
    }
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
                  <span className="hinweis">{deleteStatus}</span>
                )}
                <button type="button" className="btn btn-ghost btn-ghost-gefahr btn-sm" onClick={handleDelete}>
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
          <button
            type="button"
            className={`tab ${tab === 'export' ? 'active' : ''}`}
            onClick={() => setTab('export')}
          >
            Export
          </button>
        </div>
        <div className="modal-body">
          {tab === 'categories' && (
            <div>
              {/* Vorher standen hier nur Farbschildchen - bearbeiten liess sich
                  nichts. Jede Zeile fuehrt jetzt ins Formular. */}
              <ul className="mitglieder-liste" style={{ marginBottom: 12 }}>
                {categories.map((c) => (
                  <li key={c.id} className="mitglieder-zeile">
                    <CategoryBadge color={c.color} name={c.name} />
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span className="hinweis">
                        {c.project_id === null ? 'zentrale Vorlage' : 'im Projekt angelegt'}
                        {c.short_code ? ` · ${c.short_code}` : ''}
                      </span>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setBearbeiteteKategorie(c)}
                      >
                        Bearbeiten
                      </button>
                    </div>
                  </li>
                ))}
                {categories.length === 0 && (
                  <p className="hinweis">Für dieses Projekt gibt es noch keine Kategorien.</p>
                )}
              </ul>

              {/* key sorgt dafuer, dass das Formular beim Wechsel der Vorlage
                  neu aufgebaut wird - sonst blieben die Felder der zuvor
                  bearbeiteten Kategorie stehen. */}
              <CategoryAdmin
                key={bearbeiteteKategorie?.id ?? 'neu'}
                projectId={projectId}
                category={bearbeiteteKategorie ?? undefined}
                onCancel={() => setBearbeiteteKategorie(null)}
                onCreated={() => {
                  setBearbeiteteKategorie(null)
                  onCategoryCreated()
                }}
              />
            </div>
          )}

          {tab === 'members' && (
            <div>
              <form onSubmit={handleAddMember} className="field-row" style={{ marginBottom: 6 }}>
                {/* Ein Eingabefeld mit Vorschlagsliste statt einer reinen
                    E-Mail-Eingabe: die vorhandenen Konten stehen zur Auswahl,
                    eine noch unbekannte Adresse laesst sich trotzdem eintippen.
                    Dasselbe Muster wie bei den Feldvorschlaegen in
                    CategoryAdmin. */}
                <input
                  list="projekt-mitglied-kandidaten"
                  value={newMemberEmail}
                  onChange={(e) => setNewMemberEmail(e.target.value)}
                  placeholder="Name oder E-Mail auswählen"
                  aria-label="Konto zum Zuordnen auswählen"
                  style={{ flex: 1 }}
                />
                <datalist id="projekt-mitglied-kandidaten">
                  {kandidaten.map((u) => (
                    <option key={u.id} value={u.email}>
                      {u.display_name} · {u.role}
                    </option>
                  ))}
                </datalist>
                <button type="submit" className="btn btn-primary btn-sm" disabled={!newMemberEmail.trim()}>
                  Hinzufügen
                </button>
              </form>
              <p className="hinweis" style={{ marginBottom: 12 }}>
                {kandidaten.length > 0
                  ? `${kandidaten.length} weitere${kandidaten.length === 1 ? 's' : ''} Konto${
                      kandidaten.length === 1 ? '' : 'en'
                    } zur Auswahl.`
                  : 'Alle vorhandenen Konten sind diesem Projekt bereits zugeordnet.'}
              </p>
              {memberStatus && <p className="hinweis">{memberStatus}</p>}
              {removeStatus && <p className="hinweis hinweis-fehler">{removeStatus}</p>}

              {members.length === 0 ? (
                /* Frueher stand hier nichts - eine leere Flaeche liest sich wie
                   ein Fehler. Der Hinweis nennt auch den Grund, warum das
                   Projekt trotzdem sichtbar ist. */
                <p className="hinweis">
                  Diesem Projekt ist noch niemand zugeordnet. Administratoren sehen jedes Projekt
                  auch ohne Zuordnung — alle anderen erst, wenn sie hier eingetragen sind.
                </p>
              ) : (
                <ul className="mitglieder-liste">
                  {members.map((m) => {
                    const user = users.find((u) => u.id === m.user_id)
                    return (
                      <li key={m.user_id} className="mitglieder-zeile">
                        <div>
                          <strong>{user?.display_name ?? 'Unbekanntes Konto'}</strong>
                          <div className="hinweis">{user?.email ?? m.user_id}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          {user && <span className="badge badge-neutral">{user.role}</span>}
                          {canManageMembers && (
                            <button
                              type="button"
                              className="btn btn-ghost btn-ghost-gefahr btn-sm"
                              onClick={() => handleRemoveMember(m.user_id, user?.display_name)}
                            >
                              Entfernen
                            </button>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}

          {tab === 'export' && (
            <ExportTemplateAdmin
              projectId={projectId}
              istAdmin={canManageMembers}
              onChanged={onExportTemplatesChanged}
            />
          )}

          {tab === 'dates' && (
            <form onSubmit={handleSaveDates}>
              <div className="field-row" style={{ marginBottom: 12 }}>
                <label className="field" style={{ flex: 1 }}>
                  <span className="field-label">Baubeginn</span>
                  <input type="date" value={baubeginn} onChange={(e) => setBaubeginn(e.target.value)} />
                </label>
                <label className="field" style={{ flex: 1 }}>
                  <span className="field-label">Fertigstellung</span>
                  <input type="date" value={fertigstellung} onChange={(e) => setFertigstellung(e.target.value)} />
                </label>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <button type="submit" className="btn btn-primary btn-sm">
                  Speichern
                </button>
                {datesStatus && <span className="hinweis">{datesStatus}</span>}
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}
