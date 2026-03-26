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
    Object.assign(process.env, { ...VALID_ENV, MUNINNDB_API_KEY: undefined });
    delete process.env.MUNINNDB_API_KEY;
    expect(() => loadConfig()).toThrow();
  });

  it('defaults azure creds to empty string when not set', () => {
    const env = { ...VALID_ENV } as Record<string, string | undefined>;
    delete env.AZURE_TENANT_ID;
    Object.assign(process.env, env);
    delete process.env.AZURE_TENANT_ID;
    const config = loadConfig();
    expect(config.azure.tenantId).toBe('');
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

  it('loads auth config in dev mode', () => {
    Object.assign(process.env, { ...VALID_ENV, AUTH_MODE: 'dev', JWT_DEV_SECRET: 'test-secret' });
    const config = loadConfig();
    expect(config.auth.mode).toBe('dev');
    expect(config.auth.devSecret).toBe('test-secret');
  });

  it('loads auth config in azure mode', () => {
    Object.assign(process.env, { ...VALID_ENV, AUTH_MODE: 'azure', AZURE_AD_AUDIENCE: 'api://my-app' });
    const config = loadConfig();
    expect(config.auth.mode).toBe('azure');
    expect(config.auth.azureAdAudience).toBe('api://my-app');
  });

  it('defaults to dev mode when AUTH_MODE not set', () => {
    Object.assign(process.env, VALID_ENV);
    delete process.env.AUTH_MODE;
    const config = loadConfig();
    expect(config.auth.mode).toBe('dev');
  });
});
