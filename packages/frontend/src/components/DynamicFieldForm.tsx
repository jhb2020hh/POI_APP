import type { CustomFieldValues, FieldDef } from '@poi-app/shared'
import { RENDERABLE_FIELD_TYPES } from '@poi-app/shared'

interface DynamicFieldFormProps {
  fields: FieldDef[]
  values: CustomFieldValues
  onChange: (key: string, value: string | number | boolean) => void
}

/**
 * Die frei definierten Felder einer Ticketkategorie.
 *
 * Der Rahmen — Beschriftung, Pflichtkennzeichen — steht einmal; nur das
 * Bedienelement selbst hängt vom Feldtyp ab. Vorher wiederholte sich der
 * Rahmen in jedem der fünf Zweige, und die Beschriftung war dabei ein
 * <span>: sichtbar, aber nicht mit dem Feld verbunden. Ein Klick darauf
 * setzte den Schreibcursor nicht ins Feld, und Vorlesewerkzeuge nannten es
 * nur „Eingabefeld".
 */
export function DynamicFieldForm({ fields, values, onChange }: DynamicFieldFormProps) {
  if (fields.length === 0) return null

  return (
    <>
      {fields.map((field) => {
        if (!RENDERABLE_FIELD_TYPES.includes(field.type)) {
          return (
            <div key={field.key} className="field" style={{ opacity: 0.6 }}>
              <span className="field-label">{field.label}</span>
              <p className="hinweis">
                Feldtyp "{field.type}" wird in einer späteren Ausbaustufe unterstützt.
              </p>
            </div>
          )
        }

        const value = values[field.key]

        // Ja/Nein trägt seine Beschriftung neben dem Kästchen statt darüber -
        // deshalb ein eigener Zweig statt des gemeinsamen Rahmens.
        if (field.type === 'boolean') {
          return (
            <div key={field.key} className="field">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={Boolean(value)}
                  onChange={(e) => onChange(field.key, e.target.checked)}
                />
                {field.label}
              </label>
            </div>
          )
        }

        // Die umschließende Beschriftung verbindet Text und Feld ohne id -
        // bei zur Laufzeit erzeugten Feldern müsste man sonst eindeutige
        // Kennungen vergeben und sauber halten.
        return (
          <label key={field.key} className="field">
            <span className="field-label">
              {field.label}
              {field.required && (
                <span className="pflicht-stern" title="Pflichtfeld">
                  {' *'}
                </span>
              )}
            </span>

            {field.type === 'text' && (
              <input
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => onChange(field.key, e.target.value)}
                required={field.required}
              />
            )}

            {field.type === 'multiline' && (
              <textarea
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => onChange(field.key, e.target.value)}
                required={field.required}
              />
            )}

            {field.type === 'number' && (
              <input
                type="number"
                value={typeof value === 'number' ? value : ''}
                onChange={(e) =>
                  onChange(field.key, e.target.value === '' ? '' : Number(e.target.value))
                }
                required={field.required}
              />
            )}

            {field.type === 'date' && (
              <input
                type="date"
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => onChange(field.key, e.target.value)}
                required={field.required}
              />
            )}

            {field.type === 'choice' && (
              <select
                value={typeof value === 'string' ? value : ''}
                onChange={(e) => onChange(field.key, e.target.value)}
                required={field.required}
              >
                <option value="">-- auswählen --</option>
                {(field.options ?? []).map((opt) => (
                  <option key={opt} value={opt}>
                    {opt}
                  </option>
                ))}
              </select>
            )}
          </label>
        )
      })}
    </>
  )
}
