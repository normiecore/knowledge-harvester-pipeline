import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { EngramIndex } from '../../src/storage/engram-index.js';
import { generateDigest } from '../../src/pipeline/digest.js';

function cleanupDb(path: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

describe('generateDigest', () => {
  let dbPath: string;
  let engramIndex: EngramIndex;

  beforeEach(() => {
    dbPath = join(tmpdir(), `digest-test-${randomUUID()}.db`);
    engramIndex = new EngramIndex(dbPath);
  });

  afterEach(() => {
    engramIndex.close();
    cleanupDb(dbPath);
  });

  function recentTimestamp(hoursAgo: number): string {
    return new Date(Date.now() - hoursAgo * 3600_000).toISOString();
  }

  function seedApprovedEngrams(count: number, opts?: {
    tags?: readonly string[];
    sourceType?: string;
    confidence?: number;
    hoursAgo?: number;
  }) {
    for (let i = 0; i < count; i++) {
      engramIndex.upsert({
        id: `eng-${randomUUID()}`,
        userId: 'user-1',
        concept: `Concept ${i}`,
        approvalStatus: 'approved',
        capturedAt: recentTimestamp(opts?.hoursAgo ?? 2),
        sourceType: opts?.sourceType ?? 'graph_email',
        confidence: opts?.confidence ?? 0.8,
        tags: opts?.tags ?? [],
      });
    }
  }

  // --- Structure ---

  it('returns correct structure for daily digest', () => {
    seedApprovedEngrams(3);

    const digest = generateDigest(engramIndex, 'user-1', 'daily');

    expect(digest.period).toBe('daily');
    expect(digest.from).toBeDefined();
    expect(digest.to).toBeDefined();
    expect(digest.newEngrams).toBe(3);
    expect(digest).toHaveProperty('topTags');
    expect(digest).toHaveProperty('highlights');
    expect(digest).toHaveProperty('sourcesBreakdown');
  });

  it('returns correct structure for weekly digest', () => {
    seedApprovedEngrams(2, { hoursAgo: 48 }); // 2 days ago, within weekly range

    const digest = generateDigest(engramIndex, 'user-1', 'weekly');

    expect(digest.period).toBe('weekly');
    expect(digest.newEngrams).toBe(2);
  });

  // --- Counts and date ranges ---

  it('returns correct counts within the period', () => {
    // Recent engrams (within daily range)
    seedApprovedEngrams(5, { hoursAgo: 2 });
    // Old engrams (outside daily range)
    for (let i = 0; i < 3; i++) {
      engramIndex.upsert({
        id: `old-eng-${i}`,
        userId: 'user-1',
        concept: `Old concept ${i}`,
        approvalStatus: 'approved',
        capturedAt: new Date(Date.now() - 3 * 86_400_000).toISOString(), // 3 days ago
        sourceType: 'graph_email',
        confidence: 0.7,
      });
    }

    const daily = generateDigest(engramIndex, 'user-1', 'daily');
    expect(daily.newEngrams).toBe(5);

    const weekly = generateDigest(engramIndex, 'user-1', 'weekly');
    expect(weekly.newEngrams).toBe(8); // all 8 within 7 days
  });

  it('date range: from is before to', () => {
    seedApprovedEngrams(1);
    const digest = generateDigest(engramIndex, 'user-1', 'daily');
    expect(new Date(digest.from).getTime()).toBeLessThan(new Date(digest.to).getTime());
  });

  // --- Top tags sorted by frequency ---

  it('top tags are sorted by frequency descending', () => {
    // Create engrams with varying tag frequencies
    seedApprovedEngrams(3, { tags: ['azure', 'cloud'] });
    seedApprovedEngrams(1, { tags: ['azure', 'networking'] });
    seedApprovedEngrams(2, { tags: ['cloud'] });

    const digest = generateDigest(engramIndex, 'user-1', 'daily');

    expect(digest.topTags.length).toBeGreaterThan(0);
    // azure: 4 (3+1), cloud: 5 (3+2), networking: 1
    expect(digest.topTags[0].tag).toBe('cloud');
    expect(digest.topTags[0].count).toBe(5);
    expect(digest.topTags[1].tag).toBe('azure');
    expect(digest.topTags[1].count).toBe(4);

    // Verify sort order
    for (let i = 1; i < digest.topTags.length; i++) {
      expect(digest.topTags[i].count).toBeLessThanOrEqual(digest.topTags[i - 1].count);
    }
  });

  // --- Highlights sorted by confidence ---

  it('highlights are sorted by confidence descending', () => {
    seedApprovedEngrams(1, { confidence: 0.5 });
    seedApprovedEngrams(1, { confidence: 0.95 });
    seedApprovedEngrams(1, { confidence: 0.7 });

    const digest = generateDigest(engramIndex, 'user-1', 'daily');

    expect(digest.highlights.length).toBeGreaterThan(0);
    expect(digest.highlights[0].confidence).toBe(0.95);

    for (let i = 1; i < digest.highlights.length; i++) {
      expect(digest.highlights[i].confidence).toBeLessThanOrEqual(digest.highlights[i - 1].confidence);
    }
  });

  it('highlights are limited to 5 entries', () => {
    seedApprovedEngrams(10);

    const digest = generateDigest(engramIndex, 'user-1', 'daily');
    expect(digest.highlights.length).toBeLessThanOrEqual(5);
  });

  // --- Sources breakdown ---

  it('sources breakdown counts by source type', () => {
    seedApprovedEngrams(3, { sourceType: 'graph_email' });
    seedApprovedEngrams(2, { sourceType: 'graph_teams' });
    seedApprovedEngrams(1, { sourceType: 'screenshot' });

    const digest = generateDigest(engramIndex, 'user-1', 'daily');

    expect(digest.sourcesBreakdown.length).toBe(3);
    // Sorted by count DESC
    expect(digest.sourcesBreakdown[0].source).toBe('graph_email');
    expect(digest.sourcesBreakdown[0].count).toBe(3);
  });

  // --- Empty result ---

  it('returns empty result when no engrams in period', () => {
    const digest = generateDigest(engramIndex, 'user-1', 'daily');

    expect(digest.newEngrams).toBe(0);
    expect(digest.topTags).toHaveLength(0);
    expect(digest.highlights).toHaveLength(0);
    expect(digest.sourcesBreakdown).toHaveLength(0);
  });

  it('does not count pending engrams', () => {
    // Insert pending engrams (not approved)
    for (let i = 0; i < 3; i++) {
      engramIndex.upsert({
        id: `pending-${i}`,
        userId: 'user-1',
        concept: `Pending ${i}`,
        approvalStatus: 'pending',
        capturedAt: recentTimestamp(2),
        sourceType: 'graph_email',
        confidence: 0.9,
      });
    }

    const digest = generateDigest(engramIndex, 'user-1', 'daily');
    expect(digest.newEngrams).toBe(0);
  });

  it('only includes engrams for the specified user', () => {
    seedApprovedEngrams(3); // user-1
    // user-2 engrams
    for (let i = 0; i < 2; i++) {
      engramIndex.upsert({
        id: `other-${i}`,
        userId: 'user-2',
        concept: `Other ${i}`,
        approvalStatus: 'approved',
        capturedAt: recentTimestamp(2),
        sourceType: 'graph_email',
        confidence: 0.8,
      });
    }

    const digest = generateDigest(engramIndex, 'user-1', 'daily');
    expect(digest.newEngrams).toBe(3);
  });
});
