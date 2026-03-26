export interface AuthUser {
  userId: string;
  userEmail: string;
}

export function extractUserId(bearerToken: string): AuthUser {
  const parts = bearerToken.replace('Bearer ', '').split('.');
  if (parts.length !== 3) throw new Error('Malformed JWT');

  let payload: any;
  try {
    payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch {
    throw new Error('Invalid JWT payload');
  }

  if (!payload.oid) throw new Error('Missing oid claim in JWT');

  return {
    userId: payload.oid,
    userEmail: payload.preferred_username ?? payload.upn ?? '',
  };
}
