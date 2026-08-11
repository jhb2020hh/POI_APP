import type { Category, Point } from '@poi-app/shared'
import type { UserSummary } from '../api/client'
import { Avatar, CategoryBadge, PriorityBadge, StatusBadge } from './ui/Badge'

interface TicketListProps {
  points: Point[]
  categories: Category[]
  users: UserSummary[]
  onSelect: (point: Point) => void
}

export function TicketList({ points, categories, users, onSelect }: TicketListProps) {
  const categoryById = new Map(categories.map((c) => [c.id, c]))
  const userById = new Map(users.map((u) => [u.id, u]))

  if (points.length === 0) {
    return <div className="data-table-empty">Keine Tickets für die aktuellen Filter</div>
  }

  return (
    <div>
      {points.map((p) => {
        const category = p.category_id ? categoryById.get(p.category_id) : undefined
        const assignee = p.assigned_to ? userById.get(p.assigned_to) : undefined
        return (
          <div key={p.id} className="ticket-row" onClick={() => onSelect(p)}>
            <div className="ticket-row-title">{p.title}</div>
            <div className="ticket-row-meta">
              <StatusBadge status={p.status} />
              {category && <CategoryBadge color={category.color} name={category.name} />}
              {p.priority && <PriorityBadge priority={p.priority} />}
              {assignee && <Avatar name={assignee.display_name} />}
              {p.due_date && (
                <span style={{ fontSize: '12px', color: 'var(--color-text-faint)' }}>{p.due_date}</span>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
