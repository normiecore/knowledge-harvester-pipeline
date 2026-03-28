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

describe('Engram route input validation', () => {
  let dbPath: string;
  let engramIndex: EngramIndex;
  let mockMuninnClient: any;
  let mockVaultManager: any;
  let mockWsManager: any;

  beforeEach(() => {
    dbPath = join(tmpdir(), `engrams-val-test-${randomUUID()}.db`);
    engramIndex = new EngramIndex(dbPath);
    mockMuninnClient = {
      recall: vi.fn().mockResolvedValue({ engrams: [] }),
      read: vi.fn().mockResolvedValue({
        id: 'eng-1',
        concept: 'Test',
        content: JSON.stringify({ user_id: 'user-1', approval_status: 'pending', concept: 'Test' }),
      }),
      remember: vi.fn().mockResolvedValue({ id: 'x', concept: 'x', content: '{}' }),
    };
    mockVaultManager = {
      storeApproved: vi.fn().mockResolvedValue(undefined),
    };
    mockWsManager = { notify: vi.fn() };
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
    });
    return app;
  }

  it('PATCH /api/engrams/:id rejects invalid approval_status', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/engrams/eng-1',
      payload: { approval_status: 'hacked' },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/approval_status/);
  });

  it('PATCH /api/engrams/:id accepts "approved"', async () => {
    engramIndex.upsert({
      id: 'eng-1', userId: 'user-1', concept: 'Test',
      approvalStatus: 'pending', capturedAt: '2026-01-01T00:00:00Z',
      sourceType: 'graph_email', confidence: 0.9,
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/engrams/eng-1',
      payload: { approval_status: 'approved' },
    });
    expect(res.statusCode).toBe(200);
  });

  it('POST /api/engrams/bulk rejects more than 100 ids', async () => {
    const app = await buildApp();
    const ids = Array.from({ length: 101 }, (_, i) => `eng-${i}`);
    const res = await app.inject({
      method: 'POST',
      url: '/api/engrams/bulk',
      payload: { ids, action: 'approve' },
    });
    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.error).toMatch(/100/);
  });

  it('GET /api/engrams clamps limit to max 200', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/engrams?limit=9999',
    });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.limit).toBeLessThanOrEqual(200);
  });
});
