import { describe, it, expect, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import { EngramIndex } from '../../src/storage/engram-index.js';
import { AuditStore } from '../../src/storage/audit-store.js';
import { DeadLetterStore } from '../../src/storage/dead-letter-store.js';
import { SettingsStore } from '../../src/storage/settings-store.js';
import { UserStore } from '../../src/storage/user-store.js';
import { DeltaStore } from '../../src/ingestion/delta-store.js';

function cleanupDb(path: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

describe('SQLite busy_timeout is set on all stores', () => {
  const paths: string[] = [];

  function makePath(): string {
    const p = join(tmpdir(), `busy-timeout-test-${randomUUID()}.db`);
    paths.push(p);
    return p;
  }

  afterEach(() => {
    for (const p of paths) cleanupDb(p);
    paths.length = 0;
  });

  function getBusyTimeout(store: any): number {
    // Access the internal db handle
    const db = store.db ?? (store as any).db;
    const row = db.pragma('busy_timeout') as Array<{ timeout: number }>;
    return row[0]?.timeout ?? 0;
  }

  it('EngramIndex sets busy_timeout', () => {
    const store = new EngramIndex(makePath());
    expect(getBusyTimeout(store)).toBeGreaterThan(0);
    store.close();
  });

  it('AuditStore sets busy_timeout', () => {
    const store = new AuditStore(makePath());
    expect(getBusyTimeout(store)).toBeGreaterThan(0);
    store.close();
  });

  it('DeadLetterStore sets busy_timeout', () => {
    const store = new DeadLetterStore(makePath());
    expect(getBusyTimeout(store)).toBeGreaterThan(0);
    store.close();
  });

  it('SettingsStore sets busy_timeout', () => {
    const store = new SettingsStore(makePath());
    expect(getBusyTimeout(store)).toBeGreaterThan(0);
    store.close();
  });

  it('UserStore sets busy_timeout', () => {
    const store = new UserStore(makePath());
    expect(getBusyTimeout(store)).toBeGreaterThan(0);
    store.close();
  });

  it('DeltaStore sets busy_timeout', () => {
    const store = new DeltaStore(makePath());
    expect(getBusyTimeout(store)).toBeGreaterThan(0);
    store.close();
  });
});
