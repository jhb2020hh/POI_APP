import type { ReactNode } from 'react'
import { PRIORITY_LABELS, STATUS_LABELS } from '../../constants'

export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status] ?? status}</span>
}

export function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={`badge badge-priority-${priority}`}>{PRIORITY_LABELS[priority] ?? priority}</span>
  )
}

export function CategoryBadge({ color, name }: { color: string; name: string }) {
  return (
    <span className="badge badge-neutral">
      <span className="badge-dot" style={{ background: color }} />
      {name}
    </span>
  )
}

export function Avatar({ name }: { name: string }) {
  const initials = name
    .split(' ')
    .map((part) => part[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
  return (
    <span className="avatar" title={name}>
      {initials}
    </span>
  )
}

export function IconButton({
  children,
  onClick,
  title,
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  title?: string
  type?: 'button' | 'submit'
}) {
  return (
    <button type={type} className="icon-btn" onClick={onClick} title={title} aria-label={title}>
      {children}
    </button>
  )
}
