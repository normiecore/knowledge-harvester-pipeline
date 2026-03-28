import { describe, it, expect, vi, beforeEach } from 'vitest';
import { rebuildIndex } from '../../src/storage/rebuild-index.js';
import type { MuninnDBClient } from '../../src/storage/muninndb-client.js';
import type { EngramIndex } from '../../src/storage/engram-index.js';

function makeEngram(id: string, userId: string) {
  return {
    id,
    concept: `Concept ${id}`,
    content: JSON.stringify({
      concept: `Concept ${id}`,
      content: 'Some content',
      source_type: 'desktop_window',
      source_app: 'test',
      user_id: userId,
      user_email: `${userId}@test.com`,
      captured_at: '2026-01-01T00:00:00Z',
      approved_at: null,
      approved_by: null,
      approval_status: 'pending',
      confidence: 0.9,
      sensitivity_classification: 'safe',
      tags: ['test'],
      raw_text: 'raw',
    }),
  };
}

describe('rebuildIndex concurrency', () => {
  let mockClient: { listAll: ReturnType<typeof vi.fn> };
  let mockIndex: { upsert: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockClient = { listAll: vi.fn() };
    mockIndex = { upsert: vi.fn() };
  });

  it('syncs multiple user vaults concurrently', async () => {
    const userIds = ['user-a', 'user-b', 'user-c'];

    // Track concurrent execution
    let maxConcurrent = 0;
    let currentConcurrent = 0;

    mockClient.listAll.mockImplementation(async (vault: string) => {
      currentConcurrent++;
      maxConcurrent = Math.max(maxConcurrent, currentConcurrent);
      await new Promise((r) => setTimeout(r, 10));
      currentConcurrent--;

      const userId = vault.replace('knowledge-harvester-', '');
      return [makeEngram(`eng-${userId}`, userId)];
    });

    const result = await rebuildIndex(
      mockClient as unknown as MuninnDBClient,
      mockIndex as unknown as EngramIndex,
      userIds,
    );

    expect(result.synced).toBe(3);
    expect(result.errors).toBe(0);
    expect(mockIndex.upsert).toHaveBeenCalledTimes(3);
    // All 3 should run concurrently (concurrency limit is 5)
    expect(maxConcurrent).toBe(3);
  });

  it('handles vault failures without aborting other vaults', async () => {
    const userIds = ['user-ok', 'user-fail', 'user-ok2'];

    mockClient.listAll.mockImplementation(async (vault: string) => {
      if (vault.includes('user-fail')) {
        throw new Error('Vault unreachable');
      }
      const userId = vault.replace('knowledge-harvester-', '');
      return [makeEngram(`eng-${userId}`, userId)];
    });

    const result = await rebuildIndex(
      mockClient as unknown as MuninnDBClient,
      mockIndex as unknown as EngramIndex,
      userIds,
    );

    expect(result.synced).toBe(2);
    expect(result.errors).toBe(1);
    expect(mockIndex.upsert).toHaveBeenCalledTimes(2);
  });

  it('returns zero counts for empty user list', async () => {
    const result = await rebuildIndex(
      mockClient as unknown as MuninnDBClient,
      mockIndex as unknown as EngramIndex,
      [],
    );

    expect(result.synced).toBe(0);
    expect(result.errors).toBe(0);
    expect(mockClient.listAll).not.toHaveBeenCalled();
  });
});
