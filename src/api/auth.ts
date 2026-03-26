import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

export interface AuthUser { userId: string; userEmail: string; }

export interface AuthConfig {
  mode: 'dev' | 'azure';
  devSecret?: string;
  azureAdAudience?: string;
  azureTenantId?: string;
}

export type AuthVerifier = (bearerToken: string) => Promise<AuthUser>;

export function createAuthVerifier(config: AuthConfig): AuthVerifier {
  if (config.mode === 'dev') return createDevVerifier(config.devSecret || 'dev-secret');
  return createAzureVerifier(config);
}

function createDevVerifier(secret: string): AuthVerifier {
  return async (bearerToken: string): Promise<AuthUser> => {
    const token = bearerToken.replace('Bearer ', '');
    const payload = jwt.verify(token, secret) as jwt.JwtPayload;
    if (!payload.oid) throw new Error('Missing oid claim in JWT');
    return { userId: payload.oid as string, userEmail: (payload.preferred_username ?? payload.upn ?? '') as string };
  };
}

function createAzureVerifier(config: AuthConfig): AuthVerifier {
  const jwksUri = `https://login.microsoftonline.com/${config.azureTenantId}/discovery/v2.0/keys`;
  const client = jwksClient({ jwksUri, cache: true, rateLimit: true });

  function getKey(header: jwt.JwtHeader, callback: jwt.SigningKeyCallback): void {
    client.getSigningKey(header.kid, (err, key) => {
      if (err) return callback(err);
      callback(null, key?.getPublicKey());
    });
  }

  return async (bearerToken: string): Promise<AuthUser> => {
    const token = bearerToken.replace('Bearer ', '');
    const payload = await new Promise<jwt.JwtPayload>((resolve, reject) => {
      jwt.verify(token, getKey, {
        audience: config.azureAdAudience,
        issuer: `https://login.microsoftonline.com/${config.azureTenantId}/v2.0`,
      }, (err, decoded) => { if (err) return reject(err); resolve(decoded as jwt.JwtPayload); });
    });
    if (!payload.oid) throw new Error('Missing oid claim in JWT');
    return { userId: payload.oid as string, userEmail: (payload.preferred_username ?? payload.upn ?? '') as string };
  };
}
