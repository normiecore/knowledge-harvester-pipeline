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

describe('EngramIndex.findRelatedByTags', () => {
  let dbPath: string;
  let index: EngramIndex;

  beforeEach(() => {
    dbPath = join(tmpdir(), `engram-related-test-${randomUUID()}.db`);
    index = new EngramIndex(dbPath);
  });

  afterEach(() => {
    index.close();
    cleanupDb(dbPath);
  });

  it('returns engrams that share at least one tag', () => {
    index.upsert({
      id: 'eng-1', userId: 'user-1', concept: 'Valve pressure analysis',
      approvalStatus: 'approved', capturedAt: '2026-03-27T10:00:00Z',
      sourceType: 'graph_email', confidence: 0.9,
      tags: ['valves', 'engineering', 'pressure'],
    });
    index.upsert({
      id: 'eng-2', userId: 'user-1', concept: 'Valve maintenance schedule',
      approvalStatus: 'approved', capturedAt: '2026-03-27T11:00:00Z',
      sourceType: 'graph_teams', confidence: 0.8,
      tags: ['valves', 'maintenance'],
    });
    index.upsert({
      id: 'eng-3', userId: 'user-1', concept: 'Engineering standards review',
      approvalStatus: 'pending', capturedAt: '2026-03-27T12:00:00Z',
      sourceType: 'desktop_window', confidence: 0.7,
      tags: ['engineering', 'standards'],
    });

    const related = index.findRelatedByTags('user-1', 'eng-1');

    expect(related.length).toBe(2);
    const ids = related.map((r) => r.id);
    expect(ids).toContain('eng-2'); // shares 'valves'
    expect(ids).toContain('eng-3'); // shares 'engineering'
  });

  it('excludes the source engram from results', () => {
    index.upsert({
      id: 'eng-1', userId: 'user-1', concept: 'Source',
      approvalStatus: 'approved', capturedAt: '2026-03-27T10:00:00Z',
      sourceType: 'graph_email', confidence: 0.9,
      tags: ['shared-tag'],
    });
    index.upsert({
      id: 'eng-2', userId: 'user-1', concept: 'Related',
      approvalStatus: 'approved', capturedAt: '2026-03-27T11:00:00Z',
      sourceType: 'graph_email', confidence: 0.8,
      tags: ['shared-tag'],
    });

    const related = index.findRelatedByTags('user-1', 'eng-1');

    expect(related).toHaveLength(1);
    expect(related[0].id).toBe('eng-2');
  });

  it('returns empty array when source engram has no tags', () => {
    index.upsert({
      id: 'eng-1', userId: 'user-1', concept: 'No tags',
      approvalStatus: 'approved', capturedAt: '2026-03-27T10:00:00Z',
      sourceType: 'graph_email', confidence: 0.9,
    });
    index.upsert({
      id: 'eng-2', userId: 'user-1', concept: 'Has tags',
      approvalStatus: 'approved', capturedAt: '2026-03-27T11:00:00Z',
      sourceType: 'graph_email', confidence: 0.8,
      tags: ['something'],
    });

    const related = index.findRelatedByTags('user-1', 'eng-1');
    expect(related).toHaveLength(0);
  });

  it('returns empty array when no other engrams share tags', () => {
    index.upsert({
      id: 'eng-1', userId: 'user-1', concept: 'Unique topic',
      approvalStatus: 'approved', capturedAt: '2026-03-27T10:00:00Z',
      sourceType: 'graph_email', confidence: 0.9,
      tags: ['unique-tag-xyz'],
    });
    index.upsert({
      id: 'eng-2', userId: 'user-1', concept: 'Different topic',
      approvalStatus: 'approved', capturedAt: '2026-03-27T11:00:00Z',
      sourceType: 'graph_email', confidence: 0.8,
      tags: ['completely-different'],
    });

    const related = index.findRelatedByTags('user-1', 'eng-1');
    expect(related).toHaveLength(0);
  });

  it('returns empty array for non-existent engram', () => {
    const related = index.findRelatedByTags('user-1', 'nonexistent');
    expect(related).toHaveLength(0);
  });

  it('does not return engrams from other users', () => {
    index.upsert({
      id: 'eng-1', userId: 'user-1', concept: 'User 1 engram',
      approvalStatus: 'approved', capturedAt: '2026-03-27T10:00:00Z',
      sourceType: 'graph_email', confidence: 0.9,
      tags: ['shared-tag'],
    });
    index.upsert({
      id: 'eng-2', userId: 'user-2', concept: 'User 2 engram',
      approvalStatus: 'approved', capturedAt: '2026-03-27T11:00:00Z',
      sourceType: 'graph_email', confidence: 0.8,
      tags: ['shared-tag'],
    });

    const related = index.findRelatedByTags('user-1', 'eng-1');
    expect(related).toHaveLength(0);
  });

  it('respects the limit parameter', () => {
    index.upsert({
      id: 'eng-source', userId: 'user-1', concept: 'Source',
      approvalStatus: 'approved', capturedAt: '2026-03-27T10:00:00Z',
      sourceType: 'graph_email', confidence: 0.9,
      tags: ['common'],
    });

    for (let i = 1; i <= 10; i++) {
      index.upsert({
        id: `eng-${i}`, userId: 'user-1', concept: `Related ${i}`,
        approvalStatus: 'approved', capturedAt: `2026-03-27T${10 + i}:00:00Z`,
        sourceType: 'graph_email', confidence: 0.8,
        tags: ['common'],
      });
    }

    const related = index.findRelatedByTags('user-1', 'eng-source', 3);
    expect(related).toHaveLength(3);
  });
});
