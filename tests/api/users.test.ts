import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { unlinkSync } from 'node:fs';
import Fastify from 'fastify';
import { UserStore } from '../../src/storage/user-store.js';
import { EngramIndex } from '../../src/storage/engram-index.js';
import { userRoutes } from '../../src/api/routes/users.js';

function cleanupDb(path: string) {
  for (const suffix of ['', '-wal', '-shm']) {
    try { unlinkSync(path + suffix); } catch { /* ignore */ }
  }
}

describe('user routes', () => {
  let userDbPath: string;
  let engramDbPath: string;
  let userStore: UserStore;
  let engramIndex: EngramIndex;

  beforeEach(() => {
    userDbPath = join(tmpdir(), `user-route-test-${randomUUID()}.db`);
    engramDbPath = join(tmpdir(), `engram-route-test-${randomUUID()}.db`);
    userStore = new UserStore(userDbPath);
    engramIndex = new EngramIndex(engramDbPath);
  });

  afterEach(() => {
    userStore.close();
    engramIndex.close();
    cleanupDb(userDbPath);
    cleanupDb(engramDbPath);
  });

  async function buildApp() {
    const app = Fastify({ logger: false });
    app.decorateRequest('user', null);
    app.addHook('preHandler', async (req) => {
      (req as any).user = { userId: 'user-1', userEmail: 'alice@contoso.com' };
    });
    await app.register(userRoutes, { userStore, engramIndex });
    return app;
  }

  function seedUsers() {
    userStore.upsert({ id: 'user-1', email: 'alice@contoso.com', displayName: 'Alice Smith', department: 'Engineering' });
    userStore.upsert({ id: 'user-2', email: 'bob@contoso.com', displayName: 'Bob Jones', department: 'Engineering' });
    userStore.upsert({ id: 'user-3', email: 'carol@contoso.com', displayName: 'Carol White', department: 'Operations' });
  }

  // --- GET /api/users ---

  it('GET /api/users returns paginated user list', async () => {
    seedUsers();
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/users' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.users).toHaveLength(3);
    expect(body.total).toBe(3);
    expect(body.page).toBe(1);
    expect(body.limit).toBe(20);
  });

  it('GET /api/users?department=Engineering filters by department', async () => {
    seedUsers();
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/users?department=Engineering' });
    const body = JSON.parse(res.body);

    expect(body.users).toHaveLength(2);
    expect(body.total).toBe(2);
  });

  it('GET /api/users?page=2&limit=2 paginates correctly', async () => {
    seedUsers();
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/users?page=2&limit=2' });
    const body = JSON.parse(res.body);

    expect(body.users).toHaveLength(1);
    expect(body.total).toBe(3);
    expect(body.page).toBe(2);
    expect(body.limit).toBe(2);
  });

  it('GET /api/users?q=alice searches by name or email', async () => {
    seedUsers();
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/users?q=alice' });
    const body = JSON.parse(res.body);

    expect(body.users).toHaveLength(1);
    expect(body.users[0].id).toBe('user-1');
  });

  it('GET /api/users returns empty list when no users exist', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/users' });
    const body = JSON.parse(res.body);

    expect(body.users).toHaveLength(0);
    expect(body.total).toBe(0);
  });

  // --- GET /api/users/departments ---

  it('GET /api/users/departments returns department list with counts', async () => {
    seedUsers();
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/users/departments' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(body.departments)).toBe(true);
    expect(body.departments).toHaveLength(2);

    const engineering = body.departments.find((d: any) => d.department === 'Engineering');
    expect(engineering.count).toBe(2);

    const operations = body.departments.find((d: any) => d.department === 'Operations');
    expect(operations.count).toBe(1);
  });

  // --- GET /api/users/:id ---

  it('GET /api/users/:id returns user with stats and recent engrams', async () => {
    seedUsers();
    engramIndex.upsert({
      id: 'eng-1', userId: 'user-1', concept: 'Test engram',
      approvalStatus: 'approved', capturedAt: new Date().toISOString(),
      sourceType: 'graph_email', confidence: 0.9,
    });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/users/user-1' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.user.id).toBe('user-1');
    expect(body.user.email).toBe('alice@contoso.com');
    expect(body.stats).toBeDefined();
    expect(Array.isArray(body.recentEngrams)).toBe(true);
    expect(body.recentEngrams).toHaveLength(1);
  });

  it('GET /api/users/:id returns 404 for non-existent user', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/users/nonexistent' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(404);
    expect(body.error).toBe('User not found');
  });

  // --- PATCH /api/users/:id ---

  it('PATCH /api/users/:id updates department', async () => {
    seedUsers();
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/users/user-1',
      payload: { department: 'R&D' },
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.user.department).toBe('R&D');
  });

  it('PATCH /api/users/:id updates role', async () => {
    seedUsers();
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/users/user-1',
      payload: { role: 'admin' },
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.user.role).toBe('admin');
  });

  it('PATCH /api/users/:id rejects invalid role', async () => {
    seedUsers();
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/users/user-1',
      payload: { role: 'superadmin' },
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(400);
    expect(body.error).toContain('Invalid role');
  });

  it('PATCH /api/users/:id toggles harvesting', async () => {
    seedUsers();
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/users/user-1',
      payload: { harvestingEnabled: false },
    });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.user.harvestingEnabled).toBe(0);
  });

  it('PATCH /api/users/:id returns 404 for non-existent user', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/users/nonexistent',
      payload: { department: 'Test' },
    });

    expect(res.statusCode).toBe(404);
  });

  // --- POST /api/users/:id/sync-stats ---

  it('POST /api/users/:id/sync-stats recalculates stats from engrams', async () => {
    seedUsers();
    engramIndex.upsert({
      id: 'eng-1', userId: 'user-1', concept: 'Approved engram',
      approvalStatus: 'approved', capturedAt: '2026-03-27T10:00:00Z',
      sourceType: 'graph_email', confidence: 0.9,
    });
    engramIndex.upsert({
      id: 'eng-2', userId: 'user-1', concept: 'Dismissed engram',
      approvalStatus: 'dismissed', capturedAt: '2026-03-27T11:00:00Z',
      sourceType: 'graph_teams', confidence: 0.6,
    });
    engramIndex.upsert({
      id: 'eng-3', userId: 'user-1', concept: 'Pending engram',
      approvalStatus: 'pending', capturedAt: '2026-03-27T12:00:00Z',
      sourceType: 'desktop_window', confidence: 0.7,
    });

    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/users/user-1/sync-stats' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.stats.totalCaptures).toBe(3);
    expect(body.stats.totalApproved).toBe(1);
    expect(body.stats.totalDismissed).toBe(1);
    expect(body.stats.lastCaptureAt).toBe('2026-03-27T12:00:00Z');
  });

  it('POST /api/users/:id/sync-stats returns 404 for non-existent user', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: '/api/users/nonexistent/sync-stats' });

    expect(res.statusCode).toBe(404);
  });
});
