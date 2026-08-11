import { useState } from 'react'
import type { Category } from '@poi-app/shared'
import type { UserSummary } from '../api/client'
import { UserManagement } from './UserManagement'
import { TemplateManagement } from './TemplateManagement'
import { LetterheadManagement } from './LetterheadManagement'

interface AdminMenuProps {
  users: UserSummary[]
  templates: Category[]
  onUserCreated: () => void
  onTemplatesChanged: () => void
  onClose: () => void
}

export function AdminMenu({ users, templates, onUserCreated, onTemplatesChanged, onClose }: AdminMenuProps) {
  const [tab, setTab] = useState<'users' | 'templates' | 'letterhead'>('users')

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Admin-Menü</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Schließen">
            ✕
          </button>
        </div>
        <div className="tabs">
          <button type="button" className={`tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>
            Nutzer
          </button>
          <button
            type="button"
            className={`tab ${tab === 'templates' ? 'active' : ''}`}
            onClick={() => setTab('templates')}
          >
            Ticketvorlagen
          </button>
          <button
            type="button"
            className={`tab ${tab === 'letterhead' ? 'active' : ''}`}
            onClick={() => setTab('letterhead')}
          >
            Briefkopf
          </button>
        </div>
        <div className="modal-body">
          {tab === 'users' && <UserManagement users={users} onUserCreated={onUserCreated} />}
          {tab === 'templates' && <TemplateManagement templates={templates} onChanged={onTemplatesChanged} />}
          {tab === 'letterhead' && <LetterheadManagement />}
        </div>
      </div>
    </div>
  )
}
