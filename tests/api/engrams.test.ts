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

describe('engram routes', () => {
  let dbPath: string;
  let engramIndex: EngramIndex;
  let mockMuninnClient: any;
  let mockVaultManager: any;
  let mockWsManager: any;

  beforeEach(() => {
    dbPath = join(tmpdir(), `engram-test-${randomUUID()}.db`);
    engramIndex = new EngramIndex(dbPath);

    mockMuninnClient = {
      recall: vi.fn().mockResolvedValue({ engrams: [] }),
      read: vi.fn().mockResolvedValue({
        id: 'eng-1',
        concept: 'Test concept',
        content: JSON.stringify({
          user_id: 'user-1',
          approval_status: 'pending',
          concept: 'Test concept',
        }),
      }),
      remember: vi.fn().mockResolvedValue({ id: 'eng-1', concept: 'Test', content: '{}' }),
    };

    mockVaultManager = {
      storeApproved: vi.fn().mockResolvedValue(undefined),
      storePending: vi.fn().mockResolvedValue(undefined),
    };

    mockWsManager = {
      notify: vi.fn(),
    };
  });

  afterEach(() => {
    engramIndex.close();
    cleanupDb(dbPath);
  });

  async function buildApp() {
    const app = Fastify();
    // Inject fake user on all requests
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

  it('GET /api/engrams?status=pending returns filtered engrams', async () => {
    engramIndex.upsert({
      id: 'eng-1', userId: 'user-1', concept: 'Test concept',
      approvalStatus: 'pending', capturedAt: '2026-01-01T00:00:00Z',
      sourceType: 'graph_email', confidence: 0.9,
    });
    engramIndex.upsert({
      id: 'eng-2', userId: 'user-1', concept: 'Approved one',
      approvalStatus: 'approved', capturedAt: '2026-01-02T00:00:00Z',
      sourceType: 'graph_teams', confidence: 0.8,
    });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/engrams?status=pending' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.engrams).toHaveLength(1);
    expect(body.engrams[0].id).toBe('eng-1');
  });

  it('GET /api/engrams?status=approved returns empty for non-matching', async () => {
    engramIndex.upsert({
      id: 'eng-1', userId: 'user-1', concept: 'Test',
      approvalStatus: 'pending', capturedAt: '2026-01-01T00:00:00Z',
      sourceType: 'graph_email', confidence: 0.9,
    });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/engrams?status=approved' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.engrams).toHaveLength(0);
  });

  it('PATCH /api/engrams/:id updates approval status', async () => {
    engramIndex.upsert({
      id: 'eng-1', userId: 'user-1', concept: 'Test',
      approvalStatus: 'pending', capturedAt: '2026-01-01T00:00:00Z',
      sourceType: 'graph_email', confidence: 0.9,
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/engrams/eng-1',
      payload: { approval_status: 'approved', department: 'engineering' },
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.status).toBe('ok');
    expect(body.approval_status).toBe('approved');
    expect(mockVaultManager.storeApproved).toHaveBeenCalledTimes(1);

    // Verify index was updated
    const rows = engramIndex.listByStatus('user-1', 'approved');
    expect(rows).toHaveLength(1);
    expect(rows[0].id).toBe('eng-1');
  });

  it('GET /api/engrams without filters returns all engrams', async () => {
    engramIndex.upsert({
      id: 'eng-1', userId: 'user-1', concept: 'A',
      approvalStatus: 'pending', capturedAt: '2026-01-01T00:00:00Z',
      sourceType: 'graph_email', confidence: 0.9,
    });
    engramIndex.upsert({
      id: 'eng-2', userId: 'user-1', concept: 'B',
      approvalStatus: 'approved', capturedAt: '2026-01-02T00:00:00Z',
      sourceType: 'graph_teams', confidence: 0.8,
    });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/engrams' });
    const body = JSON.parse(res.body);

    expect(body.engrams).toHaveLength(2);
  });
});
