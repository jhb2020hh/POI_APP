import { useEffect, useState } from 'react'
import type { Category, FieldDef, FieldType } from '@poi-app/shared'
import { FIELD_TYPE_LABELS_DE, RENDERABLE_FIELD_TYPES } from '@poi-app/shared'
import { createCategory, listFieldSuggestions, type FieldSuggestion } from '../api/client'
import { CATEGORY_ICONS } from '../constants/categoryIcons'

interface CategoryAdminProps {
  projectId?: string
  onCreated: () => void
  createFn?: (input: {
    name: string
    color?: string
    glyph?: string
    shortCode?: string
    fieldSchemaJson?: string
  }) => Promise<Category>
}

export function CategoryAdmin({ projectId, onCreated, createFn }: CategoryAdminProps) {
  const [name, setName] = useState('')
  const [shortCode, setShortCode] = useState('')
  const [color, setColor] = useState('#3a86ff')
  const [glyph, setGlyph] = useState(CATEGORY_ICONS[0])
  const [customGlyph, setCustomGlyph] = useState(false)
  const [fields, setFields] = useState<FieldDef[]>([])
  const [status, setStatus] = useState('')
  const [fieldSuggestions, setFieldSuggestions] = useState<FieldSuggestion[]>([])

  useEffect(() => {
    listFieldSuggestions().then(setFieldSuggestions).catch(() => setFieldSuggestions([]))
  }, [])

  function applyFieldSuggestion(index: number, key: string) {
    const suggestion = fieldSuggestions.find((s) => s.key === key)
    if (!suggestion) {
      updateField(index, { key })
      return
    }
    updateField(index, { key: suggestion.key, label: suggestion.label, type: suggestion.type as FieldType })
  }

  function addField() {
    setFields((prev) => [...prev, { key: `feld_${prev.length + 1}`, label: '', type: 'text' }])
  }

  function updateField(index: number, patch: Partial<FieldDef>) {
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)))
  }

  function removeField(index: number) {
    setFields((prev) => prev.filter((_, i) => i !== index))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name) return
    setStatus('Speichert…')
    try {
      const input = {
        name,
        color,
        glyph,
        shortCode: shortCode.trim() || undefined,
        fieldSchemaJson: JSON.stringify({ version: 1, fields }),
      }
      if (createFn) {
        await createFn(input)
      } else if (projectId) {
        await createCategory(projectId, input)
      }
      setName('')
      setShortCode('')
      setGlyph(CATEGORY_ICONS[0])
      setCustomGlyph(false)
      setColor('#3a86ff')
      setFields([])
      setStatus('')
      onCreated()
    } catch (err) {
      setStatus(`Fehler: ${err}`)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ padding: 14 }}>
      <h4 style={{ marginBottom: 10 }}>Neue Kategorie</h4>
      <div className="field-row" style={{ marginBottom: 12, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 1 }}>
          <span className="field-label">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Kollision" required />
        </div>
        <div className="field">
          <span className="field-label">Kurzcode (für Ticket-IDs)</span>
          <input
            value={shortCode}
            onChange={(e) => setShortCode(e.target.value.toUpperCase())}
            placeholder="automatisch"
            style={{ width: '7rem' }}
          />
        </div>
        <div className="field">
          <span className="field-label">Farbe</span>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </div>
        <div className="field">
          <span className="field-label">Symbol</span>
          {customGlyph ? (
            <input
              value={glyph}
              onChange={(e) => setGlyph(e.target.value.slice(0, 2))}
              style={{ width: '3rem' }}
              autoFocus
            />
          ) : (
            <select value={glyph} onChange={(e) => setGlyph(e.target.value)}>
              {CATEGORY_ICONS.map((icon) => (
                <option key={icon} value={icon}>
                  {icon}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setCustomGlyph((v) => !v)}
            style={{ marginLeft: 4 }}
            title={customGlyph ? 'Aus Liste wählen' : 'Eigenes Zeichen eingeben'}
          >
            {customGlyph ? '📋' : '✏'}
          </button>
        </div>
      </div>

      <div className="field-label" style={{ marginBottom: 6 }}>
        Felder
      </div>
      {fields.map((field, i) => (
        <div key={i} className="field-row" style={{ marginBottom: 6, alignItems: 'center' }}>
          <input
            value={field.key}
            onChange={(e) => applyFieldSuggestion(i, e.target.value)}
            placeholder="Schlüssel"
            list="category-field-keys"
            style={{ width: '8rem' }}
          />
          <input
            value={field.label}
            onChange={(e) => updateField(i, { label: e.target.value })}
            placeholder="Anzeigename"
            list="category-field-labels"
            style={{ flex: 1 }}
          />
          <select value={field.type} onChange={(e) => updateField(i, { type: e.target.value as FieldType })}>
            {RENDERABLE_FIELD_TYPES.map((t) => (
              <option key={t} value={t}>
                {FIELD_TYPE_LABELS_DE[t]}
              </option>
            ))}
          </select>
          {field.type === 'choice' && (
            <input
              value={(field.options ?? []).join(',')}
              onChange={(e) =>
                updateField(i, {
                  options: e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter(Boolean),
                })
              }
              placeholder="Optionen (Komma-getrennt)"
            />
          )}
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={Boolean(field.required)}
              onChange={(e) => updateField(i, { required: e.target.checked })}
            />
            Pflicht
          </label>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => removeField(i)}>
            Entfernen
          </button>
        </div>
      ))}
      <button type="button" className="btn btn-secondary btn-sm" onClick={addField}>
        + Feld hinzufügen
      </button>

      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="submit" className="btn btn-primary btn-sm">
          Kategorie anlegen
        </button>
        {status && <span style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>{status}</span>}
      </div>

      <datalist id="category-field-keys">
        {fieldSuggestions.map((s) => (
          <option key={s.key} value={s.key} />
        ))}
      </datalist>
      <datalist id="category-field-labels">
        {fieldSuggestions.map((s) => (
          <option key={s.key} value={s.label} />
        ))}
      </datalist>
    </form>
  )
}
