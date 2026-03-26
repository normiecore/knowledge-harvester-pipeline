import Fastify, { type FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import type { AuthVerifier } from './auth.js';
import { engramRoutes } from './routes/engrams.js';
import { statsRoutes } from './routes/stats.js';
import type { MuninnDBClient } from '../storage/muninndb-client.js';
import type { VaultManager } from '../storage/vault-manager.js';
import type { EngramIndex } from '../storage/engram-index.js';
import type { WebSocketManager } from './ws.js';

export interface ServerDeps {
  muninnClient: MuninnDBClient;
  vaultManager: VaultManager;
  engramIndex: EngramIndex;
  wsManager: WebSocketManager;
  authVerifier: AuthVerifier;
}

export async function createServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: true });

  await app.register(fastifyWebsocket);

  // Health check — no auth
  app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Auth preHandler for all /api routes except health and /ws/
  app.addHook('preHandler', async (req, reply) => {
    const url = req.url;
    if (url === '/api/health' || url.startsWith('/ws/')) return;
    if (!url.startsWith('/api/')) return;

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      reply.code(401).send({ error: 'Missing authorization header' });
      return;
    }

    try {
      (req as any).user = await deps.authVerifier(authHeader);
    } catch (err: any) {
      reply.code(401).send({ error: err.message });
    }
  });

  // Register routes
  await app.register(engramRoutes, {
    muninnClient: deps.muninnClient,
    vaultManager: deps.vaultManager,
    engramIndex: deps.engramIndex,
  });

  await app.register(statsRoutes, {
    muninnClient: deps.muninnClient,
  });

  // WebSocket endpoint
  app.get('/ws/engrams', { websocket: true }, async (socket, req) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      socket.close(4001, 'Missing authorization');
      return;
    }

    try {
      const user = await deps.authVerifier(authHeader);
      deps.wsManager.addConnection(user.userId, socket);

      socket.on('close', () => {
        deps.wsManager.removeConnection(user.userId, socket);
      });
    } catch {
      socket.close(4001, 'Invalid authorization');
    }
  });

  return app;
}
