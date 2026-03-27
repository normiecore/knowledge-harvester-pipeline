import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import Database from 'better-sqlite3';
import { SettingsStore } from '../../src/storage/settings-store.js';

function cleanupDb(path: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

describe('SettingsStore', () => {
  let dbPath: string;
  let store: SettingsStore;

  beforeEach(() => {
    dbPath = join(tmpdir(), `settings-store-test-${randomUUID()}.db`);
    store = new SettingsStore(dbPath);
  });

  afterEach(() => {
    store.close();
    cleanupDb(dbPath);
  });

  // --- Table creation ---

  it('creates user_settings table on construction', () => {
    const db = new Database(dbPath, { readonly: true });
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = 'user_settings'",
    ).all() as Array<{ name: string }>;
    db.close();

    expect(tables).toHaveLength(1);
    expect(tables[0].name).toBe('user_settings');
  });

  // --- get() returns defaults ---

  it('get() returns defaults for a new user', () => {
    const settings = store.get('new-user');

    expect(settings.userId).toBe('new-user');
    expect(settings.notificationNewEngram).toBe(1);
    expect(settings.notificationSound).toBe(0);
    expect(settings.autoApproveConfidence).toBe(0);
    expect(settings.theme).toBe('dark');
    expect(settings.itemsPerPage).toBe(20);
    expect(settings.updatedAt).toBeDefined();
  });

  // --- update() partial update preserves other fields ---

  it('update() partial update preserves other fields', () => {
    // First set a full state
    store.update('user-1', { theme: 'light', itemsPerPage: 50 });

    // Now partial update only theme
    const updated = store.update('user-1', { theme: 'system' });

    expect(updated.theme).toBe('system');
    expect(updated.itemsPerPage).toBe(50);
    expect(updated.notificationNewEngram).toBe(1);
    expect(updated.notificationSound).toBe(0);
    expect(updated.autoApproveConfidence).toBe(0);
  });

  it('update() creates a row for a new user then returns persisted settings', () => {
    const result = store.update('user-2', { notificationSound: 1 });

    expect(result.userId).toBe('user-2');
    expect(result.notificationSound).toBe(1);
    // Other fields should be defaults
    expect(result.theme).toBe('dark');
    expect(result.itemsPerPage).toBe(20);

    // Verify persistence
    const fetched = store.get('user-2');
    expect(fetched.notificationSound).toBe(1);
  });

  // --- getAutoApproveThreshold() ---

  it('getAutoApproveThreshold() returns 0 for a user with no settings row', () => {
    const threshold = store.getAutoApproveThreshold('nonexistent');
    expect(threshold).toBe(0);
  });

  it('getAutoApproveThreshold() returns stored threshold after update', () => {
    store.update('user-1', { autoApproveConfidence: 0.85 });
    const threshold = store.getAutoApproveThreshold('user-1');
    expect(threshold).toBe(0.85);
  });

  // --- Multiple users have independent settings ---

  it('multiple users have independent settings', () => {
    store.update('user-a', { theme: 'light', itemsPerPage: 10 });
    store.update('user-b', { theme: 'system', itemsPerPage: 50 });

    const a = store.get('user-a');
    const b = store.get('user-b');

    expect(a.theme).toBe('light');
    expect(a.itemsPerPage).toBe(10);

    expect(b.theme).toBe('system');
    expect(b.itemsPerPage).toBe(50);

    // Updating one does not affect the other
    store.update('user-a', { notificationSound: 1 });
    const bAfter = store.get('user-b');
    expect(bAfter.notificationSound).toBe(0);
  });
});
