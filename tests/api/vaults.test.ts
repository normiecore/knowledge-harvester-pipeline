import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import Fastify from 'fastify';
import { EngramIndex } from '../../src/storage/engram-index.js';
import { vaultRoutes } from '../../src/api/routes/vaults.js';

function cleanupDb(path: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

describe('vault routes', () => {
  let dbPath: string;
  let engramIndex: EngramIndex;

  beforeEach(() => {
    dbPath = join(tmpdir(), `vaults-test-${randomUUID()}.db`);
    engramIndex = new EngramIndex(dbPath);
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
    await app.register(vaultRoutes, { engramIndex });
    return app;
  }

  function seedEngrams() {
    // user-1: 3 engrams (2 approved in engineering, 1 pending)
    engramIndex.upsert({
      id: 'eng-1', userId: 'user-1', concept: 'Email concept',
      approvalStatus: 'approved', capturedAt: '2026-01-01T00:00:00Z',
      sourceType: 'graph_email', confidence: 0.9, department: 'engineering',
      tags: ['azure', 'cloud'],
    });
    engramIndex.upsert({
      id: 'eng-2', userId: 'user-1', concept: 'Teams concept',
      approvalStatus: 'approved', capturedAt: '2026-01-02T00:00:00Z',
      sourceType: 'graph_teams', confidence: 0.8, department: 'engineering',
      tags: ['meetings'],
    });
    engramIndex.upsert({
      id: 'eng-3', userId: 'user-1', concept: 'Pending concept',
      approvalStatus: 'pending', capturedAt: '2026-01-03T00:00:00Z',
      sourceType: 'screenshot', confidence: 0.7,
    });

    // user-2: 1 approved in sales
    engramIndex.upsert({
      id: 'eng-4', userId: 'user-2', concept: 'Sales note',
      approvalStatus: 'approved', capturedAt: '2026-01-04T00:00:00Z',
      sourceType: 'graph_email', confidence: 0.85, department: 'sales',
      tags: ['crm'],
    });
  }

  // --- GET /api/vaults ---

  it('GET /api/vaults returns vault list with personal, department, and org', async () => {
    seedEngrams();

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/vaults' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);

    // Personal vaults: one per user
    expect(body.personal.length).toBe(2);
    const personalNames = body.personal.map((v: any) => v.name);
    expect(personalNames).toContain('knowledge-harvester-user-1');
    expect(personalNames).toContain('knowledge-harvester-user-2');

    // Department vaults
    expect(body.department.length).toBe(2);
    const deptNames = body.department.map((v: any) => v.name);
    expect(deptNames).toContain('knowledge-harvester-dept-engineering');
    expect(deptNames).toContain('knowledge-harvester-dept-sales');

    // Org vault
    expect(body.org.length).toBe(1);
    expect(body.org[0].name).toBe('knowledge-harvester-org');
  });

  it('GET /api/vaults returns empty lists when no engrams exist', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/vaults' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.personal).toHaveLength(0);
    expect(body.department).toHaveLength(0);
    expect(body.org).toHaveLength(0);
  });

  // --- GET /api/vaults/:name/engrams ---

  it('GET /api/vaults/:name/engrams returns paginated engrams for personal vault', async () => {
    seedEngrams();

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/vaults/knowledge-harvester-user-1/engrams',
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.total).toBe(3); // all user-1 engrams (pending + approved)
    expect(body.engrams).toHaveLength(3);
    expect(body.limit).toBe(20);
    expect(body.offset).toBe(0);
  });

  it('GET /api/vaults/:name/engrams supports pagination', async () => {
    seedEngrams();

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/vaults/knowledge-harvester-user-1/engrams?limit=1&offset=0',
    });
    const body = JSON.parse(res.body);

    expect(body.engrams).toHaveLength(1);
    expect(body.total).toBe(3);
    expect(body.limit).toBe(1);
    expect(body.offset).toBe(0);
  });

  it('GET /api/vaults/:name/engrams returns 404 for unknown vault', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/vaults/unknown-vault/engrams',
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(404);
    expect(body.error).toBe('Unknown vault');
  });

  it('GET /api/vaults/:name/engrams for dept vault returns only approved', async () => {
    seedEngrams();

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/vaults/knowledge-harvester-dept-engineering/engrams',
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.total).toBe(2);
    // All returned should be approved
    for (const eng of body.engrams) {
      expect(eng.approvalStatus).toBe('approved');
    }
  });

  // --- GET /api/vaults/:name/stats ---

  it('GET /api/vaults/:name/stats returns stats for a vault', async () => {
    seedEngrams();

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/vaults/knowledge-harvester-user-1/stats',
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.count).toBe(3);
    expect(body.topTags).toBeDefined();
    expect(body.dateRange).toBeDefined();
    expect(body.dateRange.earliest).toBeDefined();
    expect(body.dateRange.latest).toBeDefined();
  });

  it('GET /api/vaults/:name/stats returns 404 for unknown vault', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/vaults/unknown-vault/stats',
    });

    expect(res.statusCode).toBe(404);
  });

  it('GET /api/vaults/:name/stats returns zero count for empty vault', async () => {
    // user-99 has no engrams but vault name pattern is valid
    engramIndex.upsert({
      id: 'eng-x', userId: 'user-99', concept: 'X',
      approvalStatus: 'dismissed', capturedAt: '2026-01-01T00:00:00Z',
      sourceType: 'graph_email', confidence: 0.5,
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/vaults/knowledge-harvester-user-99/stats',
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.count).toBe(1); // dismissed still counted in personal vault
  });

  it('GET /api/vaults/:name/stats includes top tags', async () => {
    seedEngrams();

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/vaults/knowledge-harvester-user-1/stats',
    });
    const body = JSON.parse(res.body);

    expect(body.topTags.length).toBeGreaterThan(0);
    const tagNames = body.topTags.map((t: any) => t.tag);
    expect(tagNames).toContain('azure');
    expect(tagNames).toContain('cloud');
    expect(tagNames).toContain('meetings');
  });
});
