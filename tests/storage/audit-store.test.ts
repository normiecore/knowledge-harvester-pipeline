import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import Database from 'better-sqlite3';
import { AuditStore } from '../../src/storage/audit-store.js';

function cleanupDb(path: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

describe('AuditStore', () => {
  let dbPath: string;
  let store: AuditStore;

  beforeEach(() => {
    dbPath = join(tmpdir(), `audit-store-test-${randomUUID()}.db`);
    store = new AuditStore(dbPath);
  });

  afterEach(() => {
    store.close();
    cleanupDb(dbPath);
  });

  // --- Table creation ---

  it('creates audit_log table on construction', () => {
    const db = new Database(dbPath, { readonly: true });
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = 'audit_log'",
    ).all() as Array<{ name: string }>;
    db.close();

    expect(tables).toHaveLength(1);
    expect(tables[0].name).toBe('audit_log');
  });

  // --- log ---

  it('log() writes an entry to the database', () => {
    store.log({
      userId: 'user-1',
      action: 'engram.approve',
      resourceType: 'engram',
      resourceId: 'eng-1',
      details: '{"status":"approved"}',
      ipAddress: '127.0.0.1',
    });

    const result = store.query({});
    expect(result.total).toBe(1);
    expect(result.entries).toHaveLength(1);

    const entry = result.entries[0];
    expect(entry.userId).toBe('user-1');
    expect(entry.action).toBe('engram.approve');
    expect(entry.resourceType).toBe('engram');
    expect(entry.resourceId).toBe('eng-1');
    expect(entry.details).toBe('{"status":"approved"}');
    expect(entry.ipAddress).toBe('127.0.0.1');
    expect(entry.timestamp).toBeDefined();
  });

  it('log() handles optional fields as null', () => {
    store.log({
      userId: 'user-1',
      action: 'engram.export',
      resourceType: 'engram',
    });

    const result = store.query({});
    const entry = result.entries[0];
    expect(entry.resourceId).toBeNull();
    expect(entry.details).toBeNull();
    expect(entry.ipAddress).toBeNull();
  });

  // --- query ---

  it('query() returns entries with total count', () => {
    store.log({ userId: 'user-1', action: 'a', resourceType: 'engram' });
    store.log({ userId: 'user-2', action: 'b', resourceType: 'engram' });
    store.log({ userId: 'user-1', action: 'c', resourceType: 'dead_letter' });

    const result = store.query({});
    expect(result.total).toBe(3);
    expect(result.entries).toHaveLength(3);
  });

  it('query() filters by userId', () => {
    store.log({ userId: 'user-1', action: 'a', resourceType: 'engram' });
    store.log({ userId: 'user-2', action: 'b', resourceType: 'engram' });

    const result = store.query({ userId: 'user-1' });
    expect(result.total).toBe(1);
    expect(result.entries[0].userId).toBe('user-1');
  });

  it('query() filters by action', () => {
    store.log({ userId: 'user-1', action: 'engram.approve', resourceType: 'engram' });
    store.log({ userId: 'user-1', action: 'engram.dismiss', resourceType: 'engram' });

    const result = store.query({ action: 'engram.approve' });
    expect(result.total).toBe(1);
    expect(result.entries[0].action).toBe('engram.approve');
  });

  it('query() filters by resourceType', () => {
    store.log({ userId: 'user-1', action: 'a', resourceType: 'engram' });
    store.log({ userId: 'user-1', action: 'b', resourceType: 'dead_letter' });

    const result = store.query({ resourceType: 'dead_letter' });
    expect(result.total).toBe(1);
    expect(result.entries[0].resourceType).toBe('dead_letter');
  });

  it('query() filters by date range', () => {
    // Insert rows with explicit timestamps via direct DB access
    const db = new Database(dbPath);
    db.prepare(
      `INSERT INTO audit_log (timestamp, user_id, action, resource_type) VALUES (?, ?, ?, ?)`,
    ).run('2026-01-01T00:00:00', 'user-1', 'old', 'engram');
    db.prepare(
      `INSERT INTO audit_log (timestamp, user_id, action, resource_type) VALUES (?, ?, ?, ?)`,
    ).run('2026-03-15T00:00:00', 'user-1', 'mid', 'engram');
    db.prepare(
      `INSERT INTO audit_log (timestamp, user_id, action, resource_type) VALUES (?, ?, ?, ?)`,
    ).run('2026-06-01T00:00:00', 'user-1', 'new', 'engram');
    db.close();

    const result = store.query({ from: '2026-02-01', to: '2026-04-01' });
    expect(result.total).toBe(1);
    expect(result.entries[0].action).toBe('mid');
  });

  it('query() supports pagination with limit and offset', () => {
    for (let i = 0; i < 5; i++) {
      store.log({ userId: 'user-1', action: `action-${i}`, resourceType: 'engram' });
    }

    const page1 = store.query({ limit: 2, offset: 0 });
    expect(page1.entries).toHaveLength(2);
    expect(page1.total).toBe(5);

    const page2 = store.query({ limit: 2, offset: 2 });
    expect(page2.entries).toHaveLength(2);
    expect(page2.total).toBe(5);

    const page3 = store.query({ limit: 2, offset: 4 });
    expect(page3.entries).toHaveLength(1);
    expect(page3.total).toBe(5);
  });

  it('query() returns empty set when no entries match', () => {
    const result = store.query({ userId: 'nonexistent' });
    expect(result.total).toBe(0);
    expect(result.entries).toHaveLength(0);
  });

  // --- getDistinctActions ---

  it('getDistinctActions() returns unique action types', () => {
    store.log({ userId: 'user-1', action: 'engram.approve', resourceType: 'engram' });
    store.log({ userId: 'user-1', action: 'engram.dismiss', resourceType: 'engram' });
    store.log({ userId: 'user-2', action: 'engram.approve', resourceType: 'engram' });
    store.log({ userId: 'user-1', action: 'engram.export', resourceType: 'engram' });

    const actions = store.getDistinctActions();
    expect(actions).toHaveLength(3);
    expect(actions).toContain('engram.approve');
    expect(actions).toContain('engram.dismiss');
    expect(actions).toContain('engram.export');
  });

  it('getDistinctActions() returns empty array when no entries exist', () => {
    const actions = store.getDistinctActions();
    expect(actions).toHaveLength(0);
  });

  // --- Multiple entries with different actions ---

  it('handles multiple entries with different actions correctly', () => {
    store.log({ userId: 'user-1', action: 'engram.approve', resourceType: 'engram', resourceId: 'e1' });
    store.log({ userId: 'user-1', action: 'engram.dismiss', resourceType: 'engram', resourceId: 'e2' });
    store.log({ userId: 'user-2', action: 'dead_letter.retry', resourceType: 'dead_letter', resourceId: 'd1' });
    store.log({ userId: 'user-2', action: 'engram.export', resourceType: 'engram' });

    const allEntries = store.query({});
    expect(allEntries.total).toBe(4);

    const user1Only = store.query({ userId: 'user-1' });
    expect(user1Only.total).toBe(2);

    const approvals = store.query({ action: 'engram.approve' });
    expect(approvals.total).toBe(1);

    const dlActions = store.query({ resourceType: 'dead_letter' });
    expect(dlActions.total).toBe(1);
    expect(dlActions.entries[0].action).toBe('dead_letter.retry');
  });
});
