import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { PipelineProcessor } from '../../src/pipeline/processor.js';
import { Deduplicator } from '../../src/pipeline/deduplicator.js';
import { EngramIndex } from '../../src/storage/engram-index.js';
import { PipelineMetrics } from '../../src/pipeline/metrics.js';
import { ConcurrencyLimiter } from '../../src/pipeline/concurrency-limiter.js';
import type { RawCapture } from '../../src/types.js';
import { unlinkSync, existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';

function makeDbNames() {
  const suffix = randomBytes(4).toString('hex');
  return {
    dedup: `test-dedup-${suffix}.db`,
    index: `test-index-${suffix}.db`,
    metrics: `test-metrics-${suffix}.db`,
  };
}

function cleanup(dbFiles: string[]) {
  for (const f of dbFiles) {
    for (const ext of ['', '-wal', '-shm']) {
      const path = f + ext;
      try {
        if (existsSync(path)) unlinkSync(path);
      } catch {
        // Ignore EBUSY / EPERM — file still locked by prior SQLite handle
      }
    }
  }
}

describe('Pipeline Integration', () => {
  let deduplicator: Deduplicator | undefined;
  let engramIndex: EngramIndex | undefined;
  let metrics: PipelineMetrics | undefined;
  let published: Array<{ topic: string; data: unknown }>;
  let dbFiles: string[];

  beforeEach(() => {
    const dbs = makeDbNames();
    dbFiles = [dbs.dedup, dbs.index, dbs.metrics];
    cleanup(dbFiles);
    deduplicator = new Deduplicator(dbs.dedup);
    engramIndex = new EngramIndex(dbs.index);
    metrics = new PipelineMetrics(dbs.metrics);
    published = [];
  });

  afterEach(() => {
    deduplicator?.close();
    engramIndex?.close();
    metrics?.close();
    cleanup(dbFiles ?? []);
  });

  function makeCapture(overrides: Partial<RawCapture> = {}): RawCapture {
    return {
      id: `cap-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      userId: 'user-1',
      userEmail: 'user@subsea.com',
      sourceType: 'graph_email',
      sourceApp: 'outlook',
      capturedAt: new Date().toISOString(),
      rawContent: JSON.stringify({
        subject: 'Subsea connector pressure test results',
        bodyPreview: 'The 3-inch connector passed 500 bar testing.',
      }),
      metadata: {},
      ...overrides,
    };
  }

  it('processes a capture through all 6 stages end-to-end', async () => {
    const mockExtractor = {
      extract: vi.fn().mockResolvedValue({
        summary: '3-inch subsea connector passed pressure testing at 500 bar.',
        tags: ['subsea', 'connector', 'pressure-testing'],
        confidence: 0.92,
        sensitivity: { classification: 'safe', reasoning: 'Technical test result' },
      }),
    };

    const mockVaultManager = {
      storePending: vi.fn().mockResolvedValue('engram-001'),
    };

    const processor = new PipelineProcessor(
      mockExtractor as any,
      deduplicator,
      mockVaultManager as any,
      (topic, data) => published.push({ topic, data }),
      engramIndex,
      new ConcurrencyLimiter(4),
      metrics,
    );

    const capture = makeCapture();
    const result = await processor.process(capture);

    // Stage 1: Not blocked by sensitivity pre-filter (technical content)
    expect(result.action).toBe('stored');

    // Stage 2: Not deduplicated (first time seeing this)
    expect(result.action).not.toBe('deduplicated');

    // Stage 3: Extractor called
    expect(mockExtractor.extract).toHaveBeenCalledOnce();

    // Stage 4: LLM sensitivity gate passed (classification = safe)

    // Stage 5: Stored in vault + indexed locally
    expect(mockVaultManager.storePending).toHaveBeenCalledOnce();
    const indexed = engramIndex.listByStatus('user-1', 'pending');
    expect(indexed).toHaveLength(1);
    expect(indexed[0].concept).toContain('connector');

    // Stage 6: NATS notification published
    expect(published).toHaveLength(1);
    expect(published[0].topic).toContain('user-1');

    // Metrics updated
    const snap = metrics.snapshot();
    expect(snap.processed_total).toBe(1);
    expect(snap.blocked_total).toBe(0);
  });

  it('blocks sensitive content at pre-filter stage', async () => {
    const mockExtractor = { extract: vi.fn() };
    const mockVaultManager = { storePending: vi.fn() };

    const processor = new PipelineProcessor(
      mockExtractor as any,
      deduplicator,
      mockVaultManager as any,
      (topic, data) => published.push({ topic, data }),
      engramIndex,
      new ConcurrencyLimiter(4),
      metrics,
    );

    // HR content should be blocked by sensitivity pre-filter
    const capture = makeCapture({
      rawContent: JSON.stringify({
        subject: 'Performance Review - John Smith',
        bodyPreview: 'Annual performance evaluation scores.',
      }),
      sourceApp: 'outlook',
    });

    const result = await processor.process(capture);

    expect(result.action).toBe('blocked');
    expect(result.reason).toContain('pre-filter');
    expect(mockExtractor.extract).not.toHaveBeenCalled(); // skipped LLM
    expect(mockVaultManager.storePending).not.toHaveBeenCalled();
    expect(metrics.snapshot().blocked_total).toBe(1);
  });

  it('deduplicates identical content', async () => {
    const mockExtractor = {
      extract: vi.fn().mockResolvedValue({
        summary: 'Test',
        tags: ['test'],
        confidence: 0.5,
        sensitivity: { classification: 'safe', reasoning: 'test' },
      }),
    };
    const mockVaultManager = { storePending: vi.fn().mockResolvedValue('id') };

    const processor = new PipelineProcessor(
      mockExtractor as any,
      deduplicator,
      mockVaultManager as any,
      (topic, data) => published.push({ topic, data }),
      engramIndex,
      new ConcurrencyLimiter(4),
      metrics,
    );

    const content = JSON.stringify({ subject: 'Unique content', bodyPreview: 'Details here' });
    const cap1 = makeCapture({ id: 'cap-1', rawContent: content });
    const cap2 = makeCapture({ id: 'cap-2', rawContent: content }); // same content

    const r1 = await processor.process(cap1);
    const r2 = await processor.process(cap2);

    expect(r1.action).toBe('stored');
    expect(r2.action).toBe('deduplicated');
    expect(mockExtractor.extract).toHaveBeenCalledOnce(); // only called for first
    expect(metrics.snapshot().deduplicated_total).toBe(1);
  });
});
