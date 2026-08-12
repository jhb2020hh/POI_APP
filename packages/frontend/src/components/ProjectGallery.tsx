import { useEffect, useMemo, useState } from 'react'
import type { Category, Plan } from '@poi-app/shared'
import { attachmentFileUrl, getToken, listProjectAttachments, type AttachmentWithPoint } from '../api/client'

interface ProjectGalleryProps {
  projectId: string
  categories: Category[]
  plans: Plan[]
  onSelectAttachment: (attachment: AttachmentWithPoint) => void
}

export function ProjectGallery({ projectId, categories, plans, onSelectAttachment }: ProjectGalleryProps) {
  const [attachments, setAttachments] = useState<AttachmentWithPoint[]>([])
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const [filterCategoryId, setFilterCategoryId] = useState('')
  const [filterPlanId, setFilterPlanId] = useState('')

  const filteredAttachments = useMemo(
    () =>
      attachments.filter(
        (a) =>
          (!filterCategoryId || a.category_id === filterCategoryId) &&
          (!filterPlanId || a.plan_id === filterPlanId)
      ),
    [attachments, filterCategoryId, filterPlanId]
  )

  useEffect(() => {
    listProjectAttachments(projectId).then(setAttachments)
  }, [projectId])

  useEffect(() => {
    let cancelled = false
    const token = getToken()
    attachments.forEach((a) => {
      if (previewUrls[a.id]) return
      fetch(attachmentFileUrl(a.id), {
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
        .then((res) => res.blob())
        .then((blob) => {
          if (cancelled) return
          const url = URL.createObjectURL(blob)
          setPreviewUrls((prev) => ({ ...prev, [a.id]: url }))
        })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attachments])

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
      <div className="toolbar" style={{ marginBottom: 12 }}>
        <span className="toolbar-title">Galerie ({filteredAttachments.length})</span>
        <select value={filterCategoryId} onChange={(e) => setFilterCategoryId(e.target.value)}>
          <option value="">Ticketart: alle</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <select value={filterPlanId} onChange={(e) => setFilterPlanId(e.target.value)}>
          <option value="">Zeichnung: alle</option>
          {plans.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            setFilterCategoryId('')
            setFilterPlanId('')
          }}
        >
          Filter zurücksetzen
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
        {filteredAttachments.map((a) =>
          a.mime_type.startsWith('image/') ? (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelectAttachment(a)}
              title={a.point_title}
              style={{ padding: 0, border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', cursor: 'pointer', background: 'none' }}
            >
              <img
                src={previewUrls[a.id]}
                alt={a.file_name}
                style={{ width: 140, height: 140, objectFit: 'cover', display: 'block', borderRadius: 'var(--radius-sm)' }}
              />
            </button>
          ) : (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelectAttachment(a)}
              className="badge badge-neutral"
              style={{ cursor: 'pointer' }}
            >
              📎 {a.file_name}
            </button>
          )
        )}
        {filteredAttachments.length === 0 && attachments.length > 0 && (
          <span className="meta">Keine Fotos/Anlagen für diesen Filter</span>
        )}
        {attachments.length === 0 && (
          <span className="meta">Noch keine Fotos/Anlagen im Projekt</span>
        )}
      </div>
    </div>
  )
}
