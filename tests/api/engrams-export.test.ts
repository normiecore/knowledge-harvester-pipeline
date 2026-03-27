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

describe('engrams export routes', () => {
  let dbPath: string;
  let engramIndex: EngramIndex;
  let mockMuninnClient: any;
  let mockVaultManager: any;
  let mockWsManager: any;

  beforeEach(() => {
    dbPath = join(tmpdir(), `engram-export-test-${randomUUID()}.db`);
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

  function seedEngrams() {
    engramIndex.upsert({
      id: 'eng-1', userId: 'user-1', concept: 'Email knowledge',
      approvalStatus: 'approved', capturedAt: '2026-01-01T00:00:00Z',
      sourceType: 'graph_email', confidence: 0.9, tags: ['email', 'project'],
    });
    engramIndex.upsert({
      id: 'eng-2', userId: 'user-1', concept: 'Teams insight',
      approvalStatus: 'pending', capturedAt: '2026-01-02T00:00:00Z',
      sourceType: 'graph_teams', confidence: 0.8, tags: ['teams'],
    });
    engramIndex.upsert({
      id: 'eng-3', userId: 'user-1', concept: 'Dismissed item',
      approvalStatus: 'dismissed', capturedAt: '2026-01-03T00:00:00Z',
      sourceType: 'desktop_window', confidence: 0.5,
    });
  }

  // --- GET /api/engrams/export?format=json ---

  it('GET /api/engrams/export?format=json returns JSON array', async () => {
    seedEngrams();

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/engrams/export?format=json' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(3);
  });

  // --- GET /api/engrams/export?format=csv ---

  it('GET /api/engrams/export?format=csv returns CSV with correct headers', async () => {
    seedEngrams();

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/engrams/export?format=csv' });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');

    const lines = res.body.split('\n');
    expect(lines[0]).toBe('id,concept,source_type,confidence,tags,approval_status,captured_at');
    expect(lines.length).toBe(4); // header + 3 data rows
  });

  it('GET /api/engrams/export?format=csv has Content-Disposition header', async () => {
    seedEngrams();

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/engrams/export?format=csv' });

    expect(res.headers['content-disposition']).toBe('attachment; filename="engrams-export.csv"');
  });

  // --- GET /api/engrams/export?status=approved ---

  it('GET /api/engrams/export?status=approved filters by status', async () => {
    seedEngrams();

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/engrams/export?format=json&status=approved' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].id).toBe('eng-1');
  });

  // --- Empty export ---

  it('GET /api/engrams/export returns empty array when no engrams', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/engrams/export?format=json' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(0);
  });

  it('GET /api/engrams/export?format=csv returns only header when no engrams', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/engrams/export?format=csv' });

    const lines = res.body.split('\n');
    expect(lines).toHaveLength(1); // header only
    expect(lines[0]).toContain('id,concept');
  });
});
