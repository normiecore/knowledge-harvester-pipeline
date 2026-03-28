import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { MuninnDBClient } from '../../src/storage/muninndb-client.js';

describe('MuninnDBClient.listAll batch parallel reads', () => {
  let client: MuninnDBClient;
  let mockFetch: ReturnType<typeof vi.fn>;
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
    client = new MuninnDBClient('http://localhost:3030', 'mk_test', 500);
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  function makeRecallResponse(ids: string[]) {
    return {
      ok: true,
      json: () =>
        Promise.resolve({
          engrams: ids.map((id) => ({ id, concept: `Concept ${id}` })),
        }),
    };
  }

  function makeReadResponse(id: string) {
    return {
      ok: true,
      json: () =>
        Promise.resolve({ id, concept: `Concept ${id}`, content: `Content ${id}` }),
    };
  }

  it('fetches all engrams in parallel batches', async () => {
    // 15 engrams = 2 batches (10 + 5)
    const ids = Array.from({ length: 15 }, (_, i) => `eng-${String(i).padStart(3, '0')}`);

    mockFetch.mockImplementation(async (url: string, opts: { body: string }) => {
      const body = JSON.parse(opts.body);
      if (url.endsWith('/recall')) {
        return makeRecallResponse(ids);
      }
      if (url.endsWith('/read')) {
        return makeReadResponse(body.id);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await client.listAll('test-vault');

    expect(result).toHaveLength(15);
    // recall(1) + read(15) = 16 total fetch calls
    expect(mockFetch).toHaveBeenCalledTimes(16);
    // Verify all IDs are present
    const resultIds = result.map((e) => e.id);
    for (const id of ids) {
      expect(resultIds).toContain(id);
    }
  });

  it('handles partial failures gracefully without crashing', async () => {
    const ids = ['eng-ok-1', 'eng-fail', 'eng-ok-2'];

    mockFetch.mockImplementation(async (url: string, opts: { body: string }) => {
      const body = JSON.parse(opts.body);
      if (url.endsWith('/recall')) {
        return makeRecallResponse(ids);
      }
      if (url.endsWith('/read')) {
        if (body.id === 'eng-fail') {
          return { ok: false, status: 404, text: () => Promise.resolve('Not Found') };
        }
        return makeReadResponse(body.id);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await client.listAll('test-vault');

    // Only the 2 successful reads should be returned
    expect(result).toHaveLength(2);
    expect(result.map((e) => e.id)).toEqual(['eng-ok-1', 'eng-ok-2']);
  });

  it('returns empty array when no engrams exist', async () => {
    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/recall')) {
        return { ok: true, json: () => Promise.resolve({ engrams: [] }) };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await client.listAll('empty-vault');

    expect(result).toHaveLength(0);
    // Only 1 recall call, no reads
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('handles all reads failing in a batch', async () => {
    const ids = ['eng-1', 'eng-2', 'eng-3'];

    mockFetch.mockImplementation(async (url: string) => {
      if (url.endsWith('/recall')) {
        return makeRecallResponse(ids);
      }
      if (url.endsWith('/read')) {
        return { ok: false, status: 500, text: () => Promise.resolve('Server Error') };
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await client.listAll('test-vault');

    // All reads fail, but listAll should not throw
    expect(result).toHaveLength(0);
  });

  it('processes exactly BATCH_SIZE items per batch', async () => {
    const batchSize = MuninnDBClient.LIST_ALL_BATCH_SIZE;
    // Use exactly batchSize + 1 to ensure 2 batches
    const ids = Array.from({ length: batchSize + 1 }, (_, i) => `eng-${i}`);

    // Track concurrent in-flight reads to verify batching
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    mockFetch.mockImplementation(async (url: string, opts: { body: string }) => {
      const body = JSON.parse(opts.body);
      if (url.endsWith('/recall')) {
        return makeRecallResponse(ids);
      }
      if (url.endsWith('/read')) {
        currentConcurrent++;
        maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
        // Simulate async delay so concurrency is measurable
        await new Promise((r) => setTimeout(r, 5));
        currentConcurrent--;
        return makeReadResponse(body.id);
      }
      throw new Error(`Unexpected URL: ${url}`);
    });

    const result = await client.listAll('test-vault');

    expect(result).toHaveLength(batchSize + 1);
    // Max concurrency should not exceed batch size
    expect(maxConcurrent).toBeLessThanOrEqual(batchSize);
    expect(maxConcurrent).toBeGreaterThan(1); // Confirm parallelism happened
  });
});
