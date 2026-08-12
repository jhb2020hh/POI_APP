import { useEffect, useState } from 'react'
import type { PointComment, PointHistoryEntry } from '@poi-app/shared'
import { addPointComment, listPointComments, listPointHistory, type UserSummary } from '../api/client'

interface PointTimelineProps {
  pointId: string
  users: UserSummary[]
}

const FIELD_LABELS: Record<string, string> = {
  title: 'Titel',
  description: 'Beschreibung',
  point_type: 'Typ',
  category_id: 'Kategorie',
  status: 'Status',
  bauabschnitt: 'Bauabschnitt',
  priority: 'Priorität',
  assigned_to: 'Zuständig',
  due_date: 'Fällig am',
  gewerk: 'Gewerk',
  raum_bereich: 'Raum/Bereich',
}

type TimelineItem =
  | { kind: 'history'; at: string; entry: PointHistoryEntry }
  | { kind: 'comment'; at: string; entry: PointComment }

export function PointTimeline({ pointId, users }: PointTimelineProps) {
  const [history, setHistory] = useState<PointHistoryEntry[]>([])
  const [comments, setComments] = useState<PointComment[]>([])
  const [newComment, setNewComment] = useState('')
  const [status, setStatus] = useState('')

  function refresh() {
    listPointHistory(pointId).then(setHistory)
    listPointComments(pointId).then(setComments)
  }

  useEffect(() => {
    refresh()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pointId])

  function userName(id: string | null) {
    if (!id) return 'System'
    return users.find((u) => u.id === id)?.display_name ?? id
  }

  async function handleAddComment() {
    if (!newComment) return
    setStatus('speichert...')
    try {
      await addPointComment(pointId, newComment)
      setNewComment('')
      setStatus('')
      refresh()
    } catch (err) {
      setStatus(`Fehler: ${err}`)
    }
  }

  const items: TimelineItem[] = [
    ...history.map((entry) => ({ kind: 'history' as const, at: entry.changed_at, entry })),
    ...comments.map((entry) => ({ kind: 'comment' as const, at: entry.created_at, entry })),
  ].sort((a, b) => a.at.localeCompare(b.at))

  return (
    <div>
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: '0 0 12px',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        {items.map((item) =>
          item.kind === 'history' ? (
            <li key={`h-${item.entry.id}`} className="hinweis">
              <em>
                {FIELD_LABELS[item.entry.field_changed] ?? item.entry.field_changed} geändert von „
                {item.entry.old_value ?? '–'}" zu „{item.entry.new_value ?? '–'}"
              </em>{' '}
              — {userName(item.entry.changed_by)}, {new Date(item.entry.changed_at).toLocaleString('de-DE')}
            </li>
          ) : (
            <li
              key={`c-${item.entry.id}`}
              style={{
                fontSize: 13.5,
                background: 'var(--color-surface-hover)',
                borderRadius: 'var(--radius-sm)',
                padding: '8px 10px',
              }}
            >
              <strong>{userName(item.entry.author_id)}</strong>{' '}
              <span className="meta">
                {new Date(item.entry.created_at).toLocaleString('de-DE')}
              </span>
              <div>{item.entry.body}</div>
            </li>
          )
        )}
        {items.length === 0 && (
          <li className="meta">Noch keine Einträge</li>
        )}
      </ul>
      <div className="field-row">
        <input
          value={newComment}
          onChange={(e) => setNewComment(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              handleAddComment()
            }
          }}
          placeholder="Kommentar hinzufügen"
          style={{ flex: 1 }}
        />
        <button type="button" className="btn btn-secondary btn-sm" onClick={handleAddComment}>
          Kommentieren
        </button>
      </div>
      {status && <p className="hinweis" style={{ marginTop: 6 }}>{status}</p>}
    </div>
  )
}
