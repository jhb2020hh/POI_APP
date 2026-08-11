import { useState } from 'react'
import type { Category } from '@poi-app/shared'
import {
  archiveGlobalCategory,
  createGlobalCategory,
  listArchivedGlobalCategories,
  restoreGlobalCategory,
} from '../api/client'
import { CategoryAdmin } from './CategoryAdmin'
import { CategoryBadge } from './ui/Badge'

interface TemplateManagementProps {
  templates: Category[]
  onChanged: () => void
}

export function TemplateManagement({ templates, onChanged }: TemplateManagementProps) {
  const [archived, setArchived] = useState<Category[] | null>(null)

  async function handleArchive(name: string, id: string) {
    if (!confirm(`Ticketvorlage "${name}" wirklich archivieren? Sie ist danach in keinem Projekt mehr auswählbar (kann später wiederhergestellt werden).`)) {
      return
    }
    await archiveGlobalCategory(id)
    onChanged()
    if (archived) loadArchived()
  }

  async function loadArchived() {
    setArchived(await listArchivedGlobalCategories())
  }

  async function handleRestore(id: string) {
    await restoreGlobalCategory(id)
    onChanged()
    loadArchived()
  }

  return (
    <div>
      <p style={{ fontSize: 13, color: 'var(--color-text-muted)', marginBottom: 12 }}>
        Zentral verwaltete Ticketvorlagen. Sie stehen automatisch in jedem Projekt zur Auswahl.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 16 }}>
        {templates.map((t) => (
          <div
            key={t.id}
            style={{
              padding: '8px 12px',
              border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-sm)',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
            }}
          >
            <CategoryBadge color={t.color} name={t.name} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleArchive(t.name, t.id)}>
              Archivieren
            </button>
          </div>
        ))}
        {templates.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Noch keine zentralen Vorlagen angelegt.</p>
        )}
      </div>

      <div style={{ marginBottom: 16 }}>
        {archived === null ? (
          <button type="button" className="btn btn-ghost btn-sm" onClick={loadArchived}>
            Archivierte Vorlagen anzeigen
          </button>
        ) : (
          <>
            <div className="field-label" style={{ marginBottom: 6 }}>
              Archivierte Vorlagen
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {archived.map((t) => (
                <div
                  key={t.id}
                  style={{
                    padding: '8px 12px',
                    border: '1px solid var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    opacity: 0.7,
                  }}
                >
                  <CategoryBadge color={t.color} name={t.name} />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => handleRestore(t.id)}>
                    Wiederherstellen
                  </button>
                </div>
              ))}
              {archived.length === 0 && (
                <p style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>Keine archivierten Vorlagen.</p>
              )}
            </div>
          </>
        )}
      </div>

      <CategoryAdmin createFn={createGlobalCategory} onCreated={onChanged} />
    </div>
  )
}
