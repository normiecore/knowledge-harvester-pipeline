import { describe, it, expect, vi } from 'vitest';
import {
  retryWithBackoff,
  RetryableError,
} from '../../src/ingestion/graph-retry.js';

describe('retryWithBackoff', () => {
  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const result = await retryWithBackoff(fn, {
      maxRetries: 3,
      baseDelayMs: 10,
    });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on RetryableError and succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RetryableError(429, 'Too Many Requests'))
      .mockRejectedValueOnce(new RetryableError(503, 'Service Unavailable'))
      .mockResolvedValue('recovered');

    const result = await retryWithBackoff(fn, {
      maxRetries: 3,
      baseDelayMs: 10,
    });
    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('throws after max retries exhausted', async () => {
    const fn = vi
      .fn()
      .mockRejectedValue(new RetryableError(429, 'Too Many Requests'));

    await expect(
      retryWithBackoff(fn, { maxRetries: 2, baseDelayMs: 10 }),
    ).rejects.toThrow('Too Many Requests');
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('Fatal'));

    await expect(
      retryWithBackoff(fn, { maxRetries: 3, baseDelayMs: 10 }),
    ).rejects.toThrow('Fatal');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respects retryAfter delay', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RetryableError(429, 'Rate limited', 0.1))
      .mockResolvedValue('ok');

    const start = Date.now();
    const result = await retryWithBackoff(fn, {
      maxRetries: 1,
      baseDelayMs: 10,
    });
    const elapsed = Date.now() - start;

    expect(result).toBe('ok');
    expect(elapsed).toBeGreaterThanOrEqual(80); // retryAfterSeconds=0.1 → 100ms
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
