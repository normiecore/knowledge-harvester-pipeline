import { describe, it, expect } from 'vitest';
import { extractUserId } from '../../src/api/auth.js';

function makeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = 'fake-signature';
  return `${header}.${body}.${sig}`;
}

describe('extractUserId', () => {
  it('extracts user ID from valid JWT payload', () => {
    const token = makeJwt({ oid: 'user-123', preferred_username: 'alice@contoso.com' });
    const result = extractUserId(`Bearer ${token}`);
    expect(result.userId).toBe('user-123');
    expect(result.userEmail).toBe('alice@contoso.com');
  });

  it('falls back to upn when preferred_username is missing', () => {
    const token = makeJwt({ oid: 'user-456', upn: 'bob@contoso.com' });
    const result = extractUserId(token);
    expect(result.userId).toBe('user-456');
    expect(result.userEmail).toBe('bob@contoso.com');
  });

  it('throws on missing oid claim', () => {
    const token = makeJwt({ preferred_username: 'alice@contoso.com' });
    expect(() => extractUserId(token)).toThrow('Missing oid claim');
  });

  it('throws on malformed token (not 3 parts)', () => {
    expect(() => extractUserId('not-a-jwt')).toThrow('Malformed JWT');
  });

  it('throws on invalid base64 payload', () => {
    expect(() => extractUserId('a.!!!.c')).toThrow('Invalid JWT payload');
  });
});
