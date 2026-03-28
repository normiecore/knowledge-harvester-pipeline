import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MuninnDBClient } from '../../src/storage/muninndb-client.js';

describe('MuninnDBClient retry and timeout', () => {
  let client: MuninnDBClient;
  let mockFetch: ReturnType<typeof vi.fn>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    // Short timeout for fast tests
    client = new MuninnDBClient('http://localhost:3030', 'mk_test', 500);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('retries on 500 errors and succeeds on subsequent attempt', async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'eng-001', concept: 'Test', content: 'ok' }),
      });

    const result = await client.remember('vault', 'concept', 'content');
    expect(result.id).toBe('eng-001');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('does NOT retry on 400 client errors', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      text: () => Promise.resolve('Bad Request'),
    });

    await expect(client.remember('vault', 'concept', 'content')).rejects.toThrow(
      'MuninnDB error: 400',
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 rate limit and eventually throws after max retries', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 429,
      text: () => Promise.resolve('Too Many Requests'),
    });

    await expect(client.remember('vault', 'concept', 'content')).rejects.toThrow(
      'MuninnDB error: 429',
    );
    // 1 initial + 2 retries = 3 total
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('retries on network errors (fetch failed)', async () => {
    mockFetch
      .mockRejectedValueOnce(new Error('fetch failed'))
      .mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ id: 'eng-002', concept: 'Test', content: 'ok' }),
      });

    const result = await client.remember('vault', 'concept', 'content');
    expect(result.id).toBe('eng-002');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('passes AbortSignal.timeout to fetch', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'e', concept: 'c', content: 'x' }),
    });

    await client.remember('vault', 'concept', 'content');
    const callOpts = mockFetch.mock.calls[0][1];
    expect(callOpts.signal).toBeDefined();
  });
});
