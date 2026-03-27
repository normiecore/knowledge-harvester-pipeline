import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import Fastify from 'fastify';
import { EngramIndex } from '../../src/storage/engram-index.js';
import { analyticsRoutes } from '../../src/api/routes/analytics.js';

function cleanupDb(path: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

describe('analytics routes', () => {
  let dbPath: string;
  let engramIndex: EngramIndex;
  let mockMetrics: any;

  beforeEach(() => {
    dbPath = join(tmpdir(), `analytics-test-${randomUUID()}.db`);
    engramIndex = new EngramIndex(dbPath);

    mockMetrics = {
      snapshot: vi.fn().mockReturnValue({
        processed_total: 42,
        blocked_total: 3,
        deduplicated_total: 5,
        errors_total: 1,
      }),
    };
  });

  afterEach(() => {
    engramIndex.close();
    cleanupDb(dbPath);
  });

  async function buildApp(metrics?: any) {
    const app = Fastify({ logger: false });
    app.decorateRequest('user', null);
    app.addHook('preHandler', async (req) => {
      (req as any).user = { userId: 'user-1', userEmail: 'alice@contoso.com' };
    });
    await app.register(analyticsRoutes, {
      engramIndex,
      metrics: metrics ?? mockMetrics,
    });
    return app;
  }

  function seedEngrams() {
    engramIndex.upsert({
      id: 'eng-1', userId: 'user-1', concept: 'Email about valves',
      approvalStatus: 'approved', capturedAt: new Date().toISOString(),
      sourceType: 'graph_email', confidence: 0.9, tags: ['valves', 'engineering'],
    });
    engramIndex.upsert({
      id: 'eng-2', userId: 'user-1', concept: 'Teams message about schedules',
      approvalStatus: 'pending', capturedAt: new Date().toISOString(),
      sourceType: 'graph_teams', confidence: 0.7, tags: ['schedule', 'project'],
    });
    engramIndex.upsert({
      id: 'eng-3', userId: 'user-1', concept: 'Screenshot of FEA report',
      approvalStatus: 'dismissed', capturedAt: new Date().toISOString(),
      sourceType: 'desktop_screenshot', confidence: 0.5, tags: ['engineering', 'fea'],
    });
    engramIndex.upsert({
      id: 'eng-4', userId: 'user-1', concept: 'Window capture of CAD',
      approvalStatus: 'approved', capturedAt: new Date().toISOString(),
      sourceType: 'desktop_window', confidence: 0.85, tags: ['engineering', 'cad'],
    });
  }

  // --- /api/analytics/overview ---

  it('GET /api/analytics/overview returns summary stats', async () => {
    seedEngrams();
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/analytics/overview' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.totalEngrams).toBe(4);
    expect(body.byStatus.approved).toBe(2);
    expect(body.byStatus.pending).toBe(1);
    expect(body.byStatus.dismissed).toBe(1);
    expect(body.captures).toHaveProperty('today');
    expect(body.captures).toHaveProperty('week');
    expect(body.captures).toHaveProperty('month');
    expect(typeof body.avgConfidence).toBe('number');
    expect(body.avgConfidence).toBeGreaterThan(0);
    expect(body.pipeline.processed_total).toBe(42);
  });

  it('GET /api/analytics/overview returns zeros for empty database', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/analytics/overview' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.totalEngrams).toBe(0);
    expect(body.byStatus.pending).toBe(0);
    expect(body.byStatus.approved).toBe(0);
    expect(body.byStatus.dismissed).toBe(0);
    expect(body.avgConfidence).toBe(0);
  });

  it('GET /api/analytics/overview returns default pipeline metrics when no metrics provided', async () => {
    seedEngrams();
    const app = await buildApp(undefined);
    // Re-build without metrics
    const app2 = Fastify({ logger: false });
    app2.decorateRequest('user', null);
    app2.addHook('preHandler', async (req) => {
      (req as any).user = { userId: 'user-1', userEmail: 'alice@contoso.com' };
    });
    await app2.register(analyticsRoutes, { engramIndex });

    const res = await app2.inject({ method: 'GET', url: '/api/analytics/overview' });
    const body = JSON.parse(res.body);

    expect(body.pipeline.processed_total).toBe(0);
    expect(body.pipeline.errors_total).toBe(0);
  });

  // --- /api/analytics/volume ---

  it('GET /api/analytics/volume returns time-series data with default period', async () => {
    seedEngrams();
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/analytics/volume' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.period).toBe('day');
    expect(body.days).toBe(14);
    expect(Array.isArray(body.volume)).toBe(true);
    expect(body.volume.length).toBeGreaterThan(0);
    // Each row should have date, count, approved, dismissed, pending
    const row = body.volume[0];
    expect(row).toHaveProperty('date');
    expect(row).toHaveProperty('count');
    expect(row).toHaveProperty('approved');
    expect(row).toHaveProperty('dismissed');
    expect(row).toHaveProperty('pending');
  });

  it('GET /api/analytics/volume?period=week uses 7 days', async () => {
    seedEngrams();
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/analytics/volume?period=week' });
    const body = JSON.parse(res.body);

    expect(body.period).toBe('week');
    expect(body.days).toBe(7);
  });

  it('GET /api/analytics/volume?period=month uses 30 days', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/analytics/volume?period=month' });
    const body = JSON.parse(res.body);

    expect(body.period).toBe('month');
    expect(body.days).toBe(30);
  });

  it('GET /api/analytics/volume returns empty array for empty database', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/analytics/volume' });
    const body = JSON.parse(res.body);

    expect(body.volume).toHaveLength(0);
  });

  // --- /api/analytics/sources ---

  it('GET /api/analytics/sources returns source breakdown with percentages', async () => {
    seedEngrams();
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/analytics/sources' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(body.sources)).toBe(true);
    expect(body.sources.length).toBe(4); // 4 distinct source types

    // Each source should have source, count, percentage
    for (const s of body.sources) {
      expect(s).toHaveProperty('source');
      expect(s).toHaveProperty('count');
      expect(s).toHaveProperty('percentage');
      expect(typeof s.percentage).toBe('number');
    }

    // Percentages should roughly sum to 100
    const totalPct = body.sources.reduce((sum: number, s: any) => sum + s.percentage, 0);
    expect(totalPct).toBeCloseTo(100, 0);
  });

  it('GET /api/analytics/sources returns empty for empty database', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/analytics/sources' });
    const body = JSON.parse(res.body);

    expect(body.sources).toHaveLength(0);
  });

  // --- /api/analytics/top-tags ---

  it('GET /api/analytics/top-tags returns tags sorted by frequency', async () => {
    seedEngrams();
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/analytics/top-tags' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(body.tags)).toBe(true);
    expect(body.tags.length).toBeGreaterThan(0);

    // 'engineering' appears in eng-1, eng-3, eng-4 = 3 times, should be first
    expect(body.tags[0].tag).toBe('engineering');
    expect(body.tags[0].count).toBe(3);

    // Verify sorted descending
    for (let i = 1; i < body.tags.length; i++) {
      expect(body.tags[i].count).toBeLessThanOrEqual(body.tags[i - 1].count);
    }
  });

  it('GET /api/analytics/top-tags?limit=2 limits results', async () => {
    seedEngrams();
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/analytics/top-tags?limit=2' });
    const body = JSON.parse(res.body);

    expect(body.tags).toHaveLength(2);
  });

  it('GET /api/analytics/top-tags returns empty for empty database', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/analytics/top-tags' });
    const body = JSON.parse(res.body);

    expect(body.tags).toHaveLength(0);
  });

  // --- /api/analytics/confidence ---

  it('GET /api/analytics/confidence returns distribution buckets', async () => {
    seedEngrams();
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/analytics/confidence' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(body.distribution)).toBe(true);
    expect(body.distribution).toHaveLength(5);

    // All 5 buckets should be present
    const ranges = body.distribution.map((d: any) => d.range);
    expect(ranges).toEqual(['0.0-0.2', '0.2-0.4', '0.4-0.6', '0.6-0.8', '0.8-1.0']);

    // Total counts should match seeded data
    const totalCount = body.distribution.reduce((s: number, d: any) => s + d.count, 0);
    expect(totalCount).toBe(4);
  });

  it('GET /api/analytics/confidence returns all-zero buckets for empty database', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/analytics/confidence' });
    const body = JSON.parse(res.body);

    expect(body.distribution).toHaveLength(5);
    for (const bucket of body.distribution) {
      expect(bucket.count).toBe(0);
    }
  });
});
