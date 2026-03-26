import { describe, it, expect } from 'vitest';
import { ConcurrencyLimiter } from '../../src/pipeline/concurrency-limiter.js';

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
