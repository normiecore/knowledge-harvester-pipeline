import { describe, it, expect } from 'vitest';
import jwt from 'jsonwebtoken';
import { createAuthVerifier } from '../../src/api/auth.js';

const DEV_SECRET = 'test-secret-key';

function makeDevToken(payload: Record<string, unknown>): string {
  return jwt.sign(payload, DEV_SECRET, { algorithm: 'HS256' });
}

describe('auth - dev mode', () => {
  const verify = createAuthVerifier({ mode: 'dev', devSecret: DEV_SECRET });

  it('verifies a valid dev token', async () => {
    const token = makeDevToken({ oid: 'user-abc', preferred_username: 'james@example.com' });
    const user = await verify(token);
    expect(user.userId).toBe('user-abc');
    expect(user.userEmail).toBe('james@example.com');
  });

  it('rejects token signed with wrong secret', async () => {
    const token = jwt.sign({ oid: 'user-abc' }, 'wrong-secret');
    await expect(verify(token)).rejects.toThrow();
  });

  it('rejects expired token', async () => {
    const token = jwt.sign({ oid: 'user-abc', exp: Math.floor(Date.now() / 1000) - 60 }, DEV_SECRET);
    await expect(verify(token)).rejects.toThrow();
  });

  it('rejects token without oid claim', async () => {
    const token = makeDevToken({ preferred_username: 'james@example.com' });
    await expect(verify(token)).rejects.toThrow('Missing oid');
  });

  it('handles Bearer prefix', async () => {
    const token = makeDevToken({ oid: 'user-abc', preferred_username: 'j@e.com' });
    const user = await verify(`Bearer ${token}`);
    expect(user.userId).toBe('user-abc');
  });
});

describe('auth - azure mode', () => {
  it('creates verifier without throwing', () => {
    const verify = createAuthVerifier({ mode: 'azure', azureAdAudience: 'api://test', azureTenantId: 'tenant-123' });
    expect(verify).toBeTypeOf('function');
  });
});
