import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import Database from 'better-sqlite3';
import { DeadLetterStore } from '../../src/storage/dead-letter-store.js';

function cleanupDb(path: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

describe('DeadLetterStore', () => {
  let dbPath: string;
  let store: DeadLetterStore;

  beforeEach(() => {
    dbPath = join(tmpdir(), `dead-letter-test-${randomUUID()}.db`);
    store = new DeadLetterStore(dbPath);
  });

  afterEach(() => {
    store.close();
    cleanupDb(dbPath);
  });

  // --- Table creation ---

  it('creates dead_letters table on construction', () => {
    const db = new Database(dbPath, { readonly: true });
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name = 'dead_letters'",
    ).all() as Array<{ name: string }>;
    db.close();

    expect(tables).toHaveLength(1);
    expect(tables[0].name).toBe('dead_letters');
  });

  // --- insert + get ---

  it('insert() stores a record retrievable by get()', () => {
    const payload = { source: 'graph', fileId: 'abc-123' };
    store.insert('cap-1', 'LLM timeout', 3, payload);

    const record = store.get(1);
    expect(record).toBeDefined();
    expect(record!.captureId).toBe('cap-1');
    expect(record!.error).toBe('LLM timeout');
    expect(record!.attempts).toBe(3);
    expect(JSON.parse(record!.payload)).toEqual(payload);
    expect(record!.createdAt).toBeDefined();
  });

  it('insert() serializes payload as JSON', () => {
    store.insert('cap-2', 'parse error', 1, { nested: { key: [1, 2, 3] } });

    const record = store.get(1);
    expect(JSON.parse(record!.payload)).toEqual({ nested: { key: [1, 2, 3] } });
  });

  it('insert() handles string payload', () => {
    store.insert('cap-3', 'error', 0, 'raw string payload');

    const record = store.get(1);
    expect(JSON.parse(record!.payload)).toBe('raw string payload');
  });

  // --- get ---

  it('get() returns undefined for nonexistent id', () => {
    const record = store.get(999);
    expect(record).toBeUndefined();
  });

  // --- list ---

  it('list() returns records ordered by created_at DESC', () => {
    // Insert via raw DB to control timestamps
    const db = new Database(dbPath);
    db.prepare(
      `INSERT INTO dead_letters (capture_id, error, attempts, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('cap-old', 'err1', 1, '{}', '2026-01-01T00:00:00');
    db.prepare(
      `INSERT INTO dead_letters (capture_id, error, attempts, payload, created_at) VALUES (?, ?, ?, ?, ?)`,
    ).run('cap-new', 'err2', 2, '{}', '2026-03-01T00:00:00');
    db.close();

    const records = store.list();
    expect(records).toHaveLength(2);
    expect(records[0].captureId).toBe('cap-new');
    expect(records[1].captureId).toBe('cap-old');
  });

  it('list() respects limit parameter', () => {
    for (let i = 0; i < 5; i++) {
      store.insert(`cap-${i}`, `error-${i}`, i, { index: i });
    }

    const records = store.list(3);
    expect(records).toHaveLength(3);
  });

  it('list() uses default limit of 50', () => {
    for (let i = 0; i < 60; i++) {
      store.insert(`cap-${i}`, `error-${i}`, 0, {});
    }

    const records = store.list();
    expect(records).toHaveLength(50);
  });

  it('list() returns empty array when no records exist', () => {
    const records = store.list();
    expect(records).toEqual([]);
  });

  // --- count ---

  it('count() returns 0 for empty store', () => {
    expect(store.count()).toBe(0);
  });

  it('count() tracks insertions', () => {
    store.insert('cap-1', 'err', 0, {});
    store.insert('cap-2', 'err', 0, {});
    store.insert('cap-3', 'err', 0, {});

    expect(store.count()).toBe(3);
  });

  // --- delete ---

  it('delete() removes a record by id', () => {
    store.insert('cap-1', 'err', 0, {});
    expect(store.count()).toBe(1);

    store.delete(1);
    expect(store.count()).toBe(0);
    expect(store.get(1)).toBeUndefined();
  });

  it('delete() only removes the targeted record', () => {
    store.insert('cap-1', 'err1', 0, {});
    store.insert('cap-2', 'err2', 0, {});
    store.insert('cap-3', 'err3', 0, {});

    store.delete(2);
    expect(store.count()).toBe(2);
    expect(store.get(1)).toBeDefined();
    expect(store.get(2)).toBeUndefined();
    expect(store.get(3)).toBeDefined();
  });

  it('delete() is a no-op for nonexistent id', () => {
    store.insert('cap-1', 'err', 0, {});

    store.delete(999);
    expect(store.count()).toBe(1);
  });

  // --- auto-increment ids ---

  it('assigns auto-incrementing ids', () => {
    store.insert('cap-a', 'err', 0, {});
    store.insert('cap-b', 'err', 0, {});

    const first = store.get(1);
    const second = store.get(2);
    expect(first!.captureId).toBe('cap-a');
    expect(second!.captureId).toBe('cap-b');
  });

  // --- WAL mode ---

  it('sets WAL journal mode', () => {
    const db = new Database(dbPath, { readonly: true });
    const row = db.prepare('PRAGMA journal_mode').get() as { journal_mode: string };
    db.close();

    expect(row.journal_mode).toBe('wal');
  });
});
