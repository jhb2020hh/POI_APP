import type { WebSocket } from "@fastify/websocket";

const clientsByPlan = new Map<string, Set<WebSocket>>();

export function subscribe(planId: string, socket: WebSocket): void {
  let sockets = clientsByPlan.get(planId);
  if (!sockets) {
    sockets = new Set();
    clientsByPlan.set(planId, sockets);
  }
  sockets.add(socket);

  socket.on("close", () => {
    sockets?.delete(socket);
    if (sockets && sockets.size === 0) {
      clientsByPlan.delete(planId);
    }
  });
}

export function broadcastToPlan(
  planId: string,
  event: { type: string; [key: string]: unknown }
): void {
  const sockets = clientsByPlan.get(planId);
  if (!sockets) return;
  const payload = JSON.stringify(event);
  for (const socket of sockets) {
    if (socket.readyState === socket.OPEN) {
      socket.send(payload);
    }
  }
}
