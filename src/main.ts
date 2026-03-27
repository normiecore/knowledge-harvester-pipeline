import 'dotenv/config';
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
  console.log('Connected to NATS');

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

  // Rebuild local index from MuninnDB on startup if requested.
  // Set REBUILD_INDEX=1 or pass --rebuild-index to force a full resync.
  const shouldRebuild =
    process.env.REBUILD_INDEX === '1' || process.argv.includes('--rebuild-index');
  if (shouldRebuild) {
    console.log('Rebuilding local engram index from MuninnDB...');
    try {
      // Fetch user list from Graph API to know which vaults to sync
      const allUsers = await fetchAllUsers(graphClient, 'id');
      const userIds: string[] = allUsers.map((u) => u.id);

      const result = await rebuildIndex(muninnClient, engramIndex, userIds);
      console.log(`Index rebuild complete: ${result.synced} synced, ${result.errors} errors`);
    } catch (err) {
      console.warn('Index rebuild failed (continuing with existing index):', err);
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
      console.log(`Processed capture ${capture.id}: ${result.action}`);

      if (result.action === 'stored') {
        wsManager.notify(capture.userId, {
          type: 'new_engram',
          captureId: capture.id,
        });
      }
    } catch (err) {
      console.error('Failed to process capture:', err);
      metrics.recordError();

      // Publish to dead letter topic
      try {
        nats.publish(TOPICS.DEAD_LETTER, {
          capture: data,
          error: err instanceof Error ? err.message : String(err),
          timestamp: new Date().toISOString(),
        });
      } catch (dlErr) {
        console.error('Failed to publish to dead letter:', dlErr);
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
        'id,displayName,mail,userPrincipalName',
      );

      // Poll each user concurrently, bounded by pollLimiter
      const tasks = users.map((user) =>
        pollLimiter.run(async () => {
          const email = user.mail || user.userPrincipalName;
          if (!email) return;

          try {
            await graphPoller.pollMail(user.id, email);
          } catch (err) {
            console.error(`Failed to poll mail for ${user.id}:`, err);
          }

          try {
            await graphPoller.pollTeamsChat(user.id, email);
          } catch (err) {
            console.error(`Failed to poll teams for ${user.id}:`, err);
          }
        }),
      );

      await Promise.all(tasks);

      metrics.recordPoll();
      console.log(`Poll cycle complete — ${users.length} users`);
    } catch (err) {
      console.error('Poll error:', err);
    }
  }, config.pollIntervalMs);

  // Purge dismissed engrams older than 30 days — run on startup, then every 24h
  const PURGE_DISMISSED_DAYS = 30;
  const PURGE_INTERVAL_MS = 24 * 60 * 60 * 1000;

  const runPurge = () => {
    try {
      const purged = engramIndex.purgeOlderThan(PURGE_DISMISSED_DAYS);
      if (purged > 0) {
        console.log(`Purged ${purged} dismissed engram(s) older than ${PURGE_DISMISSED_DAYS} days`);
      }
    } catch (err) {
      console.error('Failed to purge dismissed engrams:', err);
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
    config: {
      llmBaseUrl: config.llm.baseUrl,
      muninndbUrl: config.muninndb.url,
    },
  });

  await server.listen({ port: 3001, host: '0.0.0.0' });
  console.log('Server listening on port 3001');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    clearInterval(pollInterval);
    clearInterval(purgeInterval);
    await server.close();
    await nats.disconnect();
    deltaStore.close();
    deduplicator.close();
    engramIndex.close();
    console.log('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Keep reference to graphPoller to avoid GC
  (globalThis as any).__graphPoller = graphPoller;
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
