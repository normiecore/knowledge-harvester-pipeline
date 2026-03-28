import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockInitWithMiddleware } = vi.hoisted(() => ({
  mockInitWithMiddleware: vi.fn().mockReturnValue({ api: vi.fn() }),
}));

vi.mock('@azure/identity', () => {
  return {
    ClientSecretCredential: vi.fn().mockImplementation(
      function (this: Record<string, string>, tenantId: string, clientId: string, clientSecret: string) {
        this.tenantId = tenantId;
        this.clientId = clientId;
        this.clientSecret = clientSecret;
      },
    ),
  };
});

vi.mock('@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js', () => {
  return {
    TokenCredentialAuthenticationProvider: vi.fn().mockImplementation(
      function (this: Record<string, unknown>, credential: unknown, options: unknown) {
        this.credential = credential;
        this.options = options;
      },
    ),
  };
});

vi.mock('@microsoft/microsoft-graph-client', () => ({
  Client: {
    initWithMiddleware: mockInitWithMiddleware,
  },
}));

import { ClientSecretCredential } from '@azure/identity';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js';
import { createGraphClient } from '../../src/ingestion/graph-client.js';

describe('createGraphClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a ClientSecretCredential with the provided tenant, client, and secret', () => {
    createGraphClient({
      tenantId: 'tenant-123',
      clientId: 'client-456',
      clientSecret: 'secret-789',
    });

    expect(ClientSecretCredential).toHaveBeenCalledWith(
      'tenant-123',
      'client-456',
      'secret-789',
    );
  });

  it('creates a TokenCredentialAuthenticationProvider with default scopes', () => {
    createGraphClient({
      tenantId: 'tenant-123',
      clientId: 'client-456',
      clientSecret: 'secret-789',
    });

    expect(TokenCredentialAuthenticationProvider).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 'tenant-123' }),
      { scopes: ['https://graph.microsoft.com/.default'] },
    );
  });

  it('uses custom scopes when provided', () => {
    const customScopes = ['https://graph.microsoft.com/Mail.Read', 'https://graph.microsoft.com/Files.Read'];

    createGraphClient({
      tenantId: 'tenant-123',
      clientId: 'client-456',
      clientSecret: 'secret-789',
      scopes: customScopes,
    });

    expect(TokenCredentialAuthenticationProvider).toHaveBeenCalledWith(
      expect.anything(),
      { scopes: customScopes },
    );
  });

  it('initializes Client with the auth provider middleware', () => {
    createGraphClient({
      tenantId: 'tenant-123',
      clientId: 'client-456',
      clientSecret: 'secret-789',
    });

    expect(mockInitWithMiddleware).toHaveBeenCalledWith({
      authProvider: expect.objectContaining({
        credential: expect.objectContaining({ tenantId: 'tenant-123' }),
      }),
    });
  });

  it('returns the Graph Client instance', () => {
    const client = createGraphClient({
      tenantId: 'tenant-123',
      clientId: 'client-456',
      clientSecret: 'secret-789',
    });

    expect(client).toBeDefined();
    expect(client).toBe(mockInitWithMiddleware.mock.results[0].value);
  });
});
