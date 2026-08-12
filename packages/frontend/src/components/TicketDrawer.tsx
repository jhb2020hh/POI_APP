import { useState } from 'react'
import type { Category, CustomFieldValues, FieldDef, Point } from '@poi-app/shared'
import type { UserSummary } from '../api/client'
import { STATUS_LABELS } from '../constants'
import { DynamicFieldForm } from './DynamicFieldForm'
import { AttachmentGallery } from './AttachmentGallery'
import { PointTimeline } from './PointTimeline'

export interface TicketFormInput {
  title: string
  description?: string
  categoryId: string
  customFields: CustomFieldValues
  bauabschnitt?: string
  status?: string
  priority?: string
  assignedTo?: string
  dueDate?: string
  gewerk?: string
  raumBereich?: string
  stagedFiles?: File[]
}

interface TicketDrawerProps {
  mode: 'create' | 'edit'
  point?: Point
  categories: Category[]
  users: UserSummary[]
  isOnline: boolean
  onSave: (input: TicketFormInput) => Promise<void>
  onDelete?: () => Promise<void>
  onClose: () => void
}

function parseFields(category: Category | undefined): FieldDef[] {
  if (!category) return []
  try {
    const schema = JSON.parse(category.field_schema_json) as { fields?: FieldDef[] }
    return schema.fields ?? []
  } catch {
    return []
  }
}

export function TicketDrawer({
  mode,
  point,
  categories,
  users,
  isOnline,
  onSave,
  onDelete,
  onClose,
}: TicketDrawerProps) {
  const [tab, setTab] = useState<'details' | 'fotos' | 'verlauf'>('details')
  const [title, setTitle] = useState(point?.title ?? '')
  const [description, setDescription] = useState(point?.description ?? '')
  const [categoryId, setCategoryId] = useState(point?.category_id ?? categories[0]?.id ?? 'cat-defect')
  const [customFields, setCustomFields] = useState<CustomFieldValues>(
    point?.custom_fields ? JSON.parse(point.custom_fields) : {}
  )
  const [bauabschnitt, setBauabschnitt] = useState(point?.bauabschnitt ?? '')
  const [status, setStatus] = useState(point?.status ?? 'open')
  const [priority, setPriority] = useState(point?.priority ?? '')
  const [assignedTo, setAssignedTo] = useState(point?.assigned_to ?? '')
  const [dueDate, setDueDate] = useState(point?.due_date ?? '')
  const [gewerk, setGewerk] = useState(point?.gewerk ?? '')
  const [raumBereich, setRaumBereich] = useState(point?.raum_bereich ?? '')
  const [saving, setSaving] = useState(false)
  const [stagedFiles, setStagedFiles] = useState<File[]>([])

  function handleStageFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? [])
    if (files.length === 0) return
    setStagedFiles((prev) => [...prev, ...files])
    e.target.value = ''
  }

  function removeStagedFile(index: number) {
    setStagedFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const activeCategory = categories.find((c) => c.id === categoryId)
  const fields = parseFields(activeCategory)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!title) return
    setSaving(true)
    try {
      await onSave({
        title,
        description: description || undefined,
        categoryId,
        customFields,
        bauabschnitt: bauabschnitt || undefined,
        status: mode === 'edit' ? status : undefined,
        priority: priority || undefined,
        assignedTo: assignedTo || undefined,
        dueDate: dueDate || undefined,
        gewerk: gewerk || undefined,
        raumBereich: raumBereich || undefined,
        stagedFiles: mode === 'create' ? stagedFiles : undefined,
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer">
        <div className="drawer-header">
          <span className="drawer-title">
            {mode === 'create' ? 'Neues Ticket' : 'Ticket bearbeiten'}
            {mode === 'edit' && point && (
              <span className="hinweis" style={{ marginLeft: 8, fontWeight: 400 }}>
                {point.ticket_number ?? 'wird vergeben'}
              </span>
            )}
          </span>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Schließen">
            ✕
          </button>
        </div>

        {mode === 'edit' && (
          <div className="tabs">
            <button type="button" className={`tab ${tab === 'details' ? 'active' : ''}`} onClick={() => setTab('details')}>
              Details
            </button>
            <button type="button" className={`tab ${tab === 'fotos' ? 'active' : ''}`} onClick={() => setTab('fotos')}>
              Fotos
            </button>
            <button type="button" className={`tab ${tab === 'verlauf' ? 'active' : ''}`} onClick={() => setTab('verlauf')}>
              Verlauf
            </button>
          </div>
        )}

        <form id="ticket-form" onSubmit={handleSubmit} style={{ display: 'contents' }}>
          {tab === 'details' && (
            <div className="drawer-body">
              <div className="field">
                <span className="field-label">Titel</span>
                <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="z.B. Riss in Wand" required autoFocus />
              </div>

              <div className="field">
                <span className="field-label">Beschreibung</span>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Details zum Ticket" />
              </div>

              <div className="field">
                <span className="field-label">Kategorie</span>
                <select
                  value={categoryId}
                  onChange={(e) => {
                    setCategoryId(e.target.value)
                    setCustomFields({})
                  }}
                >
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.glyph} {c.name}
                    </option>
                  ))}
                </select>
              </div>

              <DynamicFieldForm
                fields={fields}
                values={customFields}
                onChange={(key, value) => setCustomFields((prev) => ({ ...prev, [key]: value }))}
              />

              {mode === 'edit' && (
                <div className="field">
                  <span className="field-label">Status</span>
                  <select value={status} onChange={(e) => setStatus(e.target.value)}>
                    {Object.entries(STATUS_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              <div className="field-row">
                <div className="field" style={{ flex: 1 }}>
                  <span className="field-label">Priorität</span>
                  <select value={priority} onChange={(e) => setPriority(e.target.value)}>
                    <option value="">Keine</option>
                    <option value="niedrig">Niedrig</option>
                    <option value="mittel">Mittel</option>
                    <option value="hoch">Hoch</option>
                  </select>
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <span className="field-label">Fällig am</span>
                  <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
                </div>
              </div>

              <div className="field">
                <span className="field-label">Zuständig</span>
                <select value={assignedTo} onChange={(e) => setAssignedTo(e.target.value)}>
                  <option value="">Nicht zugewiesen</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.display_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="field-row">
                <div className="field" style={{ flex: 1 }}>
                  <span className="field-label">Gewerk</span>
                  <input value={gewerk} onChange={(e) => setGewerk(e.target.value)} placeholder="z.B. Elektro" />
                </div>
                <div className="field" style={{ flex: 1 }}>
                  <span className="field-label">Raum/Bereich</span>
                  <input value={raumBereich} onChange={(e) => setRaumBereich(e.target.value)} />
                </div>
              </div>

              <div className="field">
                <span className="field-label">Bauabschnitt</span>
                <input value={bauabschnitt} onChange={(e) => setBauabschnitt(e.target.value)} placeholder="z.B. BA1" />
              </div>

              {mode === 'create' && (
                <div className="field">
                  <span className="field-label">Fotos/Anlagen</span>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    capture="environment"
                    multiple
                    onChange={handleStageFiles}
                    disabled={!isOnline}
                  />
                  {!isOnline && (
                    <p className="hinweis" style={{ marginTop: 6 }}>
                      Offline: Anlagen können erst online hochgeladen werden.
                    </p>
                  )}
                  {stagedFiles.length > 0 && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                      {stagedFiles.map((file, i) => (
                        <span key={i} className="badge badge-neutral" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          📎 {file.name}
                          <button
                            type="button"
                            className="icon-btn"
                            onClick={() => removeStagedFile(i)}
                            aria-label="Entfernen"
                            style={{ width: 16, height: 16, lineHeight: '16px' }}
                          >
                            ✕
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </form>

        {mode === 'edit' && point && tab === 'fotos' && (
          <div className="drawer-body">
            <AttachmentGallery pointId={point.id} isOnline={isOnline} />
          </div>
        )}

        {mode === 'edit' && point && tab === 'verlauf' && (
          <div className="drawer-body">
            <PointTimeline pointId={point.id} users={users} />
          </div>
        )}

        {tab === 'details' && (
          <div className="drawer-footer">
            <div>
              {mode === 'edit' && onDelete && (
                <button type="button" className="btn btn-danger btn-sm" onClick={onDelete}>
                  Löschen
                </button>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={onClose}>
                Abbrechen
              </button>
              <button type="submit" form="ticket-form" className="btn btn-primary btn-sm" disabled={saving}>
                {saving ? 'Speichert…' : 'Speichern'}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  )
}
