import { useState } from 'react'
import type { Category } from '@poi-app/shared'
import type { PointWithPlan, UserSummary } from '../api/client'
import { Avatar, CategoryBadge, PriorityBadge, StatusBadge } from './ui/Badge'

interface TicketOverviewProps {
  points: PointWithPlan[]
  categories: Category[]
  users: UserSummary[]
  onSelect: (point: PointWithPlan) => void
  selectedIds: string[]
  onToggleSelect: (id: string) => void
}

type SortKey = 'ticket_number' | 'title' | 'plan_name' | 'status' | 'priority' | 'due_date'

export function TicketOverview({ points, categories, users, onSelect, selectedIds, onToggleSelect }: TicketOverviewProps) {
  const [sortKey, setSortKey] = useState<SortKey>('title')
  const [sortDir, setSortDir] = useState<1 | -1>(1)
  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const userById = new Map(users.map((u) => [u.id, u]))

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === 1 ? -1 : 1))
    } else {
      setSortKey(key)
      setSortDir(1)
    }
  }

  const sorted = [...points].sort((a, b) => {
    const av = (a[sortKey] ?? '') as string
    const bv = (b[sortKey] ?? '') as string
    return av.localeCompare(bv) * sortDir
  })

  function headerButton(key: SortKey, label: string) {
    return (
      <button type="button" className="icon-btn" style={{ fontWeight: 600 }} onClick={() => toggleSort(key)}>
        {label} {sortKey === key ? (sortDir === 1 ? '↑' : '↓') : ''}
      </button>
    )
  }

  if (points.length === 0) {
    return <div className="data-table-empty">Keine Tickets für die aktuellen Filter</div>
  }

  return (
    <table className="data-table">
      <thead>
        <tr>
          <th></th>
          <th>{headerButton('ticket_number', 'Ticket-Nr.')}</th>
          <th>{headerButton('title', 'Titel')}</th>
          <th>{headerButton('plan_name', 'Zeichnung')}</th>
          <th>{headerButton('status', 'Status')}</th>
          <th>Kategorie</th>
          <th>{headerButton('priority', 'Priorität')}</th>
          <th>Zuständig</th>
          <th>{headerButton('due_date', 'Fällig')}</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => {
          const category = p.category_id ? categoryById.get(p.category_id) : undefined
          const assignee = p.assigned_to ? userById.get(p.assigned_to) : undefined
          return (
            <tr key={p.id} onClick={() => onSelect(p)}>
              <td onClick={(e) => e.stopPropagation()}>
                <input type="checkbox" checked={selectedIds.includes(p.id)} onChange={() => onToggleSelect(p.id)} />
              </td>
              <td style={{ fontSize: 12, color: 'var(--color-text-faint)', whiteSpace: 'nowrap' }}>
                {p.ticket_number ?? 'wird vergeben'}
              </td>
              <td>{p.title}</td>
              <td>{p.plan_name ?? '–'}</td>
              <td>
                <StatusBadge status={p.status} />
              </td>
              <td>{category && <CategoryBadge color={category.color} name={category.name} />}</td>
              <td>{p.priority && <PriorityBadge priority={p.priority} />}</td>
              <td>{assignee && <Avatar name={assignee.display_name} />}</td>
              <td style={{ fontSize: 12, color: 'var(--color-text-faint)' }}>{p.due_date ?? ''}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}
