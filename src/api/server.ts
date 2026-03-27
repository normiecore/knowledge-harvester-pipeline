import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyInstance } from 'fastify';
import { logger } from '../config/logger.js';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import rateLimit from '@fastify/rate-limit';
import type { AuthVerifier } from './auth.js';
import { engramRoutes } from './routes/engrams.js';
import { captureRoutes } from './routes/captures.js';
import { statsRoutes } from './routes/stats.js';
import type { MuninnDBClient } from '../storage/muninndb-client.js';
import type { VaultManager } from '../storage/vault-manager.js';
import type { EngramIndex } from '../storage/engram-index.js';
import type { WebSocketManager } from './ws.js';
import type { PipelineMetrics } from '../pipeline/metrics.js';
import type { NatsClient } from '../queue/nats-client.js';
import type { UserCache } from '../ingestion/user-cache.js';

export interface ServerDeps {
  muninnClient: MuninnDBClient;
  vaultManager: VaultManager;
  engramIndex: EngramIndex;
  wsManager: WebSocketManager;
  authVerifier: AuthVerifier;
  metrics?: PipelineMetrics;
  natsClient?: NatsClient;
  userCache?: UserCache;
  config?: { llmBaseUrl: string; muninndbUrl: string };
}

async function checkUrl(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
    return res.ok;
  } catch {
    return false;
  }
}

export async function createServer(deps: ServerDeps): Promise<FastifyInstance> {
  const app = Fastify({ logger: logger.child({ component: 'fastify' }) });

  await app.register(fastifyWebsocket);

  // Rate limiting: 100 requests per minute per IP for API routes
  await app.register(rateLimit, {
    max: 100,
    timeWindow: '1 minute',
    allowList: ['127.0.0.1', '::1'],
    keyGenerator: (req) => req.ip,
  });

  // Serve frontend static files
  await app.register(fastifyStatic, {
    root: path.join(process.cwd(), 'frontend-dist'),
    prefix: '/',
    wildcard: false,
    decorateReply: true,
  });

  // Enriched health check — no auth
  app.get('/api/health', async () => {
    const checks: Record<string, boolean> = {};

    if (deps.config?.llmBaseUrl) {
      checks.vllm = await checkUrl(`${deps.config.llmBaseUrl}/health`);
    }
    if (deps.config?.muninndbUrl) {
      checks.muninndb = await checkUrl(`${deps.config.muninndbUrl}/health`);
    }
    if (deps.natsClient) {
      checks.nats = deps.natsClient.isConnected();
    }

    const allHealthy = Object.values(checks).every(Boolean);

    return {
      status: allHealthy ? 'ok' : 'degraded',
      timestamp: new Date().toISOString(),
      checks,
      metrics: deps.metrics?.snapshot() ?? null,
    };
  });

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
    wsManager: deps.wsManager,
    userCache: deps.userCache,
  });

  if (deps.natsClient) {
    await app.register(captureRoutes, {
      natsClient: deps.natsClient,
    });
  }

  await app.register(statsRoutes, {
    muninnClient: deps.muninnClient,
  });

  // WebSocket endpoint
  // Browsers cannot set custom headers on WebSocket connections, so we accept
  // the token as a query parameter (?token=<jwt>) instead of via the
  // Authorization header.  The header is still checked as a fallback so that
  // non-browser clients (e.g. tests, CLI tools) keep working.
  app.get('/ws/engrams', { websocket: true }, async (socket, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const queryToken = url.searchParams.get('token');
    const authHeader = req.headers.authorization;

    const bearerToken = queryToken
      ? `Bearer ${queryToken}`
      : authHeader ?? '';

    if (!bearerToken) {
      socket.close(4001, 'Missing authorization');
      return;
    }

    try {
      const user = await deps.authVerifier(bearerToken);
      deps.wsManager.addConnection(user.userId, socket);

      socket.on('close', () => {
        deps.wsManager.removeConnection(user.userId, socket);
      });
    } catch {
      socket.close(4001, 'Invalid authorization');
    }
  });

  // SPA fallback — serve index.html for non-API/WS routes
  app.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api/') || req.url.startsWith('/ws/')) {
      reply.code(404).send({ error: 'Not found' });
    } else {
      reply.sendFile('index.html');
    }
  });

  return app;
}
