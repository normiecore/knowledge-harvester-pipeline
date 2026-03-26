import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, type Config } from '../../src/config/index.js';

describe('loadConfig', () => {
  const VALID_ENV = {
    AZURE_TENANT_ID: 'tenant-123',
    AZURE_CLIENT_ID: 'client-456',
    AZURE_CLIENT_SECRET: 'secret-789',
    NATS_URL: 'nats://localhost:4222',
    MUNINNDB_URL: 'http://localhost:3030',
    MUNINNDB_API_KEY: 'mk_test',
    LLM_BASE_URL: 'http://localhost:8000/v1',
    LLM_MODEL: 'llama-3.1-8b-nvfp4',
    POLL_INTERVAL_MS: '30000',
    MAX_CONCURRENT_EXTRACTIONS: '8',
  };

  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('loads valid config from env', () => {
    Object.assign(process.env, VALID_ENV);
    const config = loadConfig();
    expect(config.azure.tenantId).toBe('tenant-123');
    expect(config.natsUrl).toBe('nats://localhost:4222');
    expect(config.pollIntervalMs).toBe(30000);
    expect(config.maxConcurrentExtractions).toBe(8);
  });

  it('throws on missing required field', () => {
    Object.assign(process.env, { ...VALID_ENV, AZURE_TENANT_ID: undefined });
    delete process.env.AZURE_TENANT_ID;
    expect(() => loadConfig()).toThrow();
  });

  it('uses defaults for optional numeric fields', () => {
    const env = { ...VALID_ENV } as Record<string, string | undefined>;
    delete env.POLL_INTERVAL_MS;
    delete env.MAX_CONCURRENT_EXTRACTIONS;
    Object.assign(process.env, env);
    delete process.env.POLL_INTERVAL_MS;
    delete process.env.MAX_CONCURRENT_EXTRACTIONS;
    const config = loadConfig();
    expect(config.pollIntervalMs).toBe(30000);
    expect(config.maxConcurrentExtractions).toBe(8);
  });
});
