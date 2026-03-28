/**
 * Desktop Agent -> Pipeline Server end-to-end integration test.
 *
 * Validates the contract between the desktop agent's PipelineClient/Sender
 * and the pipeline's POST /api/captures endpoint.
 *
 * External dependencies (NATS, MuninnDB, LLM, PaddleOCR) are stubbed so the
 * test is fully self-contained -- no Docker containers or live services needed.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import jwt from 'jsonwebtoken';
import Fastify, { type FastifyInstance } from 'fastify';
import { captureRoutes } from '../../src/api/routes/captures.js';
import { createAuthVerifier, type AuthVerifier } from '../../src/api/auth.js';
import type { NatsClient } from '../../src/queue/nats-client.js';
import type { RawCapture, SourceType } from '../../src/types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEV_SECRET = 'test-e2e-secret';
const TEST_USER_ID = 'user-e2e-001';
const TEST_USER_EMAIL = 'engineer@subsea.corp';

function signToken(
  overrides: Record<string, unknown> = {},
  secret = DEV_SECRET,
): string {
  return jwt.sign(
    { oid: TEST_USER_ID, preferred_username: TEST_USER_EMAIL, ...overrides },
    secret,
  );
}

// ---------------------------------------------------------------------------
// Payload factory -- mirrors the desktop agent's Sender.drain() exactly.
// See: knowledge-harvester-desktop/src/sender.ts lines 41-49
// and  knowledge-harvester-desktop/src/pipeline-client.ts (RawCapturePayload)
// ---------------------------------------------------------------------------

function makeDesktopPayload(overrides: Partial<RawCapture> = {}): RawCapture {
  return {
    id: `desktop-cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    userId: TEST_USER_ID,
    userEmail: TEST_USER_EMAIL,
    sourceType: 'desktop_screenshot' as SourceType,
    sourceApp: 'knowledge-harvester-desktop',
    capturedAt: new Date().toISOString(),
    rawContent: 'base64-encoded-screenshot-data-placeholder',
    metadata: {
      captureType: 'periodic',
      windowTitle: 'Visual Studio Code',
      windowClass: 'Code.exe',
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Stubbed NATS client
// ---------------------------------------------------------------------------

function createMockNatsClient(): NatsClient & { published: Array<{ topic: string; data: unknown }> } {
  const published: Array<{ topic: string; data: unknown }> = [];
  return {
    published,
    publish(topic: string, data: unknown) {
      published.push({ topic, data });
    },
    subscribe: vi.fn(),
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    isConnected: vi.fn().mockReturnValue(true),
  } as any;
}

// ---------------------------------------------------------------------------
// Server builder -- assembles the minimal Fastify app with the auth hook
// and capture route, matching the real server's behavior in server.ts.
// ---------------------------------------------------------------------------

async function buildTestServer(
  natsClient: NatsClient,
  authVerifier: AuthVerifier,
): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  // Reproduce the auth preHandler from src/api/server.ts lines 103-120
  app.addHook('preHandler', async (req, reply) => {
    const url = req.url;
    if (url === '/api/health') return;
    if (!url.startsWith('/api/')) return;

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      reply.code(401).send({ error: 'Missing authorization header' });
      return;
    }

    try {
      (req as any).user = await authVerifier(authHeader);
    } catch (err: any) {
      reply.code(401).send({ error: err.message });
      return;
    }
  });

  // Health check -- no auth
  app.get('/api/health', async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
    checks: {},
  }));

  // Register capture routes (the real route module)
  await app.register(captureRoutes, { natsClient });

  return app;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe('Desktop Agent -> Pipeline Server E2E', () => {
  let app: FastifyInstance;
  let baseUrl: string;
  let natsClient: ReturnType<typeof createMockNatsClient>;
  let token: string;

  beforeAll(async () => {
    token = signToken();
    natsClient = createMockNatsClient();

    const authVerifier: AuthVerifier = createAuthVerifier({
      mode: 'dev',
      devSecret: DEV_SECRET,
    });

    app = await buildTestServer(natsClient as any, authVerifier);
    const address = await app.listen({ port: 0, host: '127.0.0.1' });
    baseUrl = address;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    natsClient.published.length = 0;
  });

  // -----------------------------------------------------------------------
  // Happy path: desktop agent sends a valid capture
  // -----------------------------------------------------------------------

  describe('happy path', () => {
    it('accepts a valid desktop capture and publishes to NATS', async () => {
      const payload = makeDesktopPayload();

      const res = await fetch(`${baseUrl}/api/captures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(202);
      const body = await res.json();
      expect(body).toEqual({ accepted: true, id: payload.id });

      // Verify the capture was forwarded to NATS on the raw.captures topic
      expect(natsClient.published).toHaveLength(1);
      expect(natsClient.published[0].topic).toBe('raw.captures');

      const published = natsClient.published[0].data as RawCapture;
      expect(published.id).toBe(payload.id);
      expect(published.userId).toBe(TEST_USER_ID);
      expect(published.userEmail).toBe(TEST_USER_EMAIL);
      expect(published.sourceType).toBe('desktop_screenshot');
      expect(published.sourceApp).toBe('knowledge-harvester-desktop');
      expect(published.metadata).toEqual(payload.metadata);
    });

    it('preserves the exact payload shape the desktop sender builds', async () => {
      // Reproduce the exact metadata shape from sender.ts lines 33-39
      const metadata: Record<string, unknown> = {
        captureType: 'window_change',
        windowTitle: 'Google Chrome - Pipeline Docs',
        windowClass: 'chrome.exe',
        processName: 'chrome',
      };

      const payload = makeDesktopPayload({ metadata });

      const res = await fetch(`${baseUrl}/api/captures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(202);

      const published = natsClient.published[0].data as RawCapture;
      expect(published.metadata).toEqual(metadata);
    });

    it('handles multiple sequential captures (simulating drain loop)', async () => {
      const payloads = Array.from({ length: 5 }, (_, i) =>
        makeDesktopPayload({ id: `batch-cap-${i}` }),
      );

      for (const payload of payloads) {
        const res = await fetch(`${baseUrl}/api/captures`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
        expect(res.status).toBe(202);
      }

      expect(natsClient.published).toHaveLength(5);
      const ids = natsClient.published.map((p) => (p.data as RawCapture).id);
      expect(ids).toEqual(payloads.map((p) => p.id));
    });
  });

  // -----------------------------------------------------------------------
  // Validation errors: pipeline rejects malformed payloads
  // -----------------------------------------------------------------------

  describe('payload validation', () => {
    it('rejects a payload with missing required fields', async () => {
      const res = await fetch(`${baseUrl}/api/captures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id: 'partial' }),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Invalid capture payload');
      expect(body.details).toBeDefined();
      expect(natsClient.published).toHaveLength(0);
    });

    it('rejects an invalid sourceType not in the enum', async () => {
      const payload = makeDesktopPayload({
        sourceType: 'invalid_source' as any,
      });

      const res = await fetch(`${baseUrl}/api/captures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toBe('Invalid capture payload');
    });

    it('rejects a completely empty body', async () => {
      const res = await fetch(`${baseUrl}/api/captures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: '{}',
      });

      expect(res.status).toBe(400);
    });

    it('rejects when rawContent is missing', async () => {
      const { rawContent, ...noContent } = makeDesktopPayload();

      const res = await fetch(`${baseUrl}/api/captures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(noContent),
      });

      expect(res.status).toBe(400);
    });

    it('rejects when metadata is not an object', async () => {
      const payload = makeDesktopPayload();
      (payload as any).metadata = 'not-an-object';

      const res = await fetch(`${baseUrl}/api/captures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(400);
    });
  });

  // -----------------------------------------------------------------------
  // Auth: 401 scenarios
  // -----------------------------------------------------------------------

  describe('authentication (401)', () => {
    it('returns 401 when no Authorization header is sent', async () => {
      const payload = makeDesktopPayload();

      const res = await fetch(`${baseUrl}/api/captures`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Missing authorization header');
    });

    it('returns 401 for an invalid JWT token', async () => {
      const payload = makeDesktopPayload();

      const res = await fetch(`${baseUrl}/api/captures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer totally-not-a-valid-jwt',
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(401);
    });

    it('returns 401 for a JWT signed with a different secret', async () => {
      const badToken = jwt.sign(
        { oid: 'attacker', preferred_username: 'evil@corp.com' },
        'wrong-secret',
      );
      const payload = makeDesktopPayload();

      const res = await fetch(`${baseUrl}/api/captures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${badToken}`,
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(401);
    });

    it('returns 401 for a JWT missing the oid claim', async () => {
      const noOidToken = jwt.sign(
        { preferred_username: 'user@corp.com' },
        DEV_SECRET,
      );
      const payload = makeDesktopPayload();

      const res = await fetch(`${baseUrl}/api/captures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${noOidToken}`,
        },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(401);
    });
  });

  // -----------------------------------------------------------------------
  // PipelineClient contract: verify sendCapture returns correct boolean
  // for each HTTP status the pipeline might return.
  //
  // This mirrors the desktop agent's PipelineClient.sendCapture() logic:
  //   - res.ok  -> return true
  //   - !res.ok -> return false
  //   - network error / timeout -> return false
  // -----------------------------------------------------------------------

  describe('PipelineClient contract simulation', () => {
    async function sendCaptureLikeDesktop(
      url: string,
      payload: RawCapture,
      authToken?: string,
    ): Promise<{ success: boolean; status?: number }> {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };
        if (authToken) {
          headers['Authorization'] = `Bearer ${authToken}`;
        }

        const res = await fetch(`${url}/api/captures`, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(10000),
        });

        return { success: res.ok, status: res.status };
      } catch {
        return { success: false };
      }
    }

    it('sendCapture returns true on 202 Accepted', async () => {
      const payload = makeDesktopPayload();
      const result = await sendCaptureLikeDesktop(baseUrl, payload, token);

      expect(result.success).toBe(true);
      expect(result.status).toBe(202);
    });

    it('sendCapture returns false on 401 Unauthorized', async () => {
      const payload = makeDesktopPayload();
      const result = await sendCaptureLikeDesktop(baseUrl, payload);

      expect(result.success).toBe(false);
      expect(result.status).toBe(401);
    });

    it('sendCapture returns false on 400 Bad Request', async () => {
      const badPayload = { id: 'incomplete' } as any;
      const result = await sendCaptureLikeDesktop(baseUrl, badPayload, token);

      expect(result.success).toBe(false);
      expect(result.status).toBe(400);
    });

    it('sendCapture returns false when server is unreachable', async () => {
      const payload = makeDesktopPayload();
      // Port 1 is almost certainly not listening
      const result = await sendCaptureLikeDesktop('http://127.0.0.1:1', payload, token);

      expect(result.success).toBe(false);
      expect(result.status).toBeUndefined(); // network error, no HTTP status
    });
  });

  // -----------------------------------------------------------------------
  // Rate limiting: 429 scenario
  // -----------------------------------------------------------------------

  describe('rate limiting (429)', () => {
    let rateLimitedApp: FastifyInstance;
    let rateLimitedUrl: string;
    let rlNats: ReturnType<typeof createMockNatsClient>;

    beforeAll(async () => {
      rlNats = createMockNatsClient();

      const rlApp = Fastify({ logger: false });

      // Register rate limiting with very low limit, no allowList so
      // 127.0.0.1 is NOT exempt (unlike the real server)
      const rateLimit = (await import('@fastify/rate-limit')).default;
      await rlApp.register(rateLimit, {
        max: 2,
        timeWindow: '1 minute',
        keyGenerator: (req) => req.ip,
      });

      // Auth hook
      const authVerifier: AuthVerifier = createAuthVerifier({
        mode: 'dev',
        devSecret: DEV_SECRET,
      });

      rlApp.addHook('preHandler', async (req, reply) => {
        if (!req.url.startsWith('/api/')) return;
        const authHeader = req.headers.authorization;
        if (!authHeader) {
          reply.code(401).send({ error: 'Missing authorization header' });
          return;
        }
        try {
          (req as any).user = await authVerifier(authHeader);
        } catch (err: any) {
          reply.code(401).send({ error: err.message });
          return;
        }
      });

      await rlApp.register(captureRoutes, { natsClient: rlNats as any });

      rateLimitedApp = rlApp;
      const address = await rateLimitedApp.listen({ port: 0, host: '127.0.0.1' });
      rateLimitedUrl = address;
    });

    afterAll(async () => {
      await rateLimitedApp.close();
    });

    it('returns 429 after exceeding rate limit', async () => {
      const statuses: number[] = [];

      // Send 3 requests; limit is 2 per minute
      for (let i = 0; i < 3; i++) {
        const payload = makeDesktopPayload({ id: `rl-cap-${i}` });
        const res = await fetch(`${rateLimitedUrl}/api/captures`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });
        statuses.push(res.status);
      }

      // First 2 should succeed, 3rd should be rate limited
      expect(statuses[0]).toBe(202);
      expect(statuses[1]).toBe(202);
      expect(statuses[2]).toBe(429);
    });

    it('PipelineClient treats 429 as failure (res.ok is false)', async () => {
      // Exhaust remaining quota
      for (let i = 0; i < 3; i++) {
        await fetch(`${rateLimitedUrl}/api/captures`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(makeDesktopPayload({ id: `rl-drain-${i}` })),
        });
      }

      const payload = makeDesktopPayload({ id: 'rl-final' });
      const res = await fetch(`${rateLimitedUrl}/api/captures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe(429);
    });
  });

  // -----------------------------------------------------------------------
  // 500 Internal Server Error scenario
  // -----------------------------------------------------------------------

  describe('server error (500)', () => {
    let errorApp: FastifyInstance;
    let errorUrl: string;

    beforeAll(async () => {
      errorApp = Fastify({ logger: false });

      // Simulate a server that throws on the capture route
      errorApp.post('/api/captures', async () => {
        throw new Error('Simulated internal server error');
      });

      const address = await errorApp.listen({ port: 0, host: '127.0.0.1' });
      errorUrl = address;
    });

    afterAll(async () => {
      await errorApp.close();
    });

    it('returns 500 when server has an internal error', async () => {
      const payload = makeDesktopPayload();
      const res = await fetch(`${errorUrl}/api/captures`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(res.status).toBe(500);
    });

    it('PipelineClient treats 500 as failure (res.ok is false)', async () => {
      const payload = makeDesktopPayload();
      const res = await fetch(`${errorUrl}/api/captures`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      expect(res.ok).toBe(false);
      expect(res.status).toBe(500);
    });
  });

  // -----------------------------------------------------------------------
  // Health check (no auth required)
  // -----------------------------------------------------------------------

  describe('health check', () => {
    it('returns 200 without auth', async () => {
      const res = await fetch(`${baseUrl}/api/health`);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.status).toBeDefined();
      expect(body.timestamp).toBeDefined();
    });
  });

  // -----------------------------------------------------------------------
  // Source type compatibility: all desktop source types accepted
  // -----------------------------------------------------------------------

  describe('desktop source types', () => {
    for (const sourceType of ['desktop_screenshot', 'desktop_window'] as const) {
      it(`accepts sourceType="${sourceType}"`, async () => {
        const payload = makeDesktopPayload({ sourceType });

        const res = await fetch(`${baseUrl}/api/captures`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        });

        expect(res.status).toBe(202);
      });
    }
  });

  // -----------------------------------------------------------------------
  // Response shape: verify what the desktop agent parses
  // -----------------------------------------------------------------------

  describe('response contract', () => {
    it('202 response contains { accepted: true, id: string }', async () => {
      const payload = makeDesktopPayload();

      const res = await fetch(`${baseUrl}/api/captures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });

      const body = await res.json();
      expect(body).toHaveProperty('accepted', true);
      expect(body).toHaveProperty('id', payload.id);
      expect(typeof body.id).toBe('string');
      // No extra unexpected fields
      expect(Object.keys(body).sort()).toEqual(['accepted', 'id']);
    });

    it('400 response contains { error: string, details: array }', async () => {
      const res = await fetch(`${baseUrl}/api/captures`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ id: 'bad' }),
      });

      const body = await res.json();
      expect(body).toHaveProperty('error', 'Invalid capture payload');
      expect(Array.isArray(body.details)).toBe(true);
      expect(body.details.length).toBeGreaterThan(0);
    });

    it('401 response contains { error: string }', async () => {
      const res = await fetch(`${baseUrl}/api/captures`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeDesktopPayload()),
      });

      const body = await res.json();
      expect(body).toHaveProperty('error');
      expect(typeof body.error).toBe('string');
    });
  });
});
