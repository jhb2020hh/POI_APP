import type { Point } from '@poi-app/shared'
import { supabase } from '../supabase'
import { getToken } from './client'

export type PlanSocketEvent =
  | { type: 'connected'; planId: string }
  | { type: 'point.created'; point: Point }
  | { type: 'point.updated'; point: Point }
  | { type: 'point.deleted'; pointId: string }

/**
 * Live-Aktualisierung ueber Supabase Realtime.
 *
 * Frueher lief das ueber einen eigenen WebSocket-Server im Backend. Der ist in
 * einer Serverless-Umgebung nicht haltbar, weil es dort keinen dauerhaft
 * laufenden Prozess gibt, der Verbindungen offen halten koennte. Stattdessen
 * liefert Supabase die Aenderungen direkt aus dem Transaktionslog der Datenbank
 * aus - wer was sehen darf, entscheidet die Regel poi_can_read_point (siehe
 * Migration 0020).
 *
 * Die Signatur ist absichtlich unveraendert geblieben, damit die Auswertung in
 * App.tsx gleich bleibt. Verbindungsabbrueche fangt supabase-js selbst ab; die
 * frueher fehlende Wiederverbindungslogik entfaellt damit als Baustelle.
 */
export function connectPlanSocket(
  planId: string,
  onEvent: (event: PlanSocketEvent) => void,
): () => void {
  // Ohne den aktuellen Token wuerde Realtime als anonymer Nutzer verbinden und
  // die Zeilenfilter wuerden nichts durchlassen.
  const token = getToken()
  if (token) supabase.realtime.setAuth(token)

  const channel = supabase
    .channel(`plan:${planId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'points',
        filter: `plan_id=eq.${planId}`,
      },
      (payload) => {
        const next = payload.new as Point | undefined
        const previous = payload.old as Point | undefined

        if (payload.eventType === 'INSERT' && next) {
          onEvent({ type: 'point.created', point: next })
          return
        }

        if (payload.eventType === 'UPDATE' && next) {
          // Loeschen ist fachlich ein Update auf deleted = 1. Der Client soll
          // den Punkt dann aber entfernen und nicht aktualisieren.
          if (next.deleted) {
            onEvent({ type: 'point.deleted', pointId: next.id })
          } else {
            onEvent({ type: 'point.updated', point: next })
          }
          return
        }

        if (payload.eventType === 'DELETE' && previous?.id) {
          onEvent({ type: 'point.deleted', pointId: previous.id })
        }
      },
    )
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        onEvent({ type: 'connected', planId })
      }
    })

  return () => {
    void supabase.removeChannel(channel)
  }
}
