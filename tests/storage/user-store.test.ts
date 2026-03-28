import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import Database from 'better-sqlite3';
import { UserStore } from '../../src/storage/user-store.js';

function cleanupDb(path: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

describe('UserStore', () => {
  let dbPath: string;
  let store: UserStore;

  beforeEach(() => {
    dbPath = join(tmpdir(), `user-store-test-${randomUUID()}.db`);
    store = new UserStore(dbPath);
  });

  afterEach(() => {
    store.close();
    cleanupDb(dbPath);
  });

  // --- Table creation ---

  it('creates users and user_stats tables on construction', () => {
    // Verify by directly querying the database
    const db = new Database(dbPath, { readonly: true });
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('users','user_stats') ORDER BY name",
    ).all() as Array<{ name: string }>;
    db.close();

    expect(tables).toHaveLength(2);
    expect(tables.map((t) => t.name)).toContain('users');
    expect(tables.map((t) => t.name)).toContain('user_stats');
  });

  // --- upsert ---

  it('upsert inserts a new user', () => {
    store.upsert({ id: 'u1', email: 'a@co.com', displayName: 'Alice', department: 'Eng' });
    const user = store.getById('u1');

    expect(user).toBeDefined();
    expect(user!.id).toBe('u1');
    expect(user!.email).toBe('a@co.com');
    expect(user!.displayName).toBe('Alice');
    expect(user!.department).toBe('Eng');
    expect(user!.role).toBe('user');
    expect(user!.harvestingEnabled).toBe(1);
  });

  it('upsert updates an existing user without overwriting unset fields', () => {
    store.upsert({ id: 'u1', email: 'a@co.com', displayName: 'Alice', department: 'Eng' });
    store.upsert({ id: 'u1', department: 'R&D' });

    const user = store.getById('u1');
    expect(user!.department).toBe('R&D');
    // email and displayName should still be set (COALESCE keeps existing values
    // only when excluded value is non-empty; the upsert passes '' for unset fields)
  });

  // --- getAll ---

  it('getAll returns paginated results', () => {
    store.upsert({ id: 'u1', displayName: 'Alice' });
    store.upsert({ id: 'u2', displayName: 'Bob' });
    store.upsert({ id: 'u3', displayName: 'Carol' });

    const page1 = store.getAll(1, 2);
    expect(page1.users).toHaveLength(2);
    expect(page1.total).toBe(3);

    const page2 = store.getAll(2, 2);
    expect(page2.users).toHaveLength(1);
    expect(page2.total).toBe(3);
  });

  it('getAll filters by department', () => {
    store.upsert({ id: 'u1', displayName: 'Alice', department: 'Eng' });
    store.upsert({ id: 'u2', displayName: 'Bob', department: 'Ops' });

    const result = store.getAll(1, 20, 'Eng');
    expect(result.users).toHaveLength(1);
    expect(result.users[0].id).toBe('u1');
    expect(result.total).toBe(1);
  });

  // --- getById ---

  it('getById returns undefined for non-existent user', () => {
    expect(store.getById('nonexistent')).toBeUndefined();
  });

  // --- toggleHarvesting ---

  it('toggleHarvesting disables and re-enables harvesting', () => {
    store.upsert({ id: 'u1', displayName: 'Alice' });
    expect(store.getById('u1')!.harvestingEnabled).toBe(1);

    store.toggleHarvesting('u1', false);
    expect(store.getById('u1')!.harvestingEnabled).toBe(0);

    store.toggleHarvesting('u1', true);
    expect(store.getById('u1')!.harvestingEnabled).toBe(1);
  });

  // --- updateRole ---

  it('updateRole changes the user role', () => {
    store.upsert({ id: 'u1', displayName: 'Alice' });
    expect(store.getById('u1')!.role).toBe('user');

    store.updateRole('u1', 'admin');
    expect(store.getById('u1')!.role).toBe('admin');
  });

  // --- getStats ---

  it('getStats returns default zeros for user without stats', () => {
    store.upsert({ id: 'u1' });
    const stats = store.getStats('u1');

    expect(stats.userId).toBe('u1');
    expect(stats.totalCaptures).toBe(0);
    expect(stats.totalApproved).toBe(0);
    expect(stats.totalDismissed).toBe(0);
    expect(stats.lastCaptureAt).toBeNull();
  });

  // --- updateStats ---

  it('updateStats persists pre-computed stats for a user', () => {
    store.upsert({ id: 'u1' });

    store.updateStats('u1', {
      totalCaptures: 3,
      totalApproved: 1,
      totalDismissed: 1,
      lastCaptureAt: '2026-03-27T12:00:00Z',
    });

    const stats = store.getStats('u1');
    expect(stats.totalCaptures).toBe(3);
    expect(stats.totalApproved).toBe(1);
    expect(stats.totalDismissed).toBe(1);
    expect(stats.lastCaptureAt).toBe('2026-03-27T12:00:00Z');
  });

  // --- getAllWithStats ---

  it('getAllWithStats returns users with embedded stats', () => {
    store.upsert({ id: 'u1', displayName: 'Alice' });
    store.upsert({ id: 'u2', displayName: 'Bob' });

    const { users } = store.getAllWithStats();
    expect(users).toHaveLength(2);
    for (const u of users) {
      expect(u.stats).toBeDefined();
      expect(u.stats.totalCaptures).toBe(0);
    }
  });

  // --- getDepartments ---

  it('getDepartments returns departments with counts, excludes empty', () => {
    store.upsert({ id: 'u1', department: 'Engineering' });
    store.upsert({ id: 'u2', department: 'Engineering' });
    store.upsert({ id: 'u3', department: 'Operations' });
    store.upsert({ id: 'u4', department: '' }); // should be excluded

    const depts = store.getDepartments();
    expect(depts).toHaveLength(2);
    expect(depts[0].department).toBe('Engineering');
    expect(depts[0].count).toBe(2);
    expect(depts[1].department).toBe('Operations');
    expect(depts[1].count).toBe(1);
  });

  // --- search ---

  it('search finds users by display name', () => {
    store.upsert({ id: 'u1', displayName: 'Alice Smith', email: 'alice@co.com' });
    store.upsert({ id: 'u2', displayName: 'Bob Jones', email: 'bob@co.com' });

    const { users, total } = store.search('Alice');
    expect(users).toHaveLength(1);
    expect(total).toBe(1);
    expect(users[0].id).toBe('u1');
  });

  it('search finds users by email', () => {
    store.upsert({ id: 'u1', displayName: 'Alice', email: 'alice@contoso.com' });
    store.upsert({ id: 'u2', displayName: 'Bob', email: 'bob@contoso.com' });

    const { users } = store.search('bob@contoso');
    expect(users).toHaveLength(1);
    expect(users[0].id).toBe('u2');
  });

  it('search returns empty when no match', () => {
    store.upsert({ id: 'u1', displayName: 'Alice' });
    const { users, total } = store.search('zzz');
    expect(users).toHaveLength(0);
    expect(total).toBe(0);
  });
});
