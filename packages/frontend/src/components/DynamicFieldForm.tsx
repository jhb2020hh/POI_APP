import type { CustomFieldValues, FieldDef } from '@poi-app/shared'
import { RENDERABLE_FIELD_TYPES } from '@poi-app/shared'

interface DynamicFieldFormProps {
  fields: FieldDef[]
  values: CustomFieldValues
  onChange: (key: string, value: string | number | boolean) => void
}

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
        const labelText = `${field.label}${field.required ? ' *' : ''}`

        switch (field.type) {
          case 'text':
            return (
              <div key={field.key} className="field">
                <span className="field-label">{labelText}</span>
                <input
                  value={typeof value === 'string' ? value : ''}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  required={field.required}
                />
              </div>
            )
          case 'multiline':
            return (
              <div key={field.key} className="field">
                <span className="field-label">{labelText}</span>
                <textarea
                  value={typeof value === 'string' ? value : ''}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  required={field.required}
                />
              </div>
            )
          case 'number':
            return (
              <div key={field.key} className="field">
                <span className="field-label">{labelText}</span>
                <input
                  type="number"
                  value={typeof value === 'number' ? value : ''}
                  onChange={(e) => onChange(field.key, e.target.value === '' ? '' : Number(e.target.value))}
                  required={field.required}
                />
              </div>
            )
          case 'date':
            return (
              <div key={field.key} className="field">
                <span className="field-label">{labelText}</span>
                <input
                  type="date"
                  value={typeof value === 'string' ? value : ''}
                  onChange={(e) => onChange(field.key, e.target.value)}
                  required={field.required}
                />
              </div>
            )
          case 'boolean':
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
          case 'choice':
            return (
              <div key={field.key} className="field">
                <span className="field-label">{labelText}</span>
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
              </div>
            )
          default:
            return null
        }
      })}
    </>
  )
}
