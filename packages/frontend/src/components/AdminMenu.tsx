import { useState } from 'react'
import type { Category, Project } from '@poi-app/shared'
import type { UserSummary } from '../api/client'
import { ProjectAdmin } from './ProjectAdmin'
import { UserManagement } from './UserManagement'
import { TemplateManagement } from './TemplateManagement'
import { LetterheadManagement } from './LetterheadManagement'
import { Zeichen } from './Zeichen'

interface AdminMenuProps {
  users: UserSummary[]
  templates: Category[]
  projects: Project[]
  onUserCreated: () => void
  onTemplatesChanged: () => void
  onProjectsChanged: () => void
  onClose: () => void
}

export function AdminMenu({
  users,
  templates,
  projects,
  onUserCreated,
  onTemplatesChanged,
  onProjectsChanged,
  onClose,
}: AdminMenuProps) {
  const [tab, setTab] = useState<'users' | 'projects' | 'templates' | 'letterhead'>('users')

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Admin-Menü</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Schließen">
            <Zeichen name="schliessen" />
          </button>
        </div>
        <div className="tabs">
          <button type="button" className={`tab ${tab === 'users' ? 'active' : ''}`} onClick={() => setTab('users')}>
            Nutzer
          </button>
          <button
            type="button"
            className={`tab ${tab === 'projects' ? 'active' : ''}`}
            onClick={() => setTab('projects')}
          >
            Projekte
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
          {tab === 'projects' && <ProjectAdmin projects={projects} onChanged={onProjectsChanged} />}
          {tab === 'templates' && <TemplateManagement templates={templates} onChanged={onTemplatesChanged} />}
          {tab === 'letterhead' && <LetterheadManagement />}
        </div>
      </div>
    </div>
  )
}
