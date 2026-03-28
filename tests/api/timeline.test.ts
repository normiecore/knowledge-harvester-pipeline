import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import Fastify from 'fastify';
import { EngramIndex } from '../../src/storage/engram-index.js';
import { timelineRoutes, buildTimelineBlocks, type TimelineEngram } from '../../src/api/routes/timeline.js';

function cleanupDb(path: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

describe('timeline routes', () => {
  let dbPath: string;
  let engramIndex: EngramIndex;
  let mockMuninnClient: any;

  const TODAY = '2026-03-28';

  beforeEach(() => {
    dbPath = join(tmpdir(), `timeline-test-${randomUUID()}.db`);
    engramIndex = new EngramIndex(dbPath);

    mockMuninnClient = {
      read: vi.fn().mockResolvedValue({
        metadata: {
          sourceApp: 'VS Code',
          appCategory: 'editor',
          durationSeconds: 300,
          documentName: 'main.ts',
        },
      }),
    };
  });

  afterEach(() => {
    engramIndex.close();
    cleanupDb(dbPath);
  });

  async function buildApp() {
    const app = Fastify({ logger: false });
    app.decorateRequest('user', null);
    app.addHook('preHandler', async (req) => {
      (req as any).user = { userId: 'user-1', userEmail: 'alice@contoso.com' };
    });
    await app.register(timelineRoutes, {
      engramIndex,
      muninnClient: mockMuninnClient,
    });
    return app;
  }

  function seedEngrams() {
    engramIndex.upsert({
      id: 'eng-1', userId: 'user-1', concept: 'Editing main.ts',
      approvalStatus: 'approved', capturedAt: `${TODAY}T09:00:00.000Z`,
      sourceType: 'desktop_window', confidence: 0.9, tags: ['coding'],
    });
    engramIndex.upsert({
      id: 'eng-2', userId: 'user-1', concept: 'Browsing docs',
      approvalStatus: 'approved', capturedAt: `${TODAY}T10:30:00.000Z`,
      sourceType: 'desktop_window', confidence: 0.8, tags: ['research'],
    });
    engramIndex.upsert({
      id: 'eng-3', userId: 'user-1', concept: 'Teams meeting',
      approvalStatus: 'pending', capturedAt: `${TODAY}T14:00:00.000Z`,
      sourceType: 'graph_teams', confidence: 0.7, tags: ['meeting'],
    });
    // Different day - should not appear
    engramIndex.upsert({
      id: 'eng-4', userId: 'user-1', concept: 'Yesterday work',
      approvalStatus: 'approved', capturedAt: '2026-03-27T15:00:00.000Z',
      sourceType: 'desktop_window', confidence: 0.6, tags: ['old'],
    });
    // Different user - should not appear
    engramIndex.upsert({
      id: 'eng-5', userId: 'user-2', concept: 'Other user activity',
      approvalStatus: 'approved', capturedAt: `${TODAY}T11:00:00.000Z`,
      sourceType: 'desktop_window', confidence: 0.9, tags: ['other'],
    });
  }

  // --- GET /api/engrams/timeline ---

  it('returns timeline data for a specific date', async () => {
    seedEngrams();
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/engrams/timeline?date=${TODAY}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.date).toBe(TODAY);
    expect(body.blocks).toBeDefined();
    expect(Array.isArray(body.blocks)).toBe(true);
    expect(body.summary).toBeDefined();
    expect(body.summary.totalEngrams).toBe(3);
  });

  it('defaults to today when no date provided', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/engrams/timeline',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('rejects invalid date format', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/engrams/timeline?date=not-a-date',
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toContain('YYYY-MM-DD');
  });

  it('filters engrams to the specified day only', async () => {
    seedEngrams();
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/engrams/timeline?date=${TODAY}`,
    });

    const body = res.json();
    // Should have 3 engrams for today (eng-1, eng-2, eng-3), not eng-4 (yesterday) or eng-5 (other user)
    expect(body.summary.totalEngrams).toBe(3);
  });

  it('returns engrams sorted by captured_at', async () => {
    seedEngrams();
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/engrams/timeline?date=${TODAY}`,
    });

    const body = res.json();
    const allEngrams = body.blocks.flatMap((b: any) => b.engrams);
    for (let i = 1; i < allEngrams.length; i++) {
      expect(new Date(allEngrams[i].capturedAt).getTime())
        .toBeGreaterThanOrEqual(new Date(allEngrams[i - 1].capturedAt).getTime());
    }
  });

  it('enriches engrams with MuninnDB metadata', async () => {
    seedEngrams();
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/engrams/timeline?date=${TODAY}`,
    });

    const body = res.json();
    const allEngrams = body.blocks.flatMap((b: any) => b.engrams);
    expect(allEngrams[0].sourceApp).toBe('VS Code');
    expect(allEngrams[0].appCategory).toBe('editor');
    expect(allEngrams[0].durationSeconds).toBe(300);
  });

  it('handles MuninnDB read failures gracefully', async () => {
    seedEngrams();
    mockMuninnClient.read.mockRejectedValue(new Error('not found'));
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/engrams/timeline?date=${TODAY}`,
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Should still return engrams with default metadata
    const allEngrams = body.blocks.flatMap((b: any) => b.engrams);
    expect(allEngrams[0].appCategory).toBe('other');
    expect(allEngrams[0].durationSeconds).toBe(0);
  });

  it('returns empty blocks for a day with no activity', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: '/api/engrams/timeline?date=2020-01-01',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.blocks).toEqual([]);
    expect(body.summary.totalEngrams).toBe(0);
    expect(body.summary.totalActiveSeconds).toBe(0);
  });

  it('computes top apps in summary', async () => {
    seedEngrams();

    // Return different metadata per call
    let callCount = 0;
    mockMuninnClient.read.mockImplementation(async () => {
      callCount++;
      if (callCount <= 2) {
        return {
          metadata: { sourceApp: 'VS Code', appCategory: 'editor', durationSeconds: 300, documentName: 'file.ts' },
        };
      }
      return {
        metadata: { sourceApp: 'Teams', appCategory: 'communication', durationSeconds: 600, documentName: '' },
      };
    });

    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/api/engrams/timeline?date=${TODAY}`,
    });

    const body = res.json();
    expect(body.summary.topApps.length).toBeGreaterThan(0);
    expect(body.summary.topApps.length).toBeLessThanOrEqual(3);
    // Each top app should have app and seconds
    for (const app of body.summary.topApps) {
      expect(app.app).toBeDefined();
      expect(typeof app.seconds).toBe('number');
    }
  });
});

describe('buildTimelineBlocks', () => {
  it('returns empty array for no engrams', () => {
    expect(buildTimelineBlocks([])).toEqual([]);
  });

  it('groups nearby engrams of the same category', () => {
    const engrams: TimelineEngram[] = [
      {
        id: '1', concept: 'A', capturedAt: '2026-03-28T09:00:00.000Z',
        sourceType: 'win', sourceApp: 'VS Code', confidence: 0.9,
        appCategory: 'editor', durationSeconds: 120, documentName: 'a.ts', tags: '',
      },
      {
        id: '2', concept: 'B', capturedAt: '2026-03-28T09:03:00.000Z',
        sourceType: 'win', sourceApp: 'VS Code', confidence: 0.9,
        appCategory: 'editor', durationSeconds: 180, documentName: 'b.ts', tags: '',
      },
    ];

    const blocks = buildTimelineBlocks(engrams);
    expect(blocks.length).toBe(1);
    expect(blocks[0].engrams.length).toBe(2);
    expect(blocks[0].appCategory).toBe('editor');
    expect(blocks[0].totalDuration).toBe(300);
  });

  it('splits blocks when category changes', () => {
    const engrams: TimelineEngram[] = [
      {
        id: '1', concept: 'A', capturedAt: '2026-03-28T09:00:00.000Z',
        sourceType: 'win', sourceApp: 'VS Code', confidence: 0.9,
        appCategory: 'editor', durationSeconds: 120, documentName: 'a.ts', tags: '',
      },
      {
        id: '2', concept: 'B', capturedAt: '2026-03-28T09:03:00.000Z',
        sourceType: 'win', sourceApp: 'Chrome', confidence: 0.8,
        appCategory: 'browser', durationSeconds: 60, documentName: '', tags: '',
      },
    ];

    const blocks = buildTimelineBlocks(engrams);
    expect(blocks.length).toBe(2);
    expect(blocks[0].appCategory).toBe('editor');
    expect(blocks[1].appCategory).toBe('browser');
  });

  it('splits blocks when gap exceeds 5 minutes', () => {
    const engrams: TimelineEngram[] = [
      {
        id: '1', concept: 'A', capturedAt: '2026-03-28T09:00:00.000Z',
        sourceType: 'win', sourceApp: 'VS Code', confidence: 0.9,
        appCategory: 'editor', durationSeconds: 60, documentName: 'a.ts', tags: '',
      },
      {
        id: '2', concept: 'B', capturedAt: '2026-03-28T09:10:00.000Z',
        sourceType: 'win', sourceApp: 'VS Code', confidence: 0.9,
        appCategory: 'editor', durationSeconds: 60, documentName: 'b.ts', tags: '',
      },
    ];

    const blocks = buildTimelineBlocks(engrams);
    // 9:01 (end of first) to 9:10 (start of second) = 9 minute gap > 5 minutes
    expect(blocks.length).toBe(2);
  });
});
