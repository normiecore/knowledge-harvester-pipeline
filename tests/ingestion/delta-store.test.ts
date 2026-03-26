import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DeltaStore } from '../../src/ingestion/delta-store.js';
import { unlinkSync } from 'fs';

const TEST_DB = 'test-delta.db';

describe('DeltaStore', () => {
  let store: DeltaStore;

  beforeEach(() => {
    store = new DeltaStore(TEST_DB);
  });

  afterEach(() => {
    store.close();
    try { unlinkSync(TEST_DB); } catch {}
    try { unlinkSync(TEST_DB + '-wal'); } catch {}
    try { unlinkSync(TEST_DB + '-shm'); } catch {}
  });

  it('returns null for unknown delta link', () => {
    expect(store.getDeltaLink('user-1', 'mail')).toBeNull();
  });

  it('stores and retrieves a delta link', () => {
    store.setDeltaLink('user-1', 'mail', 'https://graph.microsoft.com/delta?token=abc');
    expect(store.getDeltaLink('user-1', 'mail')).toBe('https://graph.microsoft.com/delta?token=abc');
  });

  it('overwrites existing delta link', () => {
    store.setDeltaLink('user-1', 'mail', 'token-1');
    store.setDeltaLink('user-1', 'mail', 'token-2');
    expect(store.getDeltaLink('user-1', 'mail')).toBe('token-2');
  });

  it('isolates delta links per user and source', () => {
    store.setDeltaLink('user-1', 'mail', 'link-a');
    store.setDeltaLink('user-1', 'teams', 'link-b');
    store.setDeltaLink('user-2', 'mail', 'link-c');
    expect(store.getDeltaLink('user-1', 'mail')).toBe('link-a');
    expect(store.getDeltaLink('user-1', 'teams')).toBe('link-b');
    expect(store.getDeltaLink('user-2', 'mail')).toBe('link-c');
  });
});
