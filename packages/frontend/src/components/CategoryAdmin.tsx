import { useEffect, useState } from 'react'
import type { Category, FieldDef, FieldType } from '@poi-app/shared'
import { FIELD_TYPE_LABELS_DE, RENDERABLE_FIELD_TYPES } from '@poi-app/shared'
import {
  createCategory,
  listFieldSuggestions,
  updateCategory,
  type FieldSuggestion,
} from '../api/client'
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
  /**
   * Gesetzt heisst: bestehende Vorlage bearbeiten statt eine neue anlegen.
   *
   * Bewusst dasselbe Formular fuer beides. Ein zweiter, fast gleicher Baustein
   * haette die Feldliste samt Vorschlaegen verdoppelt - den aufwendigen Teil -
   * und beide waeren mit der Zeit auseinandergelaufen.
   */
  category?: Category
  /** Nur im Bearbeitungsfall: zurueck zur Liste, ohne zu speichern. */
  onCancel?: () => void
}

function leseFelder(schemaJson: string | undefined): FieldDef[] {
  if (!schemaJson) return []
  try {
    const geparst = JSON.parse(schemaJson) as { fields?: FieldDef[] }
    return geparst.fields ?? []
  } catch {
    return []
  }
}

export function CategoryAdmin({
  projectId,
  onCreated,
  createFn,
  category,
  onCancel,
}: CategoryAdminProps) {
  const bearbeitet = Boolean(category)

  const [name, setName] = useState(category?.name ?? '')
  const [shortCode, setShortCode] = useState(category?.short_code ?? '')
  const [color, setColor] = useState(category?.color ?? '#3a86ff')
  const [glyph, setGlyph] = useState(category?.glyph ?? CATEGORY_ICONS[0])
  const [customGlyph, setCustomGlyph] = useState(
    category ? !CATEGORY_ICONS.includes(category.glyph) : false
  )
  const [fields, setFields] = useState<FieldDef[]>(() => leseFelder(category?.field_schema_json))
  const [status, setStatus] = useState('')
  const [fieldSuggestions, setFieldSuggestions] = useState<FieldSuggestion[]>([])

  // Welche Felder es urspruenglich gab - fuer den Hinweis, wenn eines
  // verschwindet.
  const [ursprungsFelder] = useState<FieldDef[]>(() => leseFelder(category?.field_schema_json))
  const entfernteFelder = ursprungsFelder.filter(
    (alt) => !fields.some((f) => f.key === alt.key)
  )

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

  function setzeZurueck() {
    setName('')
    setShortCode('')
    setGlyph(CATEGORY_ICONS[0])
    setCustomGlyph(false)
    setColor('#3a86ff')
    setFields([])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setStatus('Speichert…')
    try {
      const fieldSchemaJson = JSON.stringify({ version: 1, fields })
      if (category) {
        // shortCode bleibt aussen vor: er steckt in bereits vergebenen
        // Ticketnummern.
        await updateCategory(category.id, { name: name.trim(), color, glyph, fieldSchemaJson })
      } else {
        const input = {
          name: name.trim(),
          color,
          glyph,
          shortCode: shortCode.trim() || undefined,
          fieldSchemaJson,
        }
        if (createFn) {
          await createFn(input)
        } else if (projectId) {
          await createCategory(projectId, input)
        }
        setzeZurueck()
      }
      setStatus('')
      onCreated()
    } catch (err) {
      setStatus(`Fehler: ${err instanceof Error ? err.message : err}`)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="card" style={{ padding: 14 }}>
      <h4 style={{ marginBottom: 10 }}>
        {bearbeitet ? `Kategorie bearbeiten: ${category!.name}` : 'Neue Kategorie'}
      </h4>
      <div className="field-row" style={{ marginBottom: 12, alignItems: 'flex-end' }}>
        <label className="field" style={{ flex: 1 }}>
          <span className="field-label">Name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Kollision" required />
        </label>
        <label className="field">
          <span className="field-label">Kurzcode (für Ticket-IDs)</span>
          <input
            value={shortCode}
            onChange={(e) => setShortCode(e.target.value.toUpperCase())}
            placeholder="automatisch"
            style={{ width: '7rem' }}
            disabled={bearbeitet}
            title={
              bearbeitet
                ? 'Der Kurzcode steckt in allen bereits vergebenen Ticketnummern und lässt sich deshalb nicht mehr ändern.'
                : undefined
            }
          />
        </label>
        <label className="field">
          <span className="field-label">Farbe</span>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} />
        </label>
        <div className="field">
          <span className="field-label">Symbol</span>
          {customGlyph ? (
            <input
              value={glyph}
              onChange={(e) => setGlyph(e.target.value.slice(0, 2))}
              style={{ width: '3rem' }}
              aria-label="Symbol der Kategorie"
              autoFocus
            />
          ) : (
            <select
              value={glyph}
              onChange={(e) => setGlyph(e.target.value)}
              aria-label="Symbol der Kategorie"
            >
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

      {bearbeitet && (
        <p className="hinweis" style={{ marginBottom: 10 }}>
          Der Kurzcode <strong>{category!.short_code ?? '–'}</strong> bleibt unverändert — er steht
          in allen bereits vergebenen Ticketnummern.
        </p>
      )}

      <div className="field-label" style={{ marginBottom: 6 }}>
        Felder
      </div>
      {fields.map((field, i) => (
        <div key={i} className="field-row" style={{ marginBottom: 6, alignItems: 'center' }}>
          <input
            value={field.key}
            onChange={(e) => applyFieldSuggestion(i, e.target.value)}
            placeholder="Schlüssel"
            aria-label="Schlüssel des Feldes"
            list="category-field-keys"
            style={{ width: '8rem' }}
          />
          <input
            value={field.label}
            onChange={(e) => updateField(i, { label: e.target.value })}
            placeholder="Anzeigename"
            aria-label="Anzeigename des Feldes"
            list="category-field-labels"
            style={{ flex: 1 }}
          />
          <select
            value={field.type}
            onChange={(e) => updateField(i, { type: e.target.value as FieldType })}
            aria-label="Art des Feldes"
          >
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
              aria-label="Auswahlmöglichkeiten, durch Komma getrennt"
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

      {/* Entfernte Felder loeschen keine Werte - die Angaben stehen weiter in
          den Tickets, werden nur nicht mehr angezeigt. Das muss man wissen,
          bevor man speichert. */}
      {entfernteFelder.length > 0 && (
        <p className="hinweis" style={{ marginTop: 10 }}>
          {entfernteFelder.length === 1 ? 'Das Feld ' : 'Die Felder '}
          <strong>{entfernteFelder.map((f) => f.label || f.key).join(', ')}</strong>
          {entfernteFelder.length === 1 ? ' wird' : ' werden'} nach dem Speichern nicht mehr
          angezeigt. Bereits eingetragene Werte bleiben in den Tickets erhalten und erscheinen
          wieder, wenn das Feld zurückkommt.
        </p>
      )}

      <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="submit" className="btn btn-primary btn-sm">
          {bearbeitet ? 'Änderungen speichern' : 'Kategorie anlegen'}
        </button>
        {bearbeitet && onCancel && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
            Abbrechen
          </button>
        )}
        {status && (
          <span className={`hinweis ${status.startsWith('Fehler') ? 'hinweis-fehler' : ''}`}>
            {status}
          </span>
        )}
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
