import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import Fastify from 'fastify';
import { EngramIndex } from '../../src/storage/engram-index.js';
import { engramRoutes } from '../../src/api/routes/engrams.js';

function cleanupDb(path: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

describe('POST /api/engrams/bulk', () => {
  let dbPath: string;
  let engramIndex: EngramIndex;
  let mockMuninnClient: any;
  let mockVaultManager: any;
  let mockWsManager: any;
  let mockAuditStore: any;

  beforeEach(() => {
    dbPath = join(tmpdir(), `engrams-bulk-test-${randomUUID()}.db`);
    engramIndex = new EngramIndex(dbPath);

    mockMuninnClient = {
      recall: vi.fn().mockResolvedValue({ engrams: [] }),
      read: vi.fn().mockImplementation((_vault: string, id: string) => {
        return Promise.resolve({
          id,
          concept: `Concept for ${id}`,
          content: JSON.stringify({
            user_id: 'user-1',
            approval_status: 'pending',
            concept: `Concept for ${id}`,
          }),
        });
      }),
      remember: vi.fn().mockResolvedValue({ id: 'x', concept: 'x', content: '{}' }),
    };

    mockVaultManager = {
      storeApproved: vi.fn().mockResolvedValue(undefined),
      storePending: vi.fn().mockResolvedValue(undefined),
    };

    mockWsManager = { notify: vi.fn() };
    mockAuditStore = { log: vi.fn() };
  });

  afterEach(() => {
    engramIndex.close();
    cleanupDb(dbPath);
  });

  async function buildApp() {
    const app = Fastify();
    app.decorateRequest('user', null);
    app.addHook('preHandler', async (req) => {
      (req as any).user = { userId: 'user-1', userEmail: 'alice@contoso.com' };
    });
    await app.register(engramRoutes, {
      muninnClient: mockMuninnClient,
      vaultManager: mockVaultManager,
      engramIndex,
      wsManager: mockWsManager,
      auditStore: mockAuditStore,
    });
    return app;
  }

  function seedEngrams(ids: string[]) {
    for (const id of ids) {
      engramIndex.upsert({
        id, userId: 'user-1', concept: `Concept ${id}`,
        approvalStatus: 'pending', capturedAt: '2026-01-01T00:00:00Z',
        sourceType: 'graph_email', confidence: 0.9,
      });
    }
  }

  it('approves multiple engrams and returns processed count', async () => {
    seedEngrams(['eng-1', 'eng-2', 'eng-3']);

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/engrams/bulk',
      payload: { ids: ['eng-1', 'eng-2', 'eng-3'], action: 'approve' },
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.processed).toBe(3);
    expect(body.failed).toBe(0);
    expect(mockVaultManager.storeApproved).toHaveBeenCalledTimes(3);
    expect(mockWsManager.notify).toHaveBeenCalledTimes(3);
  });

  it('dismisses multiple engrams and returns processed count', async () => {
    seedEngrams(['eng-1', 'eng-2']);

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/engrams/bulk',
      payload: { ids: ['eng-1', 'eng-2'], action: 'dismiss' },
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.processed).toBe(2);
    expect(body.failed).toBe(0);
    expect(mockMuninnClient.remember).toHaveBeenCalledTimes(2);
    expect(mockVaultManager.storeApproved).not.toHaveBeenCalled();
  });

  it('returns processed and failed counts when some ids fail', async () => {
    seedEngrams(['eng-1']);

    // Make the second id throw from muninnClient.read
    mockMuninnClient.read.mockImplementation((_vault: string, id: string) => {
      if (id === 'eng-bad') return Promise.reject(new Error('not found'));
      return Promise.resolve({
        id,
        concept: `Concept for ${id}`,
        content: JSON.stringify({
          user_id: 'user-1',
          approval_status: 'pending',
          concept: `Concept for ${id}`,
        }),
      });
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/engrams/bulk',
      payload: { ids: ['eng-1', 'eng-bad'], action: 'approve' },
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.processed).toBe(1);
    expect(body.failed).toBe(1);
  });

  it('returns 400 for invalid action', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/engrams/bulk',
      payload: { ids: ['eng-1'], action: 'invalid' },
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(400);
    expect(body.error).toMatch(/action must be/);
  });

  it('returns 400 for empty ids array', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: '/api/engrams/bulk',
      payload: { ids: [], action: 'approve' },
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(400);
    expect(body.error).toMatch(/non-empty array/);
  });
});
