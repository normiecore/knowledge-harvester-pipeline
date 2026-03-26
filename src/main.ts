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
import { MuninnDBClient } from './storage/muninndb-client.js';
import { VaultManager } from './storage/vault-manager.js';
import { EngramIndex } from './storage/engram-index.js';
import { WebSocketManager } from './api/ws.js';
import { createServer } from './api/server.js';
import { RawCaptureSchema } from './types.js';
import OpenAI from 'openai';

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

  // WebSocket manager
  const wsManager = new WebSocketManager();

  // Pipeline processor
  const processor = new PipelineProcessor(
    extractor,
    deduplicator,
    vaultManager,
    (topic, data) => nats.publish(topic, data),
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
    }
  });

  // Graph poller
  const graphPoller = new GraphPoller(graphClient, deltaStore, (capture) => {
    nats.publish(TOPICS.RAW_CAPTURES, capture);
  });

  // Poll on interval (placeholder user list — in production, fetch from Azure AD)
  const pollInterval = setInterval(async () => {
    try {
      // TODO: Fetch user list from Azure AD or config
      // For now, this is a placeholder
      console.log('Poll cycle complete');
    } catch (err) {
      console.error('Poll error:', err);
    }
  }, config.pollIntervalMs);

  // Fastify server
  const server = await createServer({
    muninnClient,
    vaultManager,
    engramIndex,
    wsManager,
  });

  await server.listen({ port: 3001, host: '0.0.0.0' });
  console.log('Server listening on port 3001');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    clearInterval(pollInterval);
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
