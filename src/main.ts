import 'dotenv/config';
import { logger } from './config/logger.js';
import { loadConfig } from './config/index.js';
import { NatsClient } from './queue/nats-client.js';
import { TOPICS } from './queue/topics.js';
import { createGraphClient } from './ingestion/graph-client.js';
import { DeltaStore } from './ingestion/delta-store.js';
import { GraphPoller } from './ingestion/graph-poller.js';
import { Extractor } from './pipeline/extractor.js';
import { Deduplicator } from './pipeline/deduplicator.js';
import { PipelineProcessor } from './pipeline/processor.js';
import { PipelineMetrics } from './pipeline/metrics.js';
import { ConcurrencyLimiter } from './pipeline/concurrency-limiter.js';
import { MuninnDBClient } from './storage/muninndb-client.js';
import { VaultManager } from './storage/vault-manager.js';
import { EngramIndex } from './storage/engram-index.js';
import { WebSocketManager } from './api/ws.js';
import { createServer } from './api/server.js';
import { createAuthVerifier } from './api/auth.js';
import { RawCaptureSchema } from './types.js';
import { rebuildIndex } from './storage/rebuild-index.js';
import type { GraphUser, GraphPagedResponse } from './ingestion/graph-types.js';
import { UserCache } from './ingestion/user-cache.js';
import OpenAI from 'openai';
import type { Client } from '@microsoft/microsoft-graph-client';

/** Max concurrent user polls per cycle. */
const MAX_POLL_CONCURRENCY = 10;

/**
 * Fetch all users from Graph API, following @odata.nextLink for pagination.
 * Replaces the old `.top(999)` pattern that silently dropped users beyond page 1.
 */
async function fetchAllUsers(
  graphClient: Client,
  select: string,
): Promise<GraphUser[]> {
  const users: GraphUser[] = [];
  let url: string | undefined = `/users?$select=${encodeURIComponent(select)}&$top=999`;

  while (url) {
    const response: GraphPagedResponse<GraphUser> = await graphClient.api(url).get();
    users.push(...response.value);
    url = response['@odata.nextLink'];
  }

  return users;
}

async function main(): Promise<void> {
  const config = loadConfig();

  // NATS
  const nats = new NatsClient();
  await nats.connect(config.natsUrl);
  logger.info('Connected to NATS');

  // Graph client + DeltaStore
  const graphClient = createGraphClient({
    tenantId: config.azure.tenantId,
    clientId: config.azure.clientId,
    clientSecret: config.azure.clientSecret,
  });
  const deltaStore = new DeltaStore('delta-state.db');

  // OpenAI client for LLM extraction
  const openai = new OpenAI({ baseURL: config.llm.baseUrl, apiKey: 'not-needed' });
  const extractor = new Extractor(openai, config.llm.model);

  // SQLite-backed components
  const deduplicator = new Deduplicator('dedup-state.db');
  const engramIndex = new EngramIndex('engram-index.db');

  // MuninnDB + VaultManager
  const muninnClient = new MuninnDBClient(config.muninndb.url, config.muninndb.apiKey);
  const vaultManager = new VaultManager(muninnClient);

  // In-memory cache of Azure AD user profiles (department, etc.)
  const userCache = new UserCache();

  // Rebuild local index from MuninnDB on startup if requested.
  // Set REBUILD_INDEX=1 or pass --rebuild-index to force a full resync.
  const shouldRebuild =
    process.env.REBUILD_INDEX === '1' || process.argv.includes('--rebuild-index');
  if (shouldRebuild) {
    logger.info('Rebuilding local engram index from MuninnDB...');
    try {
      // Fetch user list from Graph API to know which vaults to sync
      const allUsers = await fetchAllUsers(graphClient, 'id');
      const userIds: string[] = allUsers.map((u) => u.id);

      const result = await rebuildIndex(muninnClient, engramIndex, userIds);
      logger.info({ synced: result.synced, errors: result.errors }, 'Index rebuild complete');
    } catch (err) {
      logger.warn({ err }, 'Index rebuild failed (continuing with existing index)');
    }
  }

  // WebSocket manager
  const wsManager = new WebSocketManager();

  // Pipeline metrics + concurrency limiter
  const metrics = new PipelineMetrics('metrics.db');
  const limiter = new ConcurrencyLimiter(config.maxConcurrentExtractions);

  // Pipeline processor
  const processor = new PipelineProcessor(
    extractor,
    deduplicator,
    vaultManager,
    (topic, data) => nats.publish(topic, data),
    engramIndex,
    limiter,
    metrics,
  );

  // Subscribe to raw captures on NATS
  nats.subscribe(TOPICS.RAW_CAPTURES, async (data) => {
    try {
      const capture = RawCaptureSchema.parse(data);
      const result = await processor.process(capture);
      logger.info({ captureId: capture.id, action: result.action }, 'Capture processed');

      if (result.action === 'stored') {
        wsManager.notify(capture.userId, {
          type: 'new_engram',
          captureId: capture.id,
        });
      }
    } catch (err) {
      logger.error({ err }, 'Failed to process capture');
      metrics.recordError();

      // Publish to dead letter topic
      try {
        nats.publish(TOPICS.DEAD_LETTER, {
          capture: data,
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        });
      } catch (dlErr) {
        logger.error({ err: dlErr }, 'Failed to publish to dead letter');
      }
    }
  });

  // Graph poller
  const graphPoller = new GraphPoller(graphClient, deltaStore, (capture) => {
    nats.publish(TOPICS.RAW_CAPTURES, capture);
  });

  // Concurrency limiter for parallel user polling (separate from extraction limiter)
  const pollLimiter = new ConcurrencyLimiter(MAX_POLL_CONCURRENCY);

  // Real poll loop: fetch users from Graph API and poll mail + teams in parallel
  const pollInterval = setInterval(async () => {
    try {
      const users = await fetchAllUsers(
        graphClient,
        'id,displayName,mail,userPrincipalName,department',
      );

      // Refresh the user cache with the latest Azure AD profiles
      userCache.refresh(users);

      // Poll each user concurrently, bounded by pollLimiter
      const tasks = users.map((user) =>
        pollLimiter.run(async () => {
          const email = user.mail || user.userPrincipalName;
          if (!email) return;

          try {
            await graphPoller.pollMail(user.id, email);
          } catch (err) {
            logger.error({ userId: user.id, err }, 'Failed to poll mail');
          }

          try {
            await graphPoller.pollTeamsChat(user.id, email);
          } catch (err) {
            logger.error({ userId: user.id, err }, 'Failed to poll teams');
          }

          try {
            await graphPoller.pollCalendar(user.id, email);
          } catch (err) {
            logger.error({ userId: user.id, err }, 'Failed to poll calendar');
          }

          try {
            await graphPoller.pollOneDrive(user.id, email);
          } catch (err) {
            logger.error({ userId: user.id, err }, 'Failed to poll onedrive');
          }
        }),
      );

      await Promise.all(tasks);

      metrics.recordPoll();
      logger.info({ userCount: users.length }, 'Poll cycle complete');
    } catch (err) {
      logger.error({ err }, 'Poll error');
    }
  }, config.pollIntervalMs);

  // Purge dismissed engrams older than 30 days — run on startup, then every 24h
  const PURGE_DISMISSED_DAYS = 30;
  const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

  const runPurge = () => {
    try {
      const purged = engramIndex.purgeOlderThan(PURGE_DISMISSED_DAYS);
      if (purged > 0) {
        logger.info({ purged, days: PURGE_DISMISSED_DAYS }, 'Purged dismissed engrams');
      }
    } catch (err) {
      logger.error({ err }, 'Failed to purge dismissed engrams');
    }
  };

  runPurge();
  const purgeInterval = setInterval(runPurge, PURGE_INTERVAL_MS);

  // Auth verifier
  const authVerifier = createAuthVerifier({
    mode: config.auth.mode,
    devSecret: config.auth.devSecret,
    azureAdAudience: config.auth.azureAdAudience,
    azureTenantId: config.azure.tenantId,
  });

  // Fastify server
  const server = await createServer({
    muninnClient,
    vaultManager,
    engramIndex,
    wsManager,
    authVerifier,
    metrics,
    natsClient: nats,
    userCache,
    config: {
      llmBaseUrl: config.llm.baseUrl,
      muninndbUrl: config.muninndb.url,
    },
  });

  await server.listen({ port: 3001, host: '0.0.0.0' });
  logger.info('Server listening on port 3001');

  // Graceful shutdown
  const shutdown = async () => {
    logger.info('Shutting down...');
    clearInterval(pollInterval);
    clearInterval(purgeInterval);
    await server.close();
    await nats.disconnect();
    deltaStore.close();
    deduplicator.close();
    engramIndex.close();
    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep reference to graphPoller to avoid GC
  (globalThis as any).__graphPoller = graphPoller;
}

main().catch((err) => {
  logger.error('Fatal error:', err);
  process.exit(1);
});
