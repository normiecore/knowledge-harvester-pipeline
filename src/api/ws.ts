import type { WebSocket } from 'ws';

const MAX_CONNECTIONS_PER_USER = 5;
const PING_INTERVAL_MS = 30_000;

interface TrackedSocket {
  ws: WebSocket;
  isAlive: boolean;
  connectedAt: number;
}

export class WebSocketManager {
  private connections = new Map<string, Map<WebSocket, TrackedSocket>>();
  private pingTimer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.startPingLoop();
  }

  addConnection(userId: string, ws: WebSocket): void {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Map());
    }
    const userConns = this.connections.get(userId)!;

    // Enforce per-user connection limit: close the oldest if at capacity
    if (userConns.size >= MAX_CONNECTIONS_PER_USER) {
      let oldest: TrackedSocket | null = null;
      for (const tracked of userConns.values()) {
        if (!oldest || tracked.connectedAt < oldest.connectedAt) {
          oldest = tracked;
        }
      }
      if (oldest) {
        oldest.ws.close(4002, 'Connection limit exceeded');
        userConns.delete(oldest.ws);
      }
    }

    const tracked: TrackedSocket = { ws, isAlive: true, connectedAt: Date.now() };
    userConns.set(ws, tracked);

    // Listen for pong frames to mark connection alive
    ws.on('pong', () => {
      const t = userConns.get(ws);
      if (t) t.isAlive = true;
    });
  }

  removeConnection(userId: string, ws: WebSocket): void {
    const userConns = this.connections.get(userId);
    if (userConns) {
      userConns.delete(ws);
      ws.removeAllListeners('pong');
      if (userConns.size === 0) {
        this.connections.delete(userId);
      }
    }
  }

  notify(userId: string, data: unknown): void {
    const userConns = this.connections.get(userId);
    if (!userConns) return;

    const message = JSON.stringify(data);
    for (const [ws, _tracked] of userConns) {
      if (ws.readyState === 1) {
        try {
          ws.send(message);
        } catch {
          userConns.delete(ws);
        }
      }
    }
  }

  getConnectionCount(userId: string): number {
    return this.connections.get(userId)?.size ?? 0;
  }

  /**
   * Start the server-side ping loop. Sends a ping frame to every connection
   * every 30 seconds. If a connection did not respond with a pong since the
   * last ping (isAlive is still false), it is terminated.
   */
  private startPingLoop(): void {
    this.pingTimer = setInterval(() => {
      for (const [userId, userConns] of this.connections) {
        for (const [ws, tracked] of userConns) {
          if (!tracked.isAlive) {
            // No pong received since last ping -- connection is dead
            ws.terminate();
            userConns.delete(ws);
            continue;
          }

          // Mark as not-alive; will be set back to true when pong arrives
          tracked.isAlive = false;
          try {
            ws.ping();
          } catch {
            ws.terminate();
            userConns.delete(ws);
          }
        }
        if (userConns.size === 0) {
          this.connections.delete(userId);
        }
      }
    }, PING_INTERVAL_MS);

    // Allow the process to exit cleanly even if the ping loop is still active
    if (this.pingTimer && typeof this.pingTimer === 'object' && 'unref' in this.pingTimer) {
      (this.pingTimer as NodeJS.Timeout).unref();
    }
  }

  /** Stop the ping loop and close all connections. Call on server shutdown. */
  close(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
    for (const [_userId, userConns] of this.connections) {
      for (const [ws] of userConns) {
        try {
          ws.close(1001, 'Server shutting down');
        } catch {
          // ignore
        }
      }
    }
    this.connections.clear();
  }
}
