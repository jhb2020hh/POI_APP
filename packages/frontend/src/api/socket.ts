import type { Point } from '@poi-app/shared'
import { getToken } from './client'

export type PlanSocketEvent =
  | { type: 'connected'; planId: string }
  | { type: 'point.created'; point: Point }
  | { type: 'point.updated'; point: Point }
  | { type: 'point.deleted'; pointId: string }

export function connectPlanSocket(
  planId: string,
  onEvent: (event: PlanSocketEvent) => void
): () => void {
  const token = getToken()
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  const url = `${protocol}//${window.location.host}/ws/plans/${planId}?token=${encodeURIComponent(token ?? '')}`

  const socket = new WebSocket(url)
  socket.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data) as PlanSocketEvent
      onEvent(data)
    } catch {
      // ignore malformed messages
    }
  }

  return () => socket.close()
}
