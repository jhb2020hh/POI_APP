import { useEffect, useState } from 'react'
import type { Attachment } from '@poi-app/shared'
import { attachmentFileUrl, getToken, listAttachments, uploadAttachment } from '../api/client'

interface AttachmentGalleryProps {
  pointId: string
  isOnline: boolean
}

export function AttachmentGallery({ pointId, isOnline }: AttachmentGalleryProps) {
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({})
  const [status, setStatus] = useState('')

  function refresh() {
    listAttachments(pointId).then(setAttachments)
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointId])

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

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setStatus('lädt hoch...')
    try {
      await uploadAttachment(pointId, file)
      setStatus('')
      refresh()
    } catch (err) {
      setStatus(`Fehler: ${err instanceof Error ? err.message : err}`)
    }
    e.target.value = ''
  }

  return (
    <div>
      <label className="field">
        <span className="field-label">Foto/Datei hinzufügen</span>
        <input
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          onChange={handleUpload}
          disabled={!isOnline}
        />
      </label>
      {!isOnline && (
        <p className="hinweis" style={{ marginTop: 6 }}>
          Offline: Anlagen können erst online hochgeladen werden.
        </p>
      )}
      {status && (
        <p
          style={{
            fontSize: 12,
            color: status.startsWith('Fehler') ? 'var(--color-danger)' : 'var(--color-text-muted)',
            marginTop: 6,
          }}
        >
          {status}
        </p>
      )}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        {attachments.map((a) =>
          a.mime_type.startsWith('image/') ? (
            <img
              key={a.id}
              src={previewUrls[a.id]}
              alt={a.file_name}
              style={{
                width: 88,
                height: 88,
                objectFit: 'cover',
                borderRadius: 'var(--radius-sm)',
                border: '1px solid var(--color-border)',
              }}
            />
          ) : (
            <a
              key={a.id}
              href={previewUrls[a.id]}
              download={a.file_name}
              className="badge badge-neutral"
              style={{ textDecoration: 'none' }}
            >
              📎 {a.file_name}
            </a>
          )
        )}
        {attachments.length === 0 && (
          <span className="meta">Noch keine Anlagen</span>
        )}
      </div>
    </div>
  )
}
