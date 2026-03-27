import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import Fastify from 'fastify';
import { SettingsStore } from '../../src/storage/settings-store.js';
import { settingsRoutes } from '../../src/api/routes/settings.js';

function cleanupDb(path: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

describe('settings routes', () => {
  let dbPath: string;
  let settingsStore: SettingsStore;
  let mockAuditStore: any;

  beforeEach(() => {
    dbPath = join(tmpdir(), `settings-api-test-${randomUUID()}.db`);
    settingsStore = new SettingsStore(dbPath);
    mockAuditStore = { log: vi.fn() };
  });

  afterEach(() => {
    settingsStore.close();
    cleanupDb(dbPath);
  });

  async function buildApp() {
    const app = Fastify();
    app.decorateRequest('user', null);
    app.addHook('preHandler', async (req) => {
      (req as any).user = { userId: 'user-1', userEmail: 'alice@contoso.com' };
    });
    await app.register(settingsRoutes, {
      settingsStore,
      auditStore: mockAuditStore,
    });
    return app;
  }

  // --- GET /api/settings ---

  it('GET /api/settings returns defaults for a new user', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/settings' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.userId).toBe('user-1');
    expect(body.theme).toBe('dark');
    expect(body.itemsPerPage).toBe(20);
    expect(body.notificationNewEngram).toBe(1);
    expect(body.notificationSound).toBe(0);
    expect(body.autoApproveConfidence).toBe(0);
  });

  // --- PATCH /api/settings ---

  it('PATCH /api/settings updates and returns new settings', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { theme: 'light', itemsPerPage: 50 },
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.theme).toBe('light');
    expect(body.itemsPerPage).toBe(50);
    expect(body.userId).toBe('user-1');

    // Audit store should have been called
    expect(mockAuditStore.log).toHaveBeenCalledTimes(1);
  });

  it('PATCH /api/settings partial update only changes specified fields', async () => {
    const app = await buildApp();

    // First set some values
    await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { theme: 'light', itemsPerPage: 50 },
    });

    // Partial update: only change theme
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/settings',
      payload: { theme: 'dark' },
    });
    const body = JSON.parse(res.body);

    expect(body.theme).toBe('dark');
    expect(body.itemsPerPage).toBe(50); // preserved from earlier update

    // Confirm via GET
    const getRes = await app.inject({ method: 'GET', url: '/api/settings' });
    const getBody = JSON.parse(getRes.body);
    expect(getBody.theme).toBe('dark');
    expect(getBody.itemsPerPage).toBe(50);
  });
});
