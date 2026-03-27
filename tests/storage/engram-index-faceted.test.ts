import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { EngramIndex } from '../../src/storage/engram-index.js';

function cleanupDb(path: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

describe('EngramIndex queryFaceted', () => {
  let dbPath: string;
  let index: EngramIndex;

  beforeEach(() => {
    dbPath = join(tmpdir(), `engram-faceted-test-${randomUUID()}.db`);
    index = new EngramIndex(dbPath);

    // Seed a variety of engrams for faceted queries
    index.upsert({
      id: 'e1', userId: 'user-1', concept: 'Email meeting notes',
      approvalStatus: 'approved', capturedAt: '2026-01-10T08:00:00Z',
      sourceType: 'graph_email', confidence: 0.95, department: 'Engineering',
    });
    index.upsert({
      id: 'e2', userId: 'user-1', concept: 'Teams chat summary',
      approvalStatus: 'pending', capturedAt: '2026-02-15T10:00:00Z',
      sourceType: 'graph_teams', confidence: 0.7, department: 'Engineering',
    });
    index.upsert({
      id: 'e3', userId: 'user-1', concept: 'Desktop window capture',
      approvalStatus: 'approved', capturedAt: '2026-03-20T14:00:00Z',
      sourceType: 'desktop_window', confidence: 0.5, department: 'Operations',
    });
    index.upsert({
      id: 'e4', userId: 'user-1', concept: 'Another email insight',
      approvalStatus: 'dismissed', capturedAt: '2026-04-01T09:00:00Z',
      sourceType: 'graph_email', confidence: 0.85, department: 'Engineering',
    });
    index.upsert({
      id: 'e5', userId: 'user-2', concept: 'Other user engram',
      approvalStatus: 'pending', capturedAt: '2026-01-20T12:00:00Z',
      sourceType: 'graph_email', confidence: 0.6, department: 'Sales',
    });
  });

  afterEach(() => {
    index.close();
    cleanupDb(dbPath);
  });

  it('queryFaceted with no filters returns all engrams for user', () => {
    const result = index.queryFaceted('user-1', {});

    expect(result.total).toBe(4);
    expect(result.engrams).toHaveLength(4);
    expect(result.limit).toBe(20);
    expect(result.offset).toBe(0);
  });

  it('queryFaceted does not return other users engrams', () => {
    const result = index.queryFaceted('user-2', {});

    expect(result.total).toBe(1);
    expect(result.engrams[0].id).toBe('e5');
  });

  it('queryFaceted filters by source type', () => {
    const result = index.queryFaceted('user-1', { source: 'graph_email' });

    expect(result.total).toBe(2);
    for (const e of result.engrams) {
      expect(e.sourceType).toBe('graph_email');
    }
  });

  it('queryFaceted filters by date range (from)', () => {
    const result = index.queryFaceted('user-1', { from: '2026-03-01' });

    expect(result.total).toBe(2);
    for (const e of result.engrams) {
      expect(e.capturedAt >= '2026-03-01').toBe(true);
    }
  });

  it('queryFaceted filters by date range (to)', () => {
    const result = index.queryFaceted('user-1', { to: '2026-02-28' });

    expect(result.total).toBe(2);
    for (const e of result.engrams) {
      expect(e.capturedAt <= '2026-02-28').toBe(true);
    }
  });

  it('queryFaceted filters by date range (from and to)', () => {
    const result = index.queryFaceted('user-1', { from: '2026-02-01', to: '2026-03-31' });

    expect(result.total).toBe(2);
    const ids = result.engrams.map((e) => e.id);
    expect(ids).toContain('e2');
    expect(ids).toContain('e3');
  });

  it('queryFaceted filters by confidence range (min)', () => {
    const result = index.queryFaceted('user-1', { confidence_min: 0.8 });

    expect(result.total).toBe(2);
    for (const e of result.engrams) {
      expect(e.confidence).toBeGreaterThanOrEqual(0.8);
    }
  });

  it('queryFaceted filters by confidence range (max)', () => {
    const result = index.queryFaceted('user-1', { confidence_max: 0.7 });

    expect(result.total).toBe(2);
    for (const e of result.engrams) {
      expect(e.confidence).toBeLessThanOrEqual(0.7);
    }
  });

  it('queryFaceted filters by confidence range (min and max)', () => {
    const result = index.queryFaceted('user-1', { confidence_min: 0.6, confidence_max: 0.9 });

    expect(result.total).toBe(2);
    for (const e of result.engrams) {
      expect(e.confidence).toBeGreaterThanOrEqual(0.6);
      expect(e.confidence).toBeLessThanOrEqual(0.9);
    }
  });

  it('queryFaceted with combined filters', () => {
    const result = index.queryFaceted('user-1', {
      source: 'graph_email',
      status: 'approved',
      confidence_min: 0.9,
    });

    expect(result.total).toBe(1);
    expect(result.engrams[0].id).toBe('e1');
    expect(result.engrams[0].sourceType).toBe('graph_email');
    expect(result.engrams[0].approvalStatus).toBe('approved');
    expect(result.engrams[0].confidence).toBeGreaterThanOrEqual(0.9);
  });

  it('queryFaceted pagination with offset and limit', () => {
    const page1 = index.queryFaceted('user-1', { limit: 2, offset: 0 });
    expect(page1.engrams).toHaveLength(2);
    expect(page1.total).toBe(4);
    expect(page1.limit).toBe(2);
    expect(page1.offset).toBe(0);

    const page2 = index.queryFaceted('user-1', { limit: 2, offset: 2 });
    expect(page2.engrams).toHaveLength(2);
    expect(page2.total).toBe(4);
    expect(page2.offset).toBe(2);

    // No overlap between pages
    const page1Ids = page1.engrams.map((e) => e.id);
    const page2Ids = page2.engrams.map((e) => e.id);
    for (const id of page1Ids) {
      expect(page2Ids).not.toContain(id);
    }
  });

  it('queryFaceted returns empty when no matches', () => {
    const result = index.queryFaceted('user-1', { source: 'nonexistent_source' });

    expect(result.total).toBe(0);
    expect(result.engrams).toHaveLength(0);
  });

  it('queryFaceted filters by status', () => {
    const result = index.queryFaceted('user-1', { status: 'pending' });

    expect(result.total).toBe(1);
    expect(result.engrams[0].id).toBe('e2');
  });

  it('queryFaceted filters by department', () => {
    const result = index.queryFaceted('user-1', { department: 'Operations' });

    expect(result.total).toBe(1);
    expect(result.engrams[0].id).toBe('e3');
  });
});
