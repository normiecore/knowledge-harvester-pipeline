import { describe, it, expect } from 'vitest';
import { ConcurrencyLimiter, QueueFullError } from '../../src/pipeline/concurrency-limiter.js';

describe('ConcurrencyLimiter', () => {
  it('executes immediately when under limit', async () => {
    const limiter = new ConcurrencyLimiter(2);
    const result = await limiter.run(async () => 'done');
    expect(result).toBe('done');
  });

  it('limits concurrent executions', async () => {
    const limiter = new ConcurrencyLimiter(2);
    let maxSeen = 0;

    const task = () =>
      limiter.run(async () => {
        if (limiter.active > maxSeen) maxSeen = limiter.active;
        await new Promise((r) => setTimeout(r, 50));
      });

    await Promise.all([task(), task(), task(), task()]);
    expect(maxSeen).toBe(2);
  });

  it('propagates errors', async () => {
    const limiter = new ConcurrencyLimiter(2);
    await expect(
      limiter.run(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    // Limiter should still be usable after error
    expect(limiter.active).toBe(0);
  });

  it('accepts tasks up to maxQueueSize', async () => {
    // concurrency=1 so the first task occupies the slot; remaining queue up
    const limiter = new ConcurrencyLimiter(1, 3);
    let resolveBlocker!: () => void;
    // This task holds the single slot open
    const blocker = limiter.run(() => new Promise<void>((r) => (resolveBlocker = r)));

    // Queue 3 tasks (the max)
    const queued = [
      limiter.run(async () => 'a'),
      limiter.run(async () => 'b'),
      limiter.run(async () => 'c'),
    ];
    expect(limiter.queueSize).toBe(3);

    resolveBlocker();
    await blocker;
    const results = await Promise.all(queued);
    expect(results).toEqual(['a', 'b', 'c']);
  });

  it('rejects when queue exceeds maxQueueSize', async () => {
    const limiter = new ConcurrencyLimiter(1, 2);
    let resolveBlocker!: () => void;
    const blocker = limiter.run(() => new Promise<void>((r) => (resolveBlocker = r)));

    // Fill the queue to capacity
    const q1 = limiter.run(async () => 'a');
    const q2 = limiter.run(async () => 'b');
    expect(limiter.queueSize).toBe(2);

    // The next call should reject synchronously with QueueFullError
    await expect(limiter.run(async () => 'c')).rejects.toThrow(QueueFullError);
    await expect(limiter.run(async () => 'd')).rejects.toThrow(/queue is full/i);

    // Drain the queue normally
    resolveBlocker();
    await blocker;
    await Promise.all([q1, q2]);
  });

  it('uses custom maxQueueSize', async () => {
    const limiter = new ConcurrencyLimiter(1, 1);
    let resolveBlocker!: () => void;
    const blocker = limiter.run(() => new Promise<void>((r) => (resolveBlocker = r)));

    const q1 = limiter.run(async () => 'a');
    expect(limiter.queueSize).toBe(1);

    // Second queued task exceeds maxQueueSize of 1
    await expect(limiter.run(async () => 'b')).rejects.toThrow(QueueFullError);

    resolveBlocker();
    await blocker;
    await q1;
  });

  it('reports active count', async () => {
    const limiter = new ConcurrencyLimiter(3);
    expect(limiter.active).toBe(0);

    let resolveTask!: () => void;
    const taskPromise = limiter.run(
      () => new Promise<void>((r) => (resolveTask = r)),
    );
    // active should be 1 while task is running
    expect(limiter.active).toBe(1);

    resolveTask();
    await taskPromise;
    expect(limiter.active).toBe(0);
  });
});
