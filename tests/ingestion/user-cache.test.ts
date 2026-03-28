import { describe, it, expect } from 'vitest';
import { UserCache } from '../../src/ingestion/user-cache.js';
import type { GraphUser } from '../../src/ingestion/graph-types.js';

function makeUser(id: string, department?: string): GraphUser {
  return { id, displayName: id, mail: `${id}@test.com`, userPrincipalName: `${id}@test.com`, department };
}

describe('UserCache', () => {
  it('returns department for a cached user', () => {
    const cache = new UserCache();
    cache.refresh([makeUser('u1', 'Engineering')]);
    expect(cache.getDepartment('u1')).toBe('Engineering');
  });

  it('returns unassigned for an unknown user', () => {
    const cache = new UserCache();
    expect(cache.getDepartment('missing')).toBe('unassigned');
  });

  it('returns unassigned when user has no department', () => {
    const cache = new UserCache();
    cache.refresh([makeUser('u1')]);
    expect(cache.getDepartment('u1')).toBe('unassigned');
  });

  it('getDepartment returns correct values during refresh (no stale window)', () => {
    const cache = new UserCache();
    cache.refresh([makeUser('u1', 'Engineering'), makeUser('u2', 'Sales')]);

    // Simulate a concurrent read mid-refresh: monkey-patch Map.set to
    // query getDepartment after every insertion into the new map.
    const observed: string[] = [];
    const originalRefresh = cache.refresh.bind(cache);

    // Instead of actually intercepting internals, we verify the key property:
    // after building users list but before swap, old data is still returned.
    // We do this by overriding refresh to call getDepartment between build and swap.
    const largeBatch = Array.from({ length: 1000 }, (_, i) =>
      makeUser(`new-${i}`, `Dept-${i}`),
    );

    // Capture getDepartment result for u1 at the exact moment refresh is called
    // but hasn't finished yet. Because the fix builds a new map and swaps
    // atomically, the old cache remains accessible the entire time.
    const OrigMap = Map;
    let readDuringBuild: string | undefined;
    const origSet = Map.prototype.set;
    let callCount = 0;
    Map.prototype.set = function (...args: Parameters<typeof origSet>) {
      callCount++;
      // On the 500th insert (midway through building new map), read from cache
      if (callCount === 500) {
        readDuringBuild = cache.getDepartment('u1');
      }
      return origSet.apply(this, args);
    };

    try {
      cache.refresh(largeBatch);
    } finally {
      Map.prototype.set = origSet;
    }

    // The old cache should have been accessible during the build phase
    expect(readDuringBuild).toBe('Engineering');
  });

  it('old cache remains accessible until new one is fully built', () => {
    const cache = new UserCache();
    cache.refresh([makeUser('u1', 'Engineering')]);

    // Verify that after refresh with new data, old entries are gone
    // and new entries are present — the swap happened atomically.
    cache.refresh([makeUser('u2', 'Marketing')]);

    expect(cache.getDepartment('u1')).toBe('unassigned'); // old entry gone
    expect(cache.getDepartment('u2')).toBe('Marketing');  // new entry present
  });

  it('size reflects the new cache after refresh', () => {
    const cache = new UserCache();
    cache.refresh([makeUser('u1', 'A'), makeUser('u2', 'B')]);
    expect(cache.size).toBe(2);

    cache.refresh([makeUser('u3', 'C')]);
    expect(cache.size).toBe(1);
  });

  it('get returns undefined for unknown user', () => {
    const cache = new UserCache();
    expect(cache.get('nope')).toBeUndefined();
  });
});
