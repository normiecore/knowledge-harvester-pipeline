import { z } from 'zod';

const ConfigSchema = z.object({
  azure: z.object({
    tenantId: z.string().min(1),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
  }),
  natsUrl: z.string().min(1),
  muninndb: z.object({
    url: z.string().url(),
    apiKey: z.string().min(1),
  }),
  llm: z.object({
    baseUrl: z.string().url(),
    model: z.string().min(1),
  }),
  pollIntervalMs: z.number().int().positive(),
  maxConcurrentExtractions: z.number().int().positive(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(): Config {
  return ConfigSchema.parse({
    azure: {
      tenantId: process.env.AZURE_TENANT_ID,
      clientId: process.env.AZURE_CLIENT_ID,
      clientSecret: process.env.AZURE_CLIENT_SECRET,
    },
    natsUrl: process.env.NATS_URL,
    muninndb: {
      url: process.env.MUNINNDB_URL,
      apiKey: process.env.MUNINNDB_API_KEY,
    },
    llm: {
      baseUrl: process.env.LLM_BASE_URL,
      model: process.env.LLM_MODEL,
    },
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '30000', 10),
    maxConcurrentExtractions: parseInt(
      process.env.MAX_CONCURRENT_EXTRACTIONS || '8',
      10,
    ),
  });
}
