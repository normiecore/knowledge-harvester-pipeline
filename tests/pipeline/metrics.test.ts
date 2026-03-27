import { describe, it, expect, afterEach } from 'vitest';
import { PipelineMetrics } from '../../src/pipeline/metrics.js';
import { existsSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DB = join(tmpdir(), `metrics-test-${process.pid}.db`);

function cleanup(): void {
  for (const suffix of ['', '-wal', '-shm']) {
    const p = TEST_DB + suffix;
    if (existsSync(p)) unlinkSync(p);
  }
}

describe('PipelineMetrics', () => {
  afterEach(cleanup);

  it('starts at zero', () => {
    const metrics = new PipelineMetrics();
    const snap = metrics.snapshot();
    expect(snap.processed_total).toBe(0);
    expect(snap.blocked_total).toBe(0);
    expect(snap.deduplicated_total).toBe(0);
    expect(snap.errors_total).toBe(0);
    expect(snap.last_poll_at).toBeNull();
  });

  it('increments counters', () => {
    const metrics = new PipelineMetrics();
    metrics.recordProcessed();
    metrics.recordProcessed();
    metrics.recordBlocked();
    metrics.recordDeduplicated();
    metrics.recordError();
    metrics.recordError();
    metrics.recordError();

    const snap = metrics.snapshot();
    expect(snap.processed_total).toBe(2);
    expect(snap.blocked_total).toBe(1);
    expect(snap.deduplicated_total).toBe(1);
    expect(snap.errors_total).toBe(3);
  });

  it('records poll time', () => {
    const metrics = new PipelineMetrics();
    const before = new Date().toISOString();
    metrics.recordPoll();
    const snap = metrics.snapshot();

    expect(snap.last_poll_at).not.toBeNull();
    expect(snap.last_poll_at! >= before).toBe(true);
  });

  it('persists counters to SQLite and restores on reload', () => {
    cleanup();

    // Write some metrics
    const m1 = new PipelineMetrics(TEST_DB);
    m1.recordProcessed();
    m1.recordProcessed();
    m1.recordBlocked();
    m1.recordError();
    m1.recordPoll();
    const snap1 = m1.snapshot();
    m1.close();

    // Create a new instance from the same DB — should restore
    const m2 = new PipelineMetrics(TEST_DB);
    const snap2 = m2.snapshot();
    m2.close();

    expect(snap2.processed_total).toBe(snap1.processed_total);
    expect(snap2.blocked_total).toBe(snap1.blocked_total);
    expect(snap2.errors_total).toBe(snap1.errors_total);
    expect(snap2.deduplicated_total).toBe(snap1.deduplicated_total);
    expect(snap2.last_poll_at).toBe(snap1.last_poll_at);
  });

  it('continues incrementing after reload', () => {
    cleanup();

    const m1 = new PipelineMetrics(TEST_DB);
    m1.recordProcessed();
    m1.recordProcessed();
    m1.close();

    const m2 = new PipelineMetrics(TEST_DB);
    m2.recordProcessed();
    const snap = m2.snapshot();
    m2.close();

    expect(snap.processed_total).toBe(3);
  });
});
