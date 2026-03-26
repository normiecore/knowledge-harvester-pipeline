import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { statsRoutes } from '../../src/api/routes/stats.js';

describe('stats route', () => {
  let mockMuninnClient: any;

  beforeEach(() => {
    mockMuninnClient = {
      recall: vi.fn().mockResolvedValue({
        engrams: [
          { id: 'e1', concept: 'A' },
          { id: 'e2', concept: 'B' },
        ],
      }),
    };
  });

  async function buildApp() {
    const app = Fastify();
    app.decorateRequest('user', null);
    app.addHook('preHandler', async (req) => {
      (req as any).user = { userId: 'user-1', userEmail: 'alice@contoso.com' };
    });
    await app.register(statsRoutes, { muninnClient: mockMuninnClient });
    return app;
  }

  it('GET /api/stats returns total engrams and userId', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/stats' });
    const body = JSON.parse(res.body);

    expect(res.statusCode).toBe(200);
    expect(body.totalEngrams).toBe(2);
    expect(body.userId).toBe('user-1');
  });

  it('returns 0 when no engrams exist', async () => {
    mockMuninnClient.recall.mockResolvedValue({ engrams: [] });

    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/api/stats' });
    const body = JSON.parse(res.body);

    expect(body.totalEngrams).toBe(0);
  });
});
