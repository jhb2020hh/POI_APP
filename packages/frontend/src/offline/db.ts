import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Plan, Point, Project } from '@poi-app/shared'
import { genId } from '../utils/id'

export interface PendingChange {
  localId: string
  projectId: string
  op: 'create' | 'update' | 'delete'
  point: {
    id: string
    planId: string
    x?: number
    y?: number
    pageNumber?: number
    pointType?: string
    categoryId?: string
    customFields?: Record<string, string | number | boolean>
    title?: string
    description?: string
    bauabschnitt?: string
    priority?: string
    assignedTo?: string
    dueDate?: string
    gewerk?: string
    raumBereich?: string
    version?: number
  }
  createdAt: string
}

interface PoiOfflineDB extends DBSchema {
  projects: { key: string; value: Project }
  plans: { key: string; value: Plan; indexes: { 'by-project': string } }
  points: { key: string; value: Point; indexes: { 'by-plan': string } }
  syncMeta: { key: string; value: { projectId: string; cursor: number } }
  pendingChanges: {
    key: string
    value: PendingChange
    indexes: { 'by-project': string }
  }
}

let dbPromise: Promise<IDBPDatabase<PoiOfflineDB>> | null = null

function getDb(): Promise<IDBPDatabase<PoiOfflineDB>> {
  if (!dbPromise) {
    dbPromise = openDB<PoiOfflineDB>('poi-app-offline', 2, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('projects')) {
          db.createObjectStore('projects', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('plans')) {
          const plans = db.createObjectStore('plans', { keyPath: 'id' })
          plans.createIndex('by-project', 'project_id')
        }
        if (!db.objectStoreNames.contains('points')) {
          const points = db.createObjectStore('points', { keyPath: 'id' })
          points.createIndex('by-plan', 'plan_id')
        }
        if (!db.objectStoreNames.contains('syncMeta')) {
          db.createObjectStore('syncMeta', { keyPath: 'projectId' })
        }
        if (!db.objectStoreNames.contains('pendingChanges')) {
          const pending = db.createObjectStore('pendingChanges', { keyPath: 'localId' })
          pending.createIndex('by-project', 'projectId')
        }
      },
    })
  }
  return dbPromise
}

export async function saveOfflineBundle(bundle: {
  project: Project
  plans: Plan[]
  pointsByPlan: Record<string, Point[]>
  syncCursor: number
}): Promise<void> {
  const db = await getDb()
  const tx = db.transaction(['projects', 'plans', 'points', 'syncMeta'], 'readwrite')

  await tx.objectStore('projects').put(bundle.project)
  for (const plan of bundle.plans) {
    await tx.objectStore('plans').put(plan)
  }
  for (const points of Object.values(bundle.pointsByPlan)) {
    for (const point of points) {
      await tx.objectStore('points').put(point)
    }
  }
  await tx.objectStore('syncMeta').put({ projectId: bundle.project.id, cursor: bundle.syncCursor })
  await tx.done
}

export async function getOfflineProjects(): Promise<Project[]> {
  const db = await getDb()
  return db.getAll('projects')
}

export async function getOfflinePlansByProject(projectId: string): Promise<Plan[]> {
  const db = await getDb()
  return db.getAllFromIndex('plans', 'by-project', projectId)
}

export async function getOfflinePointsByPlan(planId: string): Promise<Point[]> {
  const db = await getDb()
  const points = await db.getAllFromIndex('points', 'by-plan', planId)
  return points.filter((p) => !p.deleted)
}

export async function getOfflinePlanProjectId(planId: string): Promise<string | undefined> {
  const db = await getDb()
  const plan = await db.get('plans', planId)
  return plan?.project_id
}

export async function isProjectAvailableOffline(projectId: string): Promise<boolean> {
  const db = await getDb()
  const meta = await db.get('syncMeta', projectId)
  return Boolean(meta)
}

export async function getSyncCursor(projectId: string): Promise<number> {
  const db = await getDb()
  const meta = await db.get('syncMeta', projectId)
  return meta?.cursor ?? 0
}

export async function setSyncCursor(projectId: string, cursor: number): Promise<void> {
  const db = await getDb()
  await db.put('syncMeta', { projectId, cursor })
}

export async function addPendingChange(change: Omit<PendingChange, 'localId' | 'createdAt'>): Promise<void> {
  const db = await getDb()
  await db.put('pendingChanges', {
    ...change,
    localId: genId(),
    createdAt: new Date().toISOString(),
  })
}

export async function getPendingChanges(projectId: string): Promise<PendingChange[]> {
  const db = await getDb()
  return db.getAllFromIndex('pendingChanges', 'by-project', projectId)
}

export async function getAllPendingChangeCount(): Promise<number> {
  const db = await getDb()
  return db.count('pendingChanges')
}

export async function clearPendingChanges(localIds: string[]): Promise<void> {
  const db = await getDb()
  const tx = db.transaction('pendingChanges', 'readwrite')
  for (const id of localIds) {
    await tx.store.delete(id)
  }
  await tx.done
}

export async function putLocalPoint(point: Point): Promise<void> {
  const db = await getDb()
  await db.put('points', point)
}

export async function applyIncomingPoints(points: Point[]): Promise<void> {
  const db = await getDb()
  const tx = db.transaction('points', 'readwrite')
  for (const point of points) {
    if (point.deleted) {
      await tx.store.delete(point.id)
    } else {
      await tx.store.put(point)
    }
  }
  await tx.done
}
