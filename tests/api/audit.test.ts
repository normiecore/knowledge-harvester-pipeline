import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import Fastify from 'fastify';
import Database from 'better-sqlite3';
import { AuditStore } from '../../src/storage/audit-store.js';
import { auditRoutes } from '../../src/api/routes/audit.js';

function cleanupDb(path: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

describe('audit routes', () => {
  let dbPath: string;
  let auditStore: AuditStore;

  beforeEach(() => {
    dbPath = join(tmpdir(), `audit-route-test-${randomUUID()}.db`);
    auditStore = new AuditStore(dbPath);
  });

  afterEach(() => {
    auditStore.close();
    cleanupDb(dbPath);
  });

  async function buildApp(role = 'admin') {
    const app = Fastify();
    app.decorateRequest('user', null);
    app.addHook('preHandler', async (req) => {
      (req as any).user = { userId: 'user-1', userEmail: 'alice@contoso.com', role };
    });
    await app.register(auditRoutes, { auditStore });
    return app;
  }

  // --- GET /api/audit ---

  it('GET /api/audit returns entries', async () => {
    auditStore.log({ userId: 'user-1', action: 'engram.approve', resourceType: 'engram', resourceId: 'e1' });
    auditStore.log({ userId: 'user-2', action: 'engram.dismiss', resourceType: 'engram', resourceId: 'e2' });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/audit' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.total).toBe(2);
    expect(body.entries).toHaveLength(2);
  });

  it('GET /api/audit with userId filter', async () => {
    auditStore.log({ userId: 'user-1', action: 'engram.approve', resourceType: 'engram' });
    auditStore.log({ userId: 'user-2', action: 'engram.dismiss', resourceType: 'engram' });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/audit?userId=user-1' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.total).toBe(1);
    expect(body.entries[0].userId).toBe('user-1');
  });

  it('GET /api/audit with action filter', async () => {
    auditStore.log({ userId: 'user-1', action: 'engram.approve', resourceType: 'engram' });
    auditStore.log({ userId: 'user-1', action: 'engram.export', resourceType: 'engram' });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/audit?action=engram.export' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.total).toBe(1);
    expect(body.entries[0].action).toBe('engram.export');
  });

  it('GET /api/audit with date range filters', async () => {
    const db = new Database(dbPath);
    db.prepare(
      `INSERT INTO audit_log (timestamp, user_id, action, resource_type) VALUES (?, ?, ?, ?)`,
    ).run('2026-01-01T00:00:00', 'user-1', 'old', 'engram');
    db.prepare(
      `INSERT INTO audit_log (timestamp, user_id, action, resource_type) VALUES (?, ?, ?, ?)`,
    ).run('2026-03-15T00:00:00', 'user-1', 'mid', 'engram');
    db.close();

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/audit?from=2026-02-01&to=2026-04-01' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.total).toBe(1);
    expect(body.entries[0].action).toBe('mid');
  });

  it('GET /api/audit with pagination', async () => {
    for (let i = 0; i < 5; i++) {
      auditStore.log({ userId: 'user-1', action: `action-${i}`, resourceType: 'engram' });
    }

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/audit?limit=2&offset=0' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.entries).toHaveLength(2);
    expect(body.total).toBe(5);
  });

  it('GET /api/audit returns empty result set', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/audit' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.total).toBe(0);
    expect(body.entries).toHaveLength(0);
  });

  // --- GET /api/audit/actions ---

  it('GET /api/audit/actions returns distinct actions', async () => {
    auditStore.log({ userId: 'user-1', action: 'engram.approve', resourceType: 'engram' });
    auditStore.log({ userId: 'user-1', action: 'engram.dismiss', resourceType: 'engram' });
    auditStore.log({ userId: 'user-2', action: 'engram.approve', resourceType: 'engram' });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/audit/actions' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.actions).toHaveLength(2);
    expect(body.actions).toContain('engram.approve');
    expect(body.actions).toContain('engram.dismiss');
  });

  it('GET /api/audit/actions returns empty when no entries', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/audit/actions' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.actions).toHaveLength(0);
  });

  // --- Access control ---

  it('GET /api/audit returns 403 for non-admin users', async () => {
    const app = await buildApp('user');
    const res = await app.inject({ method: 'GET', url: '/api/audit' });

    expect(res.statusCode).toBe(403);
  });
});
