import type { WebSocket } from 'ws';

export class WebSocketManager {
  private connections = new Map<string, Set<WebSocket>>();

  addConnection(userId: string, ws: WebSocket): void {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
    }
    this.connections.get(userId)!.add(ws);
  }

  removeConnection(userId: string, ws: WebSocket): void {
    const userConns = this.connections.get(userId);
    if (userConns) {
      userConns.delete(ws);
      if (userConns.size === 0) {
        this.connections.delete(userId);
      }
    }
  }

  notify(userId: string, data: unknown): void {
    const userConns = this.connections.get(userId);
    if (!userConns) return;

    const message = JSON.stringify(data);
    for (const ws of userConns) {
      if (ws.readyState === 1) {
        ws.send(message);
      }
    }
  }

  getConnectionCount(userId: string): number {
    return this.connections.get(userId)?.size ?? 0;
  }
}
