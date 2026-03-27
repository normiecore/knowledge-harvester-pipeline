import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import Fastify from 'fastify';
import { DeadLetterStore } from '../../src/storage/dead-letter-store.js';
import { deadLetterRoutes } from '../../src/api/routes/dead-letters.js';

function cleanupDb(path: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

describe('dead-letters retry route', () => {
  let dbPath: string;
  let deadLetterStore: DeadLetterStore;
  let mockNatsClient: any;

  beforeEach(() => {
    dbPath = join(tmpdir(), `dead-letter-retry-test-${randomUUID()}.db`);
    deadLetterStore = new DeadLetterStore(dbPath);

    mockNatsClient = {
      publish: vi.fn(),
    };
  });

  afterEach(() => {
    deadLetterStore.close();
    cleanupDb(dbPath);
  });

  async function buildApp(natsClient: any = mockNatsClient) {
    const app = Fastify();
    app.decorateRequest('user', null);
    app.addHook('preHandler', async (req) => {
      (req as any).user = { userId: 'user-1', userEmail: 'alice@contoso.com' };
    });
    await app.register(deadLetterRoutes, { deadLetterStore, natsClient });
    return app;
  }

  // --- POST /api/dead-letters/:id/retry ---

  it('POST /api/dead-letters/:id/retry requeues successfully', async () => {
    deadLetterStore.insert('cap-1', 'timeout', 3, { type: 'capture', data: 'test' });
    const items = deadLetterStore.list(1);
    const id = items[0].id;

    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: `/api/dead-letters/${id}/retry` });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.status).toBe('requeued');
    expect(mockNatsClient.publish).toHaveBeenCalledTimes(1);
    expect(mockNatsClient.publish).toHaveBeenCalledWith(
      'raw.captures',
      { type: 'capture', data: 'test' },
    );
  });

  it('POST /api/dead-letters/:id/retry returns 404 for non-existent dead letter', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/dead-letters/9999/retry' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(404);
    expect(body.error).toBe('Dead letter not found');
  });

  it('dead letter is removed after successful retry', async () => {
    deadLetterStore.insert('cap-2', 'parse error', 1, { msg: 'hello' });
    const items = deadLetterStore.list(1);
    const id = items[0].id;

    expect(deadLetterStore.count()).toBe(1);

    const app = await buildApp();
    await app.inject({ method: 'POST', url: `/api/dead-letters/${id}/retry` });

    expect(deadLetterStore.count()).toBe(0);
    expect(deadLetterStore.get(id)).toBeUndefined();
  });

  it('POST /api/dead-letters/:id/retry returns 503 when NATS unavailable', async () => {
    deadLetterStore.insert('cap-3', 'error', 1, { data: 'x' });
    const items = deadLetterStore.list(1);
    const id = items[0].id;

    const app = await buildApp(null);
    const res = await app.inject({ method: 'POST', url: `/api/dead-letters/${id}/retry` });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(503);
    expect(body.error).toBe('NATS client unavailable');
  });

  it('POST /api/dead-letters/:id/retry returns 400 for invalid ID', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/dead-letters/abc/retry' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(400);
    expect(body.error).toBe('Invalid ID');
  });
});
