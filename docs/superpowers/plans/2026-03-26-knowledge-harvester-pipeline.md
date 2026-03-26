# Knowledge Harvester Pipeline Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the GB10 server-side pipeline that ingests M365 data via Graph API, extracts knowledge with a local LLM, applies sensitivity filtering, and stores layered engrams in MuninnDB.

**Architecture:** TypeScript pipeline consuming Microsoft Graph delta queries, publishing to NATS, processing through rules-based sensitivity filter + LLM extraction, and writing three-fidelity-layer engrams to MuninnDB. Fastify REST API + WebSocket for desktop client consumption.

**Tech Stack:** TypeScript, NATS, Fastify, Microsoft Graph SDK, MuninnDB, better-sqlite3, OpenAI-compatible LLM API (SGLang)

**Spec:** `docs/superpowers/specs/2026-03-26-knowledge-harvester-pipeline-design.md`

---

## File Map

```
knowledge-harvester-pipeline/
├── src/
│   ├── types.ts                       # Shared types: RawCapture, HarvesterEngram, LLM response
│   ├── config/
│   │   ├── index.ts                   # Env config loader + validation
│   │   └── sensitivity-rules.ts       # Source exclusions, regex patterns
│   ├── queue/
│   │   ├── nats-client.ts             # NATS connect/disconnect, publish/subscribe helpers
│   │   └── topics.ts                  # Topic string constants
│   ├── ingestion/
│   │   ├── graph-client.ts            # Azure AD auth + Graph client factory
│   │   ├── graph-poller.ts            # Delta polling loop for all sources
│   │   ├── graph-types.ts             # Graph API response types
│   │   └── delta-store.ts             # SQLite delta link persistence
│   ├── pipeline/
│   │   ├── sensitivity-filter.ts      # 3-layer rules-based pre-filter
│   │   ├── extractor.ts               # LLM extraction + CoT sensitivity (OpenAI client)
│   │   ├── engram-builder.ts          # Combine LLM output + metadata into engram
│   │   ├── deduplicator.ts            # Content-hash dedup via SQLite
│   │   ├── fidelity-reducer.ts        # Generate dept + org layer variants (LLM call)
│   │   └── processor.ts              # Orchestrates stages 1-5, NATS consumer
│   ├── storage/
│   │   ├── muninndb-client.ts         # MuninnDB HTTP API wrapper
│   │   ├── vault-manager.ts           # Multi-vault write (personal/dept/org)
│   │   └── engram-index.ts            # SQLite engram index for structured queries
│   ├── api/
│   │   ├── server.ts                  # Fastify setup, plugins, auth middleware
│   │   ├── auth.ts                    # Azure AD Bearer token validation
│   │   ├── routes/
│   │   │   ├── engrams.ts             # GET/PATCH engrams
│   │   │   └── stats.ts               # GET stats
│   │   └── ws.ts                      # WebSocket handler for real-time notifications
│   └── main.ts                        # Entry point: start pipeline + API
├── prompts/
│   ├── extraction.txt                 # LLM extraction + sensitivity prompt
│   └── fidelity-reduction.txt         # Dept/org summarisation prompt
├── tests/
│   ├── config/
│   │   └── sensitivity-rules.test.ts
│   ├── queue/
│   │   └── nats-client.test.ts
│   ├── ingestion/
│   │   ├── graph-poller.test.ts
│   │   └── delta-store.test.ts
│   ├── pipeline/
│   │   ├── sensitivity-filter.test.ts
│   │   ├── extractor.test.ts
│   │   ├── engram-builder.test.ts
│   │   ├── deduplicator.test.ts
│   │   ├── fidelity-reducer.test.ts
│   │   └── processor.test.ts
│   ├── storage/
│   │   ├── muninndb-client.test.ts
│   │   ├── vault-manager.test.ts
│   │   └── engram-index.test.ts
│   └── api/
│       ├── engrams.test.ts
│       ├── stats.test.ts
│       └── ws.test.ts
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── .env.example
└── .gitignore
```

---

## Chunk 1: Project Scaffold + Shared Types + Config

### Task 1: Initialize project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `vitest.config.ts`
- Create: `.env.example`
- Create: `.gitignore`

- [ ] **Step 1: Initialize npm project**

Run: `cd ~/knowledge-harvester-pipeline && npm init -y`

- [ ] **Step 2: Install dependencies**

Run:
```bash
npm install typescript @types/node vitest --save-dev
npm install @microsoft/microsoft-graph-client @azure/identity nats fastify @fastify/websocket better-sqlite3 openai dotenv zod
npm install @types/better-sqlite3 --save-dev
```

- [ ] **Step 3: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "dist",
    "rootDir": ".",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 4: Create vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: '.',
    include: ['tests/**/*.test.ts'],
  },
});
```

- [ ] **Step 5: Create .env.example**

```
AZURE_TENANT_ID=
AZURE_CLIENT_ID=
AZURE_CLIENT_SECRET=
NATS_URL=nats://localhost:4222
MUNINNDB_URL=http://localhost:3030
MUNINNDB_API_KEY=
LLM_BASE_URL=http://localhost:8000/v1
LLM_MODEL=llama-3.1-8b-nvfp4
POLL_INTERVAL_MS=30000
MAX_CONCURRENT_EXTRACTIONS=8
```

- [ ] **Step 6: Create .gitignore**

```
node_modules/
dist/
.env
*.db
```

- [ ] **Step 7: Add scripts to package.json**

Add to `package.json`:
```json
{
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/src/main.js",
    "dev": "npx tsx src/main.ts",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

- [ ] **Step 8: Commit**

```bash
git add package.json tsconfig.json vitest.config.ts .env.example .gitignore package-lock.json
git commit -m "chore: initialize TypeScript project with vitest"
```

---

### Task 2: Shared types

**Files:**
- Create: `src/types.ts`
- Test: `tests/types.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/types.test.ts
import { describe, it, expect } from 'vitest';
import {
  RawCaptureSchema,
  ExtractionResultSchema,
  type RawCapture,
  type HarvesterEngram,
  type ExtractionResult,
  type SourceType,
  type ApprovalStatus,
  type SensitivityClassification,
} from '../src/types.js';

describe('RawCaptureSchema', () => {
  it('validates a well-formed raw capture', () => {
    const capture: RawCapture = {
      id: 'cap-001',
      userId: 'user-abc',
      userEmail: 'james@example.com',
      sourceType: 'graph_email',
      sourceApp: 'Outlook',
      capturedAt: '2026-03-26T10:00:00Z',
      rawContent: 'Meeting notes about pipe stress...',
      metadata: { threadId: 'thread-1', from: 'alice@example.com' },
    };
    expect(RawCaptureSchema.parse(capture)).toEqual(capture);
  });

  it('rejects missing required fields', () => {
    expect(() => RawCaptureSchema.parse({ id: 'cap-001' })).toThrow();
  });

  it('rejects invalid sourceType', () => {
    expect(() =>
      RawCaptureSchema.parse({
        id: 'cap-001',
        userId: 'user-abc',
        userEmail: 'j@e.com',
        sourceType: 'invalid_source',
        sourceApp: 'X',
        capturedAt: '2026-03-26T10:00:00Z',
        rawContent: 'text',
        metadata: {},
      })
    ).toThrow();
  });
});

describe('ExtractionResultSchema', () => {
  it('validates a well-formed extraction result', () => {
    const result: ExtractionResult = {
      summary: 'Pipe stress calculation method for 6-inch subsea risers',
      tags: ['pipe-stress', 'subsea', 'engineering'],
      confidence: 0.85,
      sensitivity: {
        classification: 'safe',
        reasoning: 'Technical engineering content, no personal data',
      },
    };
    expect(ExtractionResultSchema.parse(result)).toEqual(result);
  });

  it('rejects confidence outside 0-1 range', () => {
    expect(() =>
      ExtractionResultSchema.parse({
        summary: 'test',
        tags: [],
        confidence: 1.5,
        sensitivity: { classification: 'safe', reasoning: 'ok' },
      })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/types.test.ts`
Expected: FAIL — cannot find module `../src/types.js`

- [ ] **Step 3: Write the implementation**

```typescript
// src/types.ts
import { z } from 'zod';

// --- Source types ---

export const SOURCE_TYPES = [
  'graph_email',
  'graph_teams',
  'graph_calendar',
  'graph_document',
  'graph_task',
] as const;

export type SourceType = (typeof SOURCE_TYPES)[number];

// --- Approval ---

export const APPROVAL_STATUSES = ['pending', 'approved', 'dismissed'] as const;
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number];

// --- Sensitivity ---

export const SENSITIVITY_CLASSIFICATIONS = ['safe', 'review', 'block'] as const;
export type SensitivityClassification = (typeof SENSITIVITY_CLASSIFICATIONS)[number];

// --- Raw Capture (ingestion → NATS) ---

export const RawCaptureSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userEmail: z.string(),
  sourceType: z.enum(SOURCE_TYPES),
  sourceApp: z.string(),
  capturedAt: z.string(),
  rawContent: z.string(),
  metadata: z.record(z.unknown()),
});

export type RawCapture = z.infer<typeof RawCaptureSchema>;

// --- LLM Extraction Result ---

export const ExtractionResultSchema = z.object({
  summary: z.string(),
  tags: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  sensitivity: z.object({
    classification: z.enum(SENSITIVITY_CLASSIFICATIONS),
    reasoning: z.string(),
  }),
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;

// --- Harvester Engram (stored in MuninnDB) ---

export interface HarvesterEngram {
  concept: string;
  content: string;
  source_type: SourceType;
  source_app: string;
  user_id: string;
  user_email: string;
  captured_at: string;
  approved_at: string | null;
  approved_by: string | null;
  approval_status: ApprovalStatus;
  confidence: number;
  sensitivity_classification: SensitivityClassification;
  tags: string[];
  raw_text: string;
}

// --- Department Engram (reduced fidelity) ---

export interface DepartmentEngram {
  concept: string;
  content: string;
  source_app: string;
  user_id: string;
  user_email: string;
  tags: string[];
}

// --- Org Engram (minimal fidelity) ---

export interface OrgEngram {
  concept: string;
  tags: string[];
  department: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/types.test.ts`
Expected: PASS — all 5 tests pass

- [ ] **Step 5: Commit**

```bash
git add src/types.ts tests/types.test.ts
git commit -m "feat: add shared types with Zod validation schemas"
```

---

### Task 3: Config loader

**Files:**
- Create: `src/config/index.ts`
- Test: `tests/config/index.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/config/index.test.ts
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
    const env = { ...VALID_ENV };
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config/index.test.ts`
Expected: FAIL — cannot find module

- [ ] **Step 3: Write the implementation**

```typescript
// src/config/index.ts
import { z } from 'zod';

const ConfigSchema = z.object({
  azure: z.object({
    tenantId: z.string().min(1),
    clientId: z.string().min(1),
    clientSecret: z.string().min(1),
  }),
  natsUrl: z.string().url(),
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
    maxConcurrentExtractions: parseInt(process.env.MAX_CONCURRENT_EXTRACTIONS || '8', 10),
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config/index.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/index.ts tests/config/index.test.ts
git commit -m "feat: add config loader with Zod validation"
```

---

### Task 4: Sensitivity rules config

**Files:**
- Create: `src/config/sensitivity-rules.ts`
- Test: `tests/config/sensitivity-rules.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/config/sensitivity-rules.test.ts
import { describe, it, expect } from 'vitest';
import {
  EXCLUDED_SOURCES,
  TITLE_BLOCK_PATTERNS,
  CONTENT_BLOCK_PATTERNS,
  isSourceExcluded,
  matchesTitlePattern,
  matchesContentPattern,
} from '../../src/config/sensitivity-rules.js';

describe('isSourceExcluded', () => {
  it('blocks known sensitive sources', () => {
    expect(isSourceExcluded('https://hr.company.com/salary')).toBe(true);
    expect(isSourceExcluded('https://banking.example.com')).toBe(true);
  });

  it('allows normal sources', () => {
    expect(isSourceExcluded('https://teams.microsoft.com/channel')).toBe(false);
    expect(isSourceExcluded('SolidWorks')).toBe(false);
  });
});

describe('matchesTitlePattern', () => {
  it('blocks salary-related titles', () => {
    expect(matchesTitlePattern('Your Salary Review 2026')).toBe(true);
    expect(matchesTitlePattern('Performance Review - Confidential')).toBe(true);
  });

  it('allows normal titles', () => {
    expect(matchesTitlePattern('Pipe Stress Analysis Report')).toBe(false);
  });
});

describe('matchesContentPattern', () => {
  it('blocks personal content', () => {
    expect(matchesContentPattern('I filed for divorce last week')).toBe(true);
    expect(matchesContentPattern('My medical results came back')).toBe(true);
  });

  it('allows technical content', () => {
    expect(matchesContentPattern('The riser stress test passed at 450 bar')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/config/sensitivity-rules.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// src/config/sensitivity-rules.ts

// Layer 1: Source exclusion — domains and app names that are always blocked
export const EXCLUDED_SOURCES: string[] = [
  'hr.company.com',
  'banking',
  'payroll',
  'myhr',
  'workday.com',
  'adp.com',
  'healthportal',
  'medical',
  'benefits.company.com',
];

// Layer 2: Title/subject regex patterns
export const TITLE_BLOCK_PATTERNS: RegExp[] = [
  /salary/i,
  /performance\s+review/i,
  /disciplinary/i,
  /termination/i,
  /redundancy/i,
  /grievance/i,
  /confidential\s*[-–:]/i,
  /personal\s*[-–:]/i,
  /private\s*[-–:]/i,
  /medical\s+leave/i,
  /sick\s+leave/i,
];

// Layer 3: Content regex patterns
export const CONTENT_BLOCK_PATTERNS: RegExp[] = [
  /divorce/i,
  /medical\s+results?/i,
  /pregnancy\s+test/i,
  /mental\s+health/i,
  /therapy\s+session/i,
  /bank\s+account\s+number/i,
  /social\s+security/i,
  /national\s+insurance\s+number/i,
  /passport\s+number/i,
  /credit\s+card\s+\d{4}/i,
];

export function isSourceExcluded(source: string): boolean {
  const lower = source.toLowerCase();
  return EXCLUDED_SOURCES.some((excluded) => lower.includes(excluded));
}

export function matchesTitlePattern(title: string): boolean {
  return TITLE_BLOCK_PATTERNS.some((pattern) => pattern.test(title));
}

export function matchesContentPattern(content: string): boolean {
  return CONTENT_BLOCK_PATTERNS.some((pattern) => pattern.test(content));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/config/sensitivity-rules.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/config/sensitivity-rules.ts tests/config/sensitivity-rules.test.ts
git commit -m "feat: add sensitivity rules with source, title, and content patterns"
```

---

### Task 5: NATS client + topics

**Files:**
- Create: `src/queue/topics.ts`
- Create: `src/queue/nats-client.ts`
- Test: `tests/queue/nats-client.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/queue/nats-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TOPICS, topicForUser } from '../../src/queue/topics.js';

describe('TOPICS', () => {
  it('has all expected topic constants', () => {
    expect(TOPICS.RAW_CAPTURES).toBe('raw.captures');
    expect(TOPICS.DEAD_LETTER).toBe('pipeline.deadletter');
    expect(TOPICS.ENGRAMS_APPROVED).toBe('engrams.approved');
  });
});

describe('topicForUser', () => {
  it('builds user-specific pending topic', () => {
    expect(topicForUser('user-abc')).toBe('engrams.pending.user-abc');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/queue/nats-client.test.ts`
Expected: FAIL

- [ ] **Step 3: Write topics.ts**

```typescript
// src/queue/topics.ts
export const TOPICS = {
  RAW_CAPTURES: 'raw.captures',
  DEAD_LETTER: 'pipeline.deadletter',
  ENGRAMS_APPROVED: 'engrams.approved',
} as const;

export function topicForUser(userId: string): string {
  return `engrams.pending.${userId}`;
}
```

- [ ] **Step 4: Write nats-client.ts**

```typescript
// src/queue/nats-client.ts
import { connect, NatsConnection, Subscription, StringCodec } from 'nats';

const sc = StringCodec();

export class NatsClient {
  private connection: NatsConnection | null = null;

  async connect(url: string): Promise<void> {
    this.connection = await connect({ servers: url });
  }

  async disconnect(): Promise<void> {
    if (this.connection) {
      await this.connection.drain();
      this.connection = null;
    }
  }

  publish(topic: string, data: unknown): void {
    if (!this.connection) throw new Error('NATS not connected');
    this.connection.publish(topic, sc.encode(JSON.stringify(data)));
  }

  subscribe(topic: string, handler: (data: unknown) => Promise<void>): Subscription {
    if (!this.connection) throw new Error('NATS not connected');
    const sub = this.connection.subscribe(topic);
    (async () => {
      for await (const msg of sub) {
        try {
          const parsed = JSON.parse(sc.decode(msg.data));
          await handler(parsed);
        } catch (err) {
          console.error(`Error processing message on ${topic}:`, err);
        }
      }
    })();
    return sub;
  }

  get isConnected(): boolean {
    return this.connection !== null;
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/queue/nats-client.test.ts`
Expected: PASS (topics test passes; nats-client is integration-tested later)

- [ ] **Step 6: Commit**

```bash
git add src/queue/topics.ts src/queue/nats-client.ts tests/queue/nats-client.test.ts
git commit -m "feat: add NATS client wrapper and topic constants"
```

---

## Chunk 2: Graph API Ingestion

### Task 6: Delta store (SQLite persistence for delta links)

**Files:**
- Create: `src/ingestion/delta-store.ts`
- Test: `tests/ingestion/delta-store.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/ingestion/delta-store.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DeltaStore } from '../../src/ingestion/delta-store.js';
import { unlinkSync } from 'fs';

const TEST_DB = 'test-delta.db';

describe('DeltaStore', () => {
  let store: DeltaStore;

  beforeEach(() => {
    store = new DeltaStore(TEST_DB);
  });

  afterEach(() => {
    store.close();
    try { unlinkSync(TEST_DB); } catch {}
  });

  it('returns null for unknown delta link', () => {
    expect(store.getDeltaLink('user-1', 'mail')).toBeNull();
  });

  it('stores and retrieves a delta link', () => {
    store.setDeltaLink('user-1', 'mail', 'https://graph.microsoft.com/delta?token=abc');
    expect(store.getDeltaLink('user-1', 'mail')).toBe('https://graph.microsoft.com/delta?token=abc');
  });

  it('overwrites existing delta link', () => {
    store.setDeltaLink('user-1', 'mail', 'token-1');
    store.setDeltaLink('user-1', 'mail', 'token-2');
    expect(store.getDeltaLink('user-1', 'mail')).toBe('token-2');
  });

  it('isolates delta links per user and source', () => {
    store.setDeltaLink('user-1', 'mail', 'link-a');
    store.setDeltaLink('user-1', 'teams', 'link-b');
    store.setDeltaLink('user-2', 'mail', 'link-c');
    expect(store.getDeltaLink('user-1', 'mail')).toBe('link-a');
    expect(store.getDeltaLink('user-1', 'teams')).toBe('link-b');
    expect(store.getDeltaLink('user-2', 'mail')).toBe('link-c');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ingestion/delta-store.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// src/ingestion/delta-store.ts
import Database from 'better-sqlite3';

export class DeltaStore {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS delta_links (
        user_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        delta_link TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, source_type)
      )
    `);
  }

  getDeltaLink(userId: string, sourceType: string): string | null {
    const row = this.db
      .prepare('SELECT delta_link FROM delta_links WHERE user_id = ? AND source_type = ?')
      .get(userId, sourceType) as { delta_link: string } | undefined;
    return row?.delta_link ?? null;
  }

  setDeltaLink(userId: string, sourceType: string, deltaLink: string): void {
    this.db
      .prepare(
        `INSERT INTO delta_links (user_id, source_type, delta_link, updated_at)
         VALUES (?, ?, ?, datetime('now'))
         ON CONFLICT (user_id, source_type)
         DO UPDATE SET delta_link = excluded.delta_link, updated_at = datetime('now')`
      )
      .run(userId, sourceType, deltaLink);
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ingestion/delta-store.test.ts`
Expected: PASS — all 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/ingestion/delta-store.ts tests/ingestion/delta-store.test.ts
git commit -m "feat: add SQLite delta link store for Graph API polling"
```

---

### Task 7: Graph client factory

**Files:**
- Create: `src/ingestion/graph-client.ts`
- Create: `src/ingestion/graph-types.ts`

- [ ] **Step 1: Write graph-types.ts**

```typescript
// src/ingestion/graph-types.ts

export interface GraphUser {
  id: string;
  displayName: string;
  mail: string;
  department: string | null;
}

export interface GraphDeltaResponse<T> {
  value: T[];
  '@odata.nextLink'?: string;
  '@odata.deltaLink'?: string;
}

export interface GraphMessage {
  id: string;
  subject: string;
  bodyPreview: string;
  body: { contentType: string; content: string };
  from: { emailAddress: { name: string; address: string } };
  toRecipients: { emailAddress: { name: string; address: string } }[];
  receivedDateTime: string;
  conversationId: string;
}

export interface GraphChatMessage {
  id: string;
  body: { contentType: string; content: string };
  from: { user: { displayName: string; id: string } } | null;
  createdDateTime: string;
  channelIdentity?: { teamId: string; channelId: string };
  chatId?: string;
}
```

- [ ] **Step 2: Write graph-client.ts**

```typescript
// src/ingestion/graph-client.ts
import { ClientSecretCredential } from '@azure/identity';
import { Client } from '@microsoft/microsoft-graph-client';
import { TokenCredentialAuthenticationProvider } from '@microsoft/microsoft-graph-client/authProviders/azureTokenCredentials/index.js';
import type { Config } from '../config/index.js';

export function createGraphClient(config: Config): Client {
  const credential = new ClientSecretCredential(
    config.azure.tenantId,
    config.azure.clientId,
    config.azure.clientSecret
  );

  const authProvider = new TokenCredentialAuthenticationProvider(credential, {
    scopes: ['https://graph.microsoft.com/.default'],
  });

  return Client.initWithMiddleware({ authProvider });
}
```

- [ ] **Step 3: Commit**

```bash
git add src/ingestion/graph-client.ts src/ingestion/graph-types.ts
git commit -m "feat: add Graph API client factory and response types"
```

---

### Task 8: Graph poller

**Files:**
- Create: `src/ingestion/graph-poller.ts`
- Test: `tests/ingestion/graph-poller.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/ingestion/graph-poller.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GraphPoller } from '../../src/ingestion/graph-poller.js';
import type { RawCapture } from '../../src/types.js';

describe('GraphPoller', () => {
  let mockGraphClient: any;
  let mockDeltaStore: any;
  let mockPublish: ReturnType<typeof vi.fn>;
  let poller: GraphPoller;
  let published: RawCapture[];

  beforeEach(() => {
    published = [];
    mockPublish = vi.fn((capture: RawCapture) => { published.push(capture); });

    mockDeltaStore = {
      getDeltaLink: vi.fn().mockReturnValue(null),
      setDeltaLink: vi.fn(),
    };

    mockGraphClient = {
      api: vi.fn().mockReturnValue({
        get: vi.fn().mockResolvedValue({
          value: [
            {
              id: 'msg-1',
              subject: 'Pipe stress report',
              bodyPreview: 'Analysis complete...',
              body: { contentType: 'text', content: 'Analysis complete for riser section 4.' },
              from: { emailAddress: { name: 'Alice', address: 'alice@example.com' } },
              toRecipients: [{ emailAddress: { name: 'Bob', address: 'bob@example.com' } }],
              receivedDateTime: '2026-03-26T09:00:00Z',
              conversationId: 'conv-1',
            },
          ],
          '@odata.deltaLink': 'https://graph.microsoft.com/delta?token=new-token',
        }),
      }),
    };

    poller = new GraphPoller(mockGraphClient, mockDeltaStore, mockPublish);
  });

  it('polls mail and publishes a RawCapture', async () => {
    await poller.pollMail('user-1', 'alice@example.com');

    expect(published).toHaveLength(1);
    expect(published[0].sourceType).toBe('graph_email');
    expect(published[0].userId).toBe('user-1');
    expect(published[0].rawContent).toContain('Pipe stress report');
  });

  it('saves delta link after polling', async () => {
    await poller.pollMail('user-1', 'alice@example.com');

    expect(mockDeltaStore.setDeltaLink).toHaveBeenCalledWith(
      'user-1',
      'mail',
      'https://graph.microsoft.com/delta?token=new-token'
    );
  });

  it('uses existing delta link when available', async () => {
    mockDeltaStore.getDeltaLink.mockReturnValue('https://graph.microsoft.com/delta?token=old');
    await poller.pollMail('user-1', 'alice@example.com');

    expect(mockGraphClient.api).toHaveBeenCalledWith(
      'https://graph.microsoft.com/delta?token=old'
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/ingestion/graph-poller.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// src/ingestion/graph-poller.ts
import { Client } from '@microsoft/microsoft-graph-client';
import type { DeltaStore } from './delta-store.js';
import type { GraphDeltaResponse, GraphMessage, GraphChatMessage } from './graph-types.js';
import type { RawCapture } from '../types.js';
import { randomUUID } from 'crypto';

export class GraphPoller {
  constructor(
    private graphClient: Client,
    private deltaStore: DeltaStore,
    private publish: (capture: RawCapture) => void
  ) {}

  async pollMail(userId: string, userEmail: string): Promise<void> {
    const deltaLink = this.deltaStore.getDeltaLink(userId, 'mail');
    const url = deltaLink || `/users/${userId}/mailFolders/inbox/messages/delta`;

    const response: GraphDeltaResponse<GraphMessage> = await this.graphClient
      .api(url)
      .get();

    for (const msg of response.value) {
      const capture: RawCapture = {
        id: randomUUID(),
        userId,
        userEmail,
        sourceType: 'graph_email',
        sourceApp: 'Outlook',
        capturedAt: msg.receivedDateTime || new Date().toISOString(),
        rawContent: JSON.stringify({
          subject: msg.subject,
          body: msg.body?.content ?? msg.bodyPreview,
          from: msg.from?.emailAddress,
          to: msg.toRecipients?.map((r) => r.emailAddress),
          conversationId: msg.conversationId,
        }),
        metadata: {
          messageId: msg.id,
          conversationId: msg.conversationId,
          from: msg.from?.emailAddress?.address,
        },
      };
      this.publish(capture);
    }

    if (response['@odata.deltaLink']) {
      this.deltaStore.setDeltaLink(userId, 'mail', response['@odata.deltaLink']);
    }
  }

  async pollTeamsChat(userId: string, userEmail: string): Promise<void> {
    const deltaLink = this.deltaStore.getDeltaLink(userId, 'teams');
    const url = deltaLink || `/users/${userId}/chats/getAllMessages`;

    const response: GraphDeltaResponse<GraphChatMessage> = await this.graphClient
      .api(url)
      .get();

    for (const msg of response.value) {
      const capture: RawCapture = {
        id: randomUUID(),
        userId,
        userEmail,
        sourceType: 'graph_teams',
        sourceApp: 'Teams',
        capturedAt: msg.createdDateTime || new Date().toISOString(),
        rawContent: JSON.stringify({
          body: msg.body?.content,
          from: msg.from?.user?.displayName,
          chatId: msg.chatId,
          channelId: msg.channelIdentity?.channelId,
          teamId: msg.channelIdentity?.teamId,
        }),
        metadata: {
          messageId: msg.id,
          chatId: msg.chatId,
          fromUser: msg.from?.user?.displayName,
        },
      };
      this.publish(capture);
    }

    if (response['@odata.deltaLink']) {
      this.deltaStore.setDeltaLink(userId, 'teams', response['@odata.deltaLink']);
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/ingestion/graph-poller.test.ts`
Expected: PASS — all 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/ingestion/graph-poller.ts tests/ingestion/graph-poller.test.ts
git commit -m "feat: add Graph API delta poller for mail and Teams"
```

---

## Chunk 3: Processing Pipeline

### Task 9: Sensitivity pre-filter

**Files:**
- Create: `src/pipeline/sensitivity-filter.ts`
- Test: `tests/pipeline/sensitivity-filter.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/pipeline/sensitivity-filter.test.ts
import { describe, it, expect } from 'vitest';
import { sensitivityPreFilter, type FilterResult } from '../../src/pipeline/sensitivity-filter.js';
import type { RawCapture } from '../../src/types.js';

function makeCapture(overrides: Partial<RawCapture> = {}): RawCapture {
  return {
    id: 'cap-1',
    userId: 'user-1',
    userEmail: 'test@example.com',
    sourceType: 'graph_email',
    sourceApp: 'Outlook',
    capturedAt: '2026-03-26T10:00:00Z',
    rawContent: JSON.stringify({ subject: 'Technical report', body: 'Pipe analysis results' }),
    metadata: { from: 'alice@example.com' },
    ...overrides,
  };
}

describe('sensitivityPreFilter', () => {
  it('passes safe technical content', () => {
    const result = sensitivityPreFilter(makeCapture());
    expect(result.action).toBe('pass');
  });

  it('blocks excluded source domains', () => {
    const result = sensitivityPreFilter(
      makeCapture({ metadata: { from: 'hr@hr.company.com' } })
    );
    expect(result.action).toBe('block');
    expect(result.reason).toContain('source');
  });

  it('blocks salary-related subjects', () => {
    const result = sensitivityPreFilter(
      makeCapture({
        rawContent: JSON.stringify({ subject: 'Your Salary Review 2026', body: 'Details...' }),
      })
    );
    expect(result.action).toBe('block');
    expect(result.reason).toContain('title');
  });

  it('blocks personal content in body', () => {
    const result = sensitivityPreFilter(
      makeCapture({
        rawContent: JSON.stringify({ subject: 'Update', body: 'I filed for divorce last week' }),
      })
    );
    expect(result.action).toBe('block');
    expect(result.reason).toContain('content');
  });

  it('blocks sensitive sourceApp names', () => {
    const result = sensitivityPreFilter(
      makeCapture({ sourceApp: 'banking.example.com' })
    );
    expect(result.action).toBe('block');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline/sensitivity-filter.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// src/pipeline/sensitivity-filter.ts
import {
  isSourceExcluded,
  matchesTitlePattern,
  matchesContentPattern,
} from '../config/sensitivity-rules.js';
import type { RawCapture } from '../types.js';

export interface FilterResult {
  action: 'pass' | 'block';
  reason?: string;
  layer?: number;
}

export function sensitivityPreFilter(capture: RawCapture): FilterResult {
  // Layer 1: Source exclusion
  if (isSourceExcluded(capture.sourceApp)) {
    return { action: 'block', reason: 'source exclusion: app', layer: 1 };
  }

  const fromAddr = (capture.metadata?.from as string) ?? '';
  if (isSourceExcluded(fromAddr)) {
    return { action: 'block', reason: 'source exclusion: sender', layer: 1 };
  }

  // Parse rawContent for subject/body if JSON
  let subject = '';
  let body = '';
  try {
    const parsed = JSON.parse(capture.rawContent);
    subject = parsed.subject ?? '';
    body = parsed.body ?? '';
  } catch {
    body = capture.rawContent;
  }

  // Layer 2: Title/subject regex
  if (matchesTitlePattern(subject)) {
    return { action: 'block', reason: 'title pattern match', layer: 2 };
  }

  // Layer 3: Content regex
  if (matchesContentPattern(body)) {
    return { action: 'block', reason: 'content pattern match', layer: 3 };
  }

  return { action: 'pass' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/pipeline/sensitivity-filter.test.ts`
Expected: PASS — all 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/sensitivity-filter.ts tests/pipeline/sensitivity-filter.test.ts
git commit -m "feat: add 3-layer rules-based sensitivity pre-filter"
```

---

### Task 10: LLM extractor

**Files:**
- Create: `src/pipeline/extractor.ts`
- Create: `prompts/extraction.txt`
- Test: `tests/pipeline/extractor.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/pipeline/extractor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Extractor } from '../../src/pipeline/extractor.js';
import type { RawCapture, ExtractionResult } from '../../src/types.js';

const MOCK_LLM_RESPONSE: ExtractionResult = {
  summary: 'Pipe stress calculation method for 6-inch subsea risers using FEA',
  tags: ['pipe-stress', 'subsea', 'FEA', 'riser'],
  confidence: 0.88,
  sensitivity: {
    classification: 'safe',
    reasoning: 'Technical engineering content about structural analysis. No personal or sensitive data.',
  },
};

describe('Extractor', () => {
  let extractor: Extractor;
  let mockCreate: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: JSON.stringify(MOCK_LLM_RESPONSE) } }],
    });

    const mockOpenAI = {
      chat: { completions: { create: mockCreate } },
    } as any;

    extractor = new Extractor(mockOpenAI, 'llama-3.1-8b-nvfp4');
  });

  it('extracts knowledge from raw capture', async () => {
    const capture: RawCapture = {
      id: 'cap-1',
      userId: 'user-1',
      userEmail: 'james@example.com',
      sourceType: 'graph_email',
      sourceApp: 'Outlook',
      capturedAt: '2026-03-26T10:00:00Z',
      rawContent: JSON.stringify({ subject: 'Pipe stress report', body: 'FEA analysis of 6-inch riser...' }),
      metadata: {},
    };

    const result = await extractor.extract(capture);
    expect(result.summary).toContain('Pipe stress');
    expect(result.tags).toContain('subsea');
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.sensitivity.classification).toBe('safe');
  });

  it('sends capture content to LLM', async () => {
    const capture: RawCapture = {
      id: 'cap-1',
      userId: 'user-1',
      userEmail: 'j@e.com',
      sourceType: 'graph_email',
      sourceApp: 'Outlook',
      capturedAt: '2026-03-26T10:00:00Z',
      rawContent: 'some content',
      metadata: {},
    };

    await extractor.extract(capture);

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe('llama-3.1-8b-nvfp4');
    expect(callArgs.messages[1].content).toContain('some content');
  });

  it('throws on invalid LLM JSON response', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'not json' } }],
    });

    const capture: RawCapture = {
      id: 'cap-1', userId: 'u', userEmail: 'e', sourceType: 'graph_email',
      sourceApp: 'Outlook', capturedAt: '', rawContent: 'x', metadata: {},
    };

    await expect(extractor.extract(capture)).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline/extractor.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the extraction prompt**

```text
# prompts/extraction.txt
You are a knowledge extraction system for a subsea engineering company. Your job is to extract useful organisational knowledge from captured content and assess its sensitivity.

## Input
You will receive content captured from a user's M365 applications (email, Teams, calendar, documents). The content includes source metadata.

## Output
Respond with ONLY a JSON object (no markdown, no explanation):

{
  "summary": "A concise 1-3 sentence summary of the knowledge contained. Focus on what someone else in the organisation would find useful — procedures, decisions, contacts, technical methods, lessons learned.",
  "tags": ["lowercase-hyphenated-topic-tags", "max-5-tags"],
  "confidence": 0.0 to 1.0 (how confident you are this contains genuinely useful organisational knowledge vs noise),
  "sensitivity": {
    "classification": "safe | review | block",
    "reasoning": "Step-by-step reasoning about whether this content contains personal, financial, medical, HR, or otherwise sensitive information that should NOT be stored in a shared knowledge base. Think carefully through each category before deciding."
  }
}

## Classification Guide
- **safe**: Technical knowledge, procedures, project updates, vendor contacts, engineering methods
- **review**: Mixed content that might contain personal info alongside useful knowledge — flag for human review
- **block**: Personal conversations, salary/HR topics, medical info, financial details, anything that would violate employee privacy

## Important
- When in doubt, classify as "review" not "safe"
- Confidence below 0.3 means the content is likely noise (meeting accepted notifications, auto-replies, etc.)
- Focus extraction on knowledge that transfers — what would help a new engineer or a colleague in another department?
```

- [ ] **Step 4: Write the implementation**

```typescript
// src/pipeline/extractor.ts
import OpenAI from 'openai';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { ExtractionResultSchema, type ExtractionResult, type RawCapture } from '../types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(resolve(__dirname, '../../prompts/extraction.txt'), 'utf-8');

export class Extractor {
  constructor(
    private llm: OpenAI,
    private model: string
  ) {}

  async extract(capture: RawCapture): Promise<ExtractionResult> {
    const userMessage = `Source: ${capture.sourceApp} (${capture.sourceType})
User: ${capture.userEmail}
Captured: ${capture.capturedAt}

Content:
${capture.rawContent}`;

    const response = await this.llm.chat.completions.create({
      model: this.model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.1,
      max_tokens: 512,
    });

    const content = response.choices[0]?.message?.content;
    if (!content) throw new Error('Empty LLM response');

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      throw new Error(`Invalid JSON from LLM: ${content.slice(0, 200)}`);
    }

    return ExtractionResultSchema.parse(parsed);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/pipeline/extractor.test.ts`
Expected: PASS — all 3 tests

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/extractor.ts prompts/extraction.txt tests/pipeline/extractor.test.ts
git commit -m "feat: add LLM extractor with extraction prompt and Zod validation"
```

---

### Task 11: Engram builder

**Files:**
- Create: `src/pipeline/engram-builder.ts`
- Test: `tests/pipeline/engram-builder.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/pipeline/engram-builder.test.ts
import { describe, it, expect } from 'vitest';
import { buildEngram } from '../../src/pipeline/engram-builder.js';
import type { RawCapture, ExtractionResult, HarvesterEngram } from '../../src/types.js';

describe('buildEngram', () => {
  const capture: RawCapture = {
    id: 'cap-1',
    userId: 'user-abc',
    userEmail: 'james@example.com',
    sourceType: 'graph_email',
    sourceApp: 'Outlook',
    capturedAt: '2026-03-26T10:00:00Z',
    rawContent: '{"subject":"Report","body":"Pipe stress data"}',
    metadata: {},
  };

  const extraction: ExtractionResult = {
    summary: 'Pipe stress calculation method for subsea risers',
    tags: ['pipe-stress', 'subsea'],
    confidence: 0.88,
    sensitivity: { classification: 'safe', reasoning: 'Technical content' },
  };

  it('builds a complete engram from capture + extraction', () => {
    const engram = buildEngram(capture, extraction);
    expect(engram.concept).toBe('Pipe stress calculation method for subsea risers');
    expect(engram.content).toBe(extraction.summary);
    expect(engram.source_type).toBe('graph_email');
    expect(engram.user_id).toBe('user-abc');
    expect(engram.approval_status).toBe('pending');
    expect(engram.confidence).toBe(0.88);
    expect(engram.tags).toEqual(['pipe-stress', 'subsea']);
    expect(engram.raw_text).toBe(capture.rawContent);
    expect(engram.approved_at).toBeNull();
  });

  it('sets notification priority based on confidence', () => {
    const highConf = buildEngram(capture, { ...extraction, confidence: 0.9 });
    const lowConf = buildEngram(capture, { ...extraction, confidence: 0.4 });
    expect(highConf.notification_priority).toBe('notify');
    expect(lowConf.notification_priority).toBe('silent');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline/engram-builder.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// src/pipeline/engram-builder.ts
import type { RawCapture, ExtractionResult, HarvesterEngram } from '../types.js';

export interface EngramWithPriority extends HarvesterEngram {
  notification_priority: 'notify' | 'silent';
}

const NOTIFICATION_THRESHOLD = 0.7;

export function buildEngram(
  capture: RawCapture,
  extraction: ExtractionResult
): EngramWithPriority {
  return {
    concept: extraction.summary,
    content: extraction.summary,
    source_type: capture.sourceType,
    source_app: capture.sourceApp,
    user_id: capture.userId,
    user_email: capture.userEmail,
    captured_at: capture.capturedAt,
    approved_at: null,
    approved_by: null,
    approval_status: 'pending',
    confidence: extraction.confidence,
    sensitivity_classification: extraction.sensitivity.classification,
    tags: extraction.tags,
    raw_text: capture.rawContent,
    notification_priority: extraction.confidence >= NOTIFICATION_THRESHOLD ? 'notify' : 'silent',
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/pipeline/engram-builder.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/engram-builder.ts tests/pipeline/engram-builder.test.ts
git commit -m "feat: add engram builder with notification priority"
```

---

### Task 12: Content-hash deduplicator

**Files:**
- Create: `src/pipeline/deduplicator.ts`
- Test: `tests/pipeline/deduplicator.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/pipeline/deduplicator.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Deduplicator } from '../../src/pipeline/deduplicator.js';
import { unlinkSync } from 'fs';

const TEST_DB = 'test-dedup.db';

describe('Deduplicator', () => {
  let dedup: Deduplicator;

  beforeEach(() => {
    dedup = new Deduplicator(TEST_DB);
  });

  afterEach(() => {
    dedup.close();
    try { unlinkSync(TEST_DB); } catch {}
  });

  it('returns false for first occurrence of content', () => {
    expect(dedup.isDuplicate('user-1', 'The pipe stress analysis shows...')).toBe(false);
  });

  it('returns true for duplicate content from same user', () => {
    dedup.isDuplicate('user-1', 'The pipe stress analysis shows...');
    expect(dedup.isDuplicate('user-1', 'The pipe stress analysis shows...')).toBe(true);
  });

  it('allows same content from different users', () => {
    dedup.isDuplicate('user-1', 'Shared report');
    expect(dedup.isDuplicate('user-2', 'Shared report')).toBe(false);
  });

  it('expires old entries', () => {
    dedup.isDuplicate('user-1', 'old content');
    dedup.expireOlderThan(0); // expire everything
    expect(dedup.isDuplicate('user-1', 'old content')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline/deduplicator.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// src/pipeline/deduplicator.ts
import Database from 'better-sqlite3';
import { createHash } from 'crypto';

export class Deduplicator {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS content_hashes (
        user_id TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, content_hash)
      )
    `);
  }

  isDuplicate(userId: string, content: string): boolean {
    const hash = createHash('sha256').update(content).digest('hex');

    const existing = this.db
      .prepare('SELECT 1 FROM content_hashes WHERE user_id = ? AND content_hash = ?')
      .get(userId, hash);

    if (existing) return true;

    this.db
      .prepare('INSERT INTO content_hashes (user_id, content_hash) VALUES (?, ?)')
      .run(userId, hash);

    return false;
  }

  expireOlderThan(days: number): void {
    this.db
      .prepare(`DELETE FROM content_hashes WHERE created_at < datetime('now', '-' || ? || ' days')`)
      .run(days);
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/pipeline/deduplicator.test.ts`
Expected: PASS — all 4 tests

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/deduplicator.ts tests/pipeline/deduplicator.test.ts
git commit -m "feat: add content-hash deduplicator with SQLite backend"
```

---

### Task 13: Fidelity reducer

**Files:**
- Create: `src/pipeline/fidelity-reducer.ts`
- Create: `prompts/fidelity-reduction.txt`
- Test: `tests/pipeline/fidelity-reducer.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/pipeline/fidelity-reducer.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FidelityReducer } from '../../src/pipeline/fidelity-reducer.js';
import type { HarvesterEngram, DepartmentEngram, OrgEngram } from '../../src/types.js';

describe('FidelityReducer', () => {
  let reducer: FidelityReducer;

  const engram: HarvesterEngram = {
    concept: 'Pipe stress calculation for 6-inch risers',
    content: 'Detailed FEA analysis of subsea riser section 4 using ANSYS...',
    source_type: 'graph_email',
    source_app: 'Outlook',
    user_id: 'user-abc',
    user_email: 'james@example.com',
    captured_at: '2026-03-26T10:00:00Z',
    approved_at: '2026-03-26T10:05:00Z',
    approved_by: 'user-abc',
    approval_status: 'approved',
    confidence: 0.88,
    sensitivity_classification: 'safe',
    tags: ['pipe-stress', 'subsea', 'FEA'],
    raw_text: '{"subject":"Report","body":"long raw email..."}',
  };

  beforeEach(() => {
    reducer = new FidelityReducer();
  });

  it('reduces to department layer — strips raw text and confidence', () => {
    const dept = reducer.toDepartment(engram);
    expect(dept.concept).toBe(engram.concept);
    expect(dept.content).toBe(engram.content);
    expect(dept.user_email).toBe('james@example.com');
    expect(dept.tags).toEqual(['pipe-stress', 'subsea', 'FEA']);
    expect((dept as any).raw_text).toBeUndefined();
    expect((dept as any).confidence).toBeUndefined();
    expect((dept as any).sensitivity_classification).toBeUndefined();
  });

  it('reduces to org layer — strips individual attribution', () => {
    const org = reducer.toOrg(engram, 'Engineering');
    expect(org.concept).toBe(engram.concept);
    expect(org.tags).toEqual(['pipe-stress', 'subsea', 'FEA']);
    expect(org.department).toBe('Engineering');
    expect((org as any).user_email).toBeUndefined();
    expect((org as any).content).toBeUndefined();
    expect((org as any).raw_text).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline/fidelity-reducer.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the fidelity reduction prompt**

```text
# prompts/fidelity-reduction.txt
You are a knowledge summariser. Given a detailed knowledge engram, produce a brief topic-level summary suitable for cross-department visibility.

## Input
A knowledge engram with full context.

## Output
Respond with ONLY a JSON object:

{
  "topic_summary": "A single sentence describing what topic/expertise this represents, without revealing specific details or individuals",
  "tags": ["relevant", "topic", "tags"]
}

## Rules
- Remove all personal identifiers
- Remove specific project names or client names
- Keep only the general topic area and expertise domain
- Maximum 20 words for topic_summary
```

- [ ] **Step 4: Write the implementation**

```typescript
// src/pipeline/fidelity-reducer.ts
import type { HarvesterEngram, DepartmentEngram, OrgEngram } from '../types.js';

export class FidelityReducer {
  toDepartment(engram: HarvesterEngram): DepartmentEngram {
    return {
      concept: engram.concept,
      content: engram.content,
      source_app: engram.source_app,
      user_id: engram.user_id,
      user_email: engram.user_email,
      tags: [...engram.tags],
    };
  }

  toOrg(engram: HarvesterEngram, department: string): OrgEngram {
    return {
      concept: engram.concept,
      tags: [...engram.tags],
      department,
    };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/pipeline/fidelity-reducer.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/pipeline/fidelity-reducer.ts prompts/fidelity-reduction.txt tests/pipeline/fidelity-reducer.test.ts
git commit -m "feat: add fidelity reducer for dept/org layer generation"
```

---

## Chunk 4: Storage + Pipeline Orchestrator

### Task 14: MuninnDB client

**Files:**
- Create: `src/storage/muninndb-client.ts`
- Test: `tests/storage/muninndb-client.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/storage/muninndb-client.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MuninnDBClient } from '../../src/storage/muninndb-client.js';

describe('MuninnDBClient', () => {
  let client: MuninnDBClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ id: 'eng-001', concept: 'Test', content: 'Test content' }),
    });
    global.fetch = mockFetch;
    client = new MuninnDBClient('http://localhost:3030', 'mk_test');
  });

  it('stores an engram with correct vault and headers', async () => {
    await client.remember('test-vault', 'Test concept', 'Test content');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain('/remember');
    expect(opts.headers['Authorization']).toBe('Bearer mk_test');
    expect(JSON.parse(opts.body)).toMatchObject({
      vault: 'test-vault',
      concept: 'Test concept',
      content: 'Test content',
    });
  });

  it('recalls engrams from a vault', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ engrams: [{ id: 'e1', concept: 'Test' }] }),
    });

    const result = await client.recall('test-vault', 'search query');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(result.engrams).toHaveLength(1);
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
      text: () => Promise.resolve('error'),
    });

    await expect(client.remember('v', 'c', 'x')).rejects.toThrow('MuninnDB error: 500');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/storage/muninndb-client.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// src/storage/muninndb-client.ts

export class MuninnDBClient {
  constructor(
    private baseUrl: string,
    private apiKey: string
  ) {}

  private get headers(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${this.apiKey}`,
    };
  }

  async remember(vault: string, concept: string, content: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/remember`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ vault, concept, content }),
    });

    if (!res.ok) throw new Error(`MuninnDB error: ${res.status}`);
    return res.json();
  }

  async recall(vault: string, context: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/recall`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ vault, context }),
    });

    if (!res.ok) throw new Error(`MuninnDB error: ${res.status}`);
    return res.json();
  }

  async read(vault: string, id: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/read`, {
      method: 'POST',
      headers: this.headers,
      body: JSON.stringify({ vault, id }),
    });

    if (!res.ok) throw new Error(`MuninnDB error: ${res.status}`);
    return res.json();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/storage/muninndb-client.test.ts`
Expected: PASS — all 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/storage/muninndb-client.ts tests/storage/muninndb-client.test.ts
git commit -m "feat: add MuninnDB HTTP client wrapper"
```

---

### Task 15: Vault manager

**Files:**
- Create: `src/storage/vault-manager.ts`
- Test: `tests/storage/vault-manager.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/storage/vault-manager.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VaultManager } from '../../src/storage/vault-manager.js';
import type { HarvesterEngram } from '../../src/types.js';

describe('VaultManager', () => {
  let vaultManager: VaultManager;
  let mockRemember: ReturnType<typeof vi.fn>;

  const engram: HarvesterEngram = {
    concept: 'Pipe stress method',
    content: 'Detailed analysis...',
    source_type: 'graph_email',
    source_app: 'Outlook',
    user_id: 'user-abc',
    user_email: 'james@example.com',
    captured_at: '2026-03-26T10:00:00Z',
    approved_at: null,
    approved_by: null,
    approval_status: 'pending',
    confidence: 0.88,
    sensitivity_classification: 'safe',
    tags: ['pipe-stress'],
    raw_text: 'raw...',
  };

  beforeEach(() => {
    mockRemember = vi.fn().mockResolvedValue({ id: 'eng-001' });
    const mockClient = { remember: mockRemember, recall: vi.fn(), read: vi.fn() } as any;
    vaultManager = new VaultManager(mockClient);
  });

  it('stores pending engram in personal vault only', async () => {
    await vaultManager.storePending(engram);

    expect(mockRemember).toHaveBeenCalledTimes(1);
    expect(mockRemember.mock.calls[0][0]).toBe('knowledge-harvester-user-abc');
  });

  it('stores approved engram in all three vaults', async () => {
    const approved = { ...engram, approval_status: 'approved' as const };
    await vaultManager.storeApproved(approved, 'Engineering');

    expect(mockRemember).toHaveBeenCalledTimes(3);
    const vaults = mockRemember.mock.calls.map((c: any[]) => c[0]);
    expect(vaults).toContain('knowledge-harvester-user-abc');
    expect(vaults).toContain('knowledge-harvester-dept-Engineering');
    expect(vaults).toContain('knowledge-harvester-org');
  });

  it('generates correct vault names', () => {
    expect(VaultManager.personalVault('user-abc')).toBe('knowledge-harvester-user-abc');
    expect(VaultManager.deptVault('Engineering')).toBe('knowledge-harvester-dept-Engineering');
    expect(VaultManager.orgVault()).toBe('knowledge-harvester-org');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/storage/vault-manager.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// src/storage/vault-manager.ts
import type { MuninnDBClient } from './muninndb-client.js';
import type { HarvesterEngram } from '../types.js';
import { FidelityReducer } from '../pipeline/fidelity-reducer.js';

const reducer = new FidelityReducer();

export class VaultManager {
  constructor(private client: MuninnDBClient) {}

  static personalVault(userId: string): string {
    return `knowledge-harvester-${userId}`;
  }

  static deptVault(department: string): string {
    return `knowledge-harvester-dept-${department}`;
  }

  static orgVault(): string {
    return 'knowledge-harvester-org';
  }

  async storePending(engram: HarvesterEngram): Promise<void> {
    const vault = VaultManager.personalVault(engram.user_id);
    await this.client.remember(vault, engram.concept, JSON.stringify(engram));
  }

  async storeApproved(engram: HarvesterEngram, department: string): Promise<void> {
    // Personal vault — full fidelity
    const personalVault = VaultManager.personalVault(engram.user_id);
    await this.client.remember(personalVault, engram.concept, JSON.stringify(engram));

    // Department vault — reduced fidelity
    const deptEngram = reducer.toDepartment(engram);
    const deptVault = VaultManager.deptVault(department);
    await this.client.remember(deptVault, deptEngram.concept, JSON.stringify(deptEngram));

    // Org vault — minimal fidelity
    const orgEngram = reducer.toOrg(engram, department);
    const orgVault = VaultManager.orgVault();
    await this.client.remember(orgVault, orgEngram.concept, JSON.stringify(orgEngram));
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/storage/vault-manager.test.ts`
Expected: PASS — all 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/storage/vault-manager.ts tests/storage/vault-manager.test.ts
git commit -m "feat: add vault manager with three-layer fidelity writes"
```

---

### Task 16: Pipeline processor (orchestrator)

**Files:**
- Create: `src/pipeline/processor.ts`
- Test: `tests/pipeline/processor.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/pipeline/processor.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PipelineProcessor } from '../../src/pipeline/processor.js';
import type { RawCapture } from '../../src/types.js';

describe('PipelineProcessor', () => {
  let processor: PipelineProcessor;
  let mockExtractor: any;
  let mockDeduplicator: any;
  let mockVaultManager: any;
  let mockNatsPublish: ReturnType<typeof vi.fn>;

  const capture: RawCapture = {
    id: 'cap-1',
    userId: 'user-abc',
    userEmail: 'james@example.com',
    sourceType: 'graph_email',
    sourceApp: 'Outlook',
    capturedAt: '2026-03-26T10:00:00Z',
    rawContent: JSON.stringify({ subject: 'Pipe report', body: 'FEA analysis...' }),
    metadata: {},
  };

  beforeEach(() => {
    mockExtractor = {
      extract: vi.fn().mockResolvedValue({
        summary: 'Pipe stress method',
        tags: ['pipe-stress'],
        confidence: 0.88,
        sensitivity: { classification: 'safe', reasoning: 'Technical' },
      }),
    };
    mockDeduplicator = {
      isDuplicate: vi.fn().mockReturnValue(false),
    };
    mockVaultManager = {
      storePending: vi.fn().mockResolvedValue(undefined),
    };
    mockNatsPublish = vi.fn();

    processor = new PipelineProcessor(
      mockExtractor,
      mockDeduplicator,
      mockVaultManager,
      mockNatsPublish
    );
  });

  it('processes safe capture end-to-end', async () => {
    const result = await processor.process(capture);
    expect(result.action).toBe('stored');
    expect(mockVaultManager.storePending).toHaveBeenCalledTimes(1);
    expect(mockNatsPublish).toHaveBeenCalledTimes(1);
  });

  it('blocks sensitive content at pre-filter', async () => {
    const sensitive: RawCapture = {
      ...capture,
      rawContent: JSON.stringify({ subject: 'Your Salary Review', body: 'details' }),
    };
    const result = await processor.process(sensitive);
    expect(result.action).toBe('blocked');
    expect(mockExtractor.extract).not.toHaveBeenCalled();
  });

  it('blocks content the LLM classifies as block', async () => {
    mockExtractor.extract.mockResolvedValue({
      summary: 'Personal',
      tags: [],
      confidence: 0.5,
      sensitivity: { classification: 'block', reasoning: 'Personal content' },
    });

    const result = await processor.process(capture);
    expect(result.action).toBe('blocked');
    expect(mockVaultManager.storePending).not.toHaveBeenCalled();
  });

  it('skips duplicate content', async () => {
    mockDeduplicator.isDuplicate.mockReturnValue(true);

    const result = await processor.process(capture);
    expect(result.action).toBe('deduplicated');
    expect(mockExtractor.extract).not.toHaveBeenCalled();
  });

  it('stores review-classified content as pending with review flag', async () => {
    mockExtractor.extract.mockResolvedValue({
      summary: 'Mixed content',
      tags: [],
      confidence: 0.6,
      sensitivity: { classification: 'review', reasoning: 'Mixed' },
    });

    const result = await processor.process(capture);
    expect(result.action).toBe('stored');
    expect(mockVaultManager.storePending).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/pipeline/processor.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// src/pipeline/processor.ts
import { sensitivityPreFilter } from './sensitivity-filter.js';
import { buildEngram } from './engram-builder.js';
import type { Extractor } from './extractor.js';
import type { Deduplicator } from './deduplicator.js';
import type { VaultManager } from '../storage/vault-manager.js';
import type { RawCapture } from '../types.js';
import { topicForUser } from '../queue/topics.js';

export interface ProcessResult {
  action: 'stored' | 'blocked' | 'deduplicated' | 'error';
  reason?: string;
}

export class PipelineProcessor {
  constructor(
    private extractor: Extractor,
    private deduplicator: Deduplicator,
    private vaultManager: VaultManager,
    private publishToNats: (topic: string, data: unknown) => void
  ) {}

  async process(capture: RawCapture): Promise<ProcessResult> {
    // Stage 1: Rules-based sensitivity pre-filter (must run first for audit trail)
    const filterResult = sensitivityPreFilter(capture);
    if (filterResult.action === 'block') {
      return { action: 'blocked', reason: `pre-filter: ${filterResult.reason}` };
    }

    // Stage 2: Dedup check (before LLM call to save compute)
    if (this.deduplicator.isDuplicate(capture.userId, capture.rawContent)) {
      return { action: 'deduplicated' };
    }

    // Stage 3: LLM extraction + sensitivity
    const extraction = await this.extractor.extract(capture);

    // Stage 4: LLM sensitivity gate
    if (extraction.sensitivity.classification === 'block') {
      return { action: 'blocked', reason: `llm: ${extraction.sensitivity.reasoning}` };
    }

    // Stage 5: Build engram and store
    const engram = buildEngram(capture, extraction);
    await this.vaultManager.storePending(engram);

    // Stage 6: Notify
    this.publishToNats(topicForUser(capture.userId), engram);

    return { action: 'stored' };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/pipeline/processor.test.ts`
Expected: PASS — all 5 tests

- [ ] **Step 5: Commit**

```bash
git add src/pipeline/processor.ts tests/pipeline/processor.test.ts
git commit -m "feat: add pipeline processor orchestrating all stages"
```

---

## Chunk 5: REST API + WebSocket + Entry Point

### Task 17: Azure AD auth middleware

**Files:**
- Create: `src/api/auth.ts`
- Test: `tests/api/auth.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/api/auth.test.ts
import { describe, it, expect, vi } from 'vitest';
import { extractUserId } from '../../src/api/auth.js';

describe('extractUserId', () => {
  it('extracts user ID from a valid JWT payload', () => {
    // Create a mock JWT with base64-encoded payload
    const payload = Buffer.from(JSON.stringify({
      oid: 'user-abc-123',
      preferred_username: 'james@example.com',
    })).toString('base64url');
    const token = `header.${payload}.signature`;

    const result = extractUserId(token);
    expect(result.userId).toBe('user-abc-123');
    expect(result.userEmail).toBe('james@example.com');
  });

  it('throws on missing oid claim', () => {
    const payload = Buffer.from(JSON.stringify({
      preferred_username: 'james@example.com',
    })).toString('base64url');
    const token = `header.${payload}.signature`;

    expect(() => extractUserId(token)).toThrow('Missing oid');
  });

  it('throws on malformed token', () => {
    expect(() => extractUserId('not-a-jwt')).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/auth.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// src/api/auth.ts

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/auth.test.ts`
Expected: PASS — all 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/api/auth.ts tests/api/auth.test.ts
git commit -m "feat: add JWT auth helper for Azure AD tokens"
```

---

### Task 18: Engrams API routes

**Files:**
- Create: `src/api/routes/engrams.ts`
- Test: `tests/api/engrams.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/api/engrams.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify from 'fastify';
import { engramRoutes } from '../../src/api/routes/engrams.js';
import { EngramIndex } from '../../src/storage/engram-index.js';
import { unlinkSync } from 'fs';

const TEST_DB = 'test-engram-index.db';

describe('engram routes', () => {
  let app: ReturnType<typeof Fastify>;
  let mockMuninnClient: any;
  let mockVaultManager: any;
  let engramIndex: EngramIndex;

  beforeEach(async () => {
    engramIndex = new EngramIndex(TEST_DB);
    engramIndex.upsert({
      id: 'e1', userId: 'user-abc', concept: 'Pipe stress',
      approvalStatus: 'pending', capturedAt: '2026-03-26T10:00:00Z',
      sourceType: 'graph_email', confidence: 0.88,
    });

    mockMuninnClient = {
      recall: vi.fn().mockResolvedValue({ engrams: [] }),
      remember: vi.fn().mockResolvedValue({ id: 'e1' }),
      read: vi.fn().mockResolvedValue({
        id: 'e1', concept: 'Pipe stress',
        content: JSON.stringify({ user_id: 'user-abc', approval_status: 'pending' }),
      }),
    };

    mockVaultManager = {
      storeApproved: vi.fn().mockResolvedValue(undefined),
    };

    app = Fastify();
    app.decorateRequest('user', null);
    app.addHook('preHandler', async (req) => {
      (req as any).user = { userId: 'user-abc', userEmail: 'james@example.com' };
    });

    app.register(engramRoutes, { muninnClient: mockMuninnClient, vaultManager: mockVaultManager, engramIndex });
    await app.ready();
  });

  afterEach(() => {
    engramIndex.close();
    try { unlinkSync(TEST_DB); } catch {}
  });

  it('GET /api/engrams returns user engrams filtered by status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/engrams?status=pending' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.engrams).toHaveLength(1);
    expect(body.engrams[0].id).toBe('e1');
  });

  it('GET /api/engrams returns empty for non-matching status', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/engrams?status=approved' });
    const body = JSON.parse(res.body);
    expect(body.engrams).toHaveLength(0);
  });

  it('PATCH /api/engrams/:id updates approval status', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/engrams/e1',
      payload: { approval_status: 'approved', department: 'Engineering' },
    });
    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/engrams.test.ts`
Expected: FAIL

- [ ] **Step 2.5: Write the engram index (SQLite-backed structured query)**

```typescript
// src/storage/engram-index.ts
import Database from 'better-sqlite3';

export interface EngramIndexRow {
  id: string;
  userId: string;
  concept: string;
  approvalStatus: string;
  capturedAt: string;
  sourceType: string;
  confidence: number;
}

export class EngramIndex {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS engram_index (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        concept TEXT NOT NULL,
        approval_status TEXT NOT NULL DEFAULT 'pending',
        captured_at TEXT NOT NULL,
        source_type TEXT NOT NULL,
        confidence REAL NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_user_status ON engram_index (user_id, approval_status)`);
  }

  upsert(row: EngramIndexRow): void {
    this.db.prepare(`
      INSERT INTO engram_index (id, user_id, concept, approval_status, captured_at, source_type, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        approval_status = excluded.approval_status,
        updated_at = datetime('now')
    `).run(row.id, row.userId, row.concept, row.approvalStatus, row.capturedAt, row.sourceType, row.confidence);
  }

  listByStatus(userId: string, status: string, limit = 20): EngramIndexRow[] {
    return this.db.prepare(`
      SELECT id, user_id as userId, concept, approval_status as approvalStatus,
             captured_at as capturedAt, source_type as sourceType, confidence
      FROM engram_index WHERE user_id = ? AND approval_status = ?
      ORDER BY captured_at DESC LIMIT ?
    `).all(userId, status, limit) as EngramIndexRow[];
  }

  listAll(userId: string, limit = 20): EngramIndexRow[] {
    return this.db.prepare(`
      SELECT id, user_id as userId, concept, approval_status as approvalStatus,
             captured_at as capturedAt, source_type as sourceType, confidence
      FROM engram_index WHERE user_id = ?
      ORDER BY captured_at DESC LIMIT ?
    `).all(userId, limit) as EngramIndexRow[];
  }

  updateStatus(id: string, status: string): void {
    this.db.prepare(`UPDATE engram_index SET approval_status = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(status, id);
  }

  close(): void {
    this.db.close();
  }
}
```

- [ ] **Step 3: Write the implementation**

```typescript
// src/api/routes/engrams.ts
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { MuninnDBClient } from '../../storage/muninndb-client.js';
import type { VaultManager } from '../../storage/vault-manager.js';
import type { EngramIndex } from '../../storage/engram-index.js';
import { VaultManager as VM } from '../../storage/vault-manager.js';

interface EngramRoutesOpts extends FastifyPluginOptions {
  muninnClient: MuninnDBClient;
  vaultManager: VaultManager;
  engramIndex: EngramIndex;
}

export async function engramRoutes(app: FastifyInstance, opts: EngramRoutesOpts): Promise<void> {
  const { muninnClient, vaultManager, engramIndex } = opts;

  app.get('/api/engrams', async (req) => {
    const user = (req as any).user;
    const { status, q, limit } = req.query as { status?: string; q?: string; limit?: string };
    const maxResults = parseInt(limit || '20', 10);

    // Structured query via SQLite index for status filtering
    if (status) {
      const engrams = engramIndex.listByStatus(user.userId, status, maxResults);
      return { engrams };
    }

    // Semantic search via MuninnDB for text queries
    if (q) {
      const vault = VM.personalVault(user.userId);
      const result = await muninnClient.recall(vault, q);
      return { engrams: result.engrams ?? [] };
    }

    const engrams = engramIndex.listAll(user.userId, maxResults);
    return { engrams };
  });

  app.get('/api/engrams/:id', async (req) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const vault = VM.personalVault(user.userId);
    return await muninnClient.read(vault, id);
  });

  app.patch('/api/engrams/:id', async (req) => {
    const user = (req as any).user;
    const { id } = req.params as { id: string };
    const { approval_status, department } = req.body as {
      approval_status: 'approved' | 'dismissed';
      department?: string;
    };

    const vault = VM.personalVault(user.userId);
    const existing = await muninnClient.read(vault, id);
    const engram = JSON.parse(existing.content);

    // Ownership check
    if (engram.user_id !== user.userId) {
      return { error: 'Forbidden' };
    }

    engram.approval_status = approval_status;
    engram.approved_at = new Date().toISOString();
    engram.approved_by = user.userId;

    // Update local index
    engramIndex.updateStatus(id, approval_status);

    if (approval_status === 'approved' && department) {
      await vaultManager.storeApproved(engram, department);
    } else {
      await muninnClient.remember(vault, existing.concept, JSON.stringify(engram));
    }

    return { status: 'ok', approval_status };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/engrams.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/engrams.ts tests/api/engrams.test.ts
git commit -m "feat: add engram CRUD API routes"
```

---

### Task 19: Stats route

**Files:**
- Create: `src/api/routes/stats.ts`
- Test: `tests/api/stats.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/api/stats.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';
import { statsRoutes } from '../../src/api/routes/stats.js';

describe('stats routes', () => {
  let app: ReturnType<typeof Fastify>;

  beforeEach(async () => {
    const mockMuninnClient = {
      recall: vi.fn().mockResolvedValue({ engrams: [{}, {}, {}] }),
    };

    app = Fastify();
    app.decorateRequest('user', null);
    app.addHook('preHandler', async (req) => {
      (req as any).user = { userId: 'user-abc', userEmail: 'james@example.com' };
    });
    app.register(statsRoutes, { muninnClient: mockMuninnClient });
    await app.ready();
  });

  it('GET /api/stats returns stats object', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/stats' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body).toHaveProperty('totalEngrams');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/stats.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// src/api/routes/stats.ts
import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { MuninnDBClient } from '../../storage/muninndb-client.js';
import { VaultManager } from '../../storage/vault-manager.js';

interface StatsRoutesOpts extends FastifyPluginOptions {
  muninnClient: MuninnDBClient;
}

export async function statsRoutes(app: FastifyInstance, opts: StatsRoutesOpts): Promise<void> {
  const { muninnClient } = opts;

  app.get('/api/stats', async (req) => {
    const user = (req as any).user;
    const vault = VaultManager.personalVault(user.userId);

    const result = await muninnClient.recall(vault, 'all engrams');
    const engrams = result.engrams ?? [];

    return {
      totalEngrams: engrams.length,
      userId: user.userId,
    };
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/stats.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/api/routes/stats.ts tests/api/stats.test.ts
git commit -m "feat: add stats API route"
```

---

### Task 20: WebSocket handler

**Files:**
- Create: `src/api/ws.ts`
- Test: `tests/api/ws.test.ts`

- [ ] **Step 1: Write the test**

```typescript
// tests/api/ws.test.ts
import { describe, it, expect, vi } from 'vitest';
import { WebSocketManager } from '../../src/api/ws.js';

describe('WebSocketManager', () => {
  it('registers and removes connections', () => {
    const manager = new WebSocketManager();
    const mockSocket = { send: vi.fn(), readyState: 1 } as any;

    manager.addConnection('user-abc', mockSocket);
    expect(manager.getConnectionCount('user-abc')).toBe(1);

    manager.removeConnection('user-abc', mockSocket);
    expect(manager.getConnectionCount('user-abc')).toBe(0);
  });

  it('sends notification to connected user', () => {
    const manager = new WebSocketManager();
    const mockSocket = { send: vi.fn(), readyState: 1 } as any; // OPEN = 1

    manager.addConnection('user-abc', mockSocket);
    manager.notify('user-abc', { type: 'new_engram', engram: { concept: 'Test' } });

    expect(mockSocket.send).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockSocket.send.mock.calls[0][0])).toMatchObject({ type: 'new_engram' });
  });

  it('skips notification for disconnected users', () => {
    const manager = new WebSocketManager();
    // no connection registered
    manager.notify('user-xyz', { type: 'new_engram' });
    // should not throw
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/api/ws.test.ts`
Expected: FAIL

- [ ] **Step 3: Write the implementation**

```typescript
// src/api/ws.ts
import type { WebSocket } from 'ws';

export class WebSocketManager {
  private connections = new Map<string, Set<WebSocket>>();

  addConnection(userId: string, socket: WebSocket): void {
    if (!this.connections.has(userId)) {
      this.connections.set(userId, new Set());
    }
    this.connections.get(userId)!.add(socket);
  }

  removeConnection(userId: string, socket: WebSocket): void {
    const sockets = this.connections.get(userId);
    if (sockets) {
      sockets.delete(socket);
      if (sockets.size === 0) this.connections.delete(userId);
    }
  }

  notify(userId: string, data: unknown): void {
    const sockets = this.connections.get(userId);
    if (!sockets) return;

    const message = JSON.stringify(data);
    for (const socket of sockets) {
      if (socket.readyState === 1) { // WebSocket.OPEN
        socket.send(message);
      }
    }
  }

  getConnectionCount(userId: string): number {
    return this.connections.get(userId)?.size ?? 0;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/api/ws.test.ts`
Expected: PASS — all 3 tests

- [ ] **Step 5: Commit**

```bash
git add src/api/ws.ts tests/api/ws.test.ts
git commit -m "feat: add WebSocket manager for real-time engram notifications"
```

---

### Task 21: Fastify server setup

**Files:**
- Create: `src/api/server.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// src/api/server.ts
import Fastify from 'fastify';
import websocket from '@fastify/websocket';
import { extractUserId } from './auth.js';
import { engramRoutes } from './routes/engrams.js';
import { statsRoutes } from './routes/stats.js';
import type { MuninnDBClient } from '../storage/muninndb-client.js';
import type { VaultManager } from '../storage/vault-manager.js';
import type { EngramIndex } from '../storage/engram-index.js';
import type { WebSocketManager } from './ws.js';

export interface ServerDeps {
  muninnClient: MuninnDBClient;
  vaultManager: VaultManager;
  engramIndex: EngramIndex;
  wsManager: WebSocketManager;
}

export async function createServer(deps: ServerDeps) {
  const app = Fastify({ logger: true });

  await app.register(websocket);

  // Health check (no auth)
  app.get('/api/health', async () => ({ status: 'ok', timestamp: new Date().toISOString() }));

  // Auth middleware for all other /api routes
  app.decorateRequest('user', null);
  app.addHook('preHandler', async (req, reply) => {
    if (req.url === '/api/health') return;
    if (req.url.startsWith('/ws/')) return;

    const authHeader = req.headers.authorization;
    if (!authHeader) {
      reply.code(401).send({ error: 'Missing Authorization header' });
      return;
    }

    try {
      (req as any).user = extractUserId(authHeader);
    } catch (err) {
      reply.code(401).send({ error: 'Invalid token' });
    }
  });

  // Routes
  app.register(engramRoutes, { muninnClient: deps.muninnClient, vaultManager: deps.vaultManager, engramIndex: deps.engramIndex });
  app.register(statsRoutes, { muninnClient: deps.muninnClient });

  // WebSocket endpoint
  app.register(async (wsApp) => {
    wsApp.get('/ws/engrams', { websocket: true }, (socket, req) => {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        socket.close(4001, 'Missing auth');
        return;
      }

      try {
        const user = extractUserId(authHeader);
        deps.wsManager.addConnection(user.userId, socket);

        socket.on('close', () => {
          deps.wsManager.removeConnection(user.userId, socket);
        });
      } catch {
        socket.close(4001, 'Invalid token');
      }
    });
  });

  return app;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/api/server.ts
git commit -m "feat: add Fastify server with auth, routes, and WebSocket"
```

---

### Task 22: Main entry point

**Files:**
- Create: `src/main.ts`

- [ ] **Step 1: Write the implementation**

```typescript
// src/main.ts
import 'dotenv/config';
import { loadConfig } from './config/index.js';
import { NatsClient } from './queue/nats-client.js';
import { TOPICS, topicForUser } from './queue/topics.js';
import { createGraphClient } from './ingestion/graph-client.js';
import { DeltaStore } from './ingestion/delta-store.js';
import { GraphPoller } from './ingestion/graph-poller.js';
import { Extractor } from './pipeline/extractor.js';
import { Deduplicator } from './pipeline/deduplicator.js';
import { PipelineProcessor } from './pipeline/processor.js';
import { MuninnDBClient } from './storage/muninndb-client.js';
import { VaultManager } from './storage/vault-manager.js';
import { EngramIndex } from './storage/engram-index.js';
import { WebSocketManager } from './api/ws.js';
import { createServer } from './api/server.js';
import OpenAI from 'openai';
import type { RawCapture } from './types.js';
import type { GraphUser } from './ingestion/graph-types.js';

async function main() {
  const config = loadConfig();
  console.log('Starting Knowledge Harvester Pipeline...');

  // NATS
  const nats = new NatsClient();
  await nats.connect(config.natsUrl);
  console.log('Connected to NATS');

  // Graph API
  const graphClient = createGraphClient(config);
  const deltaStore = new DeltaStore('delta-state.db');

  // LLM
  const llm = new OpenAI({ baseURL: config.llm.baseUrl, apiKey: 'not-needed' });
  const extractor = new Extractor(llm, config.llm.model);

  // Pipeline components
  const deduplicator = new Deduplicator('dedup-state.db');
  const engramIndex = new EngramIndex('engram-index.db');
  const muninnClient = new MuninnDBClient(config.muninndb.url, config.muninndb.apiKey);
  const vaultManager = new VaultManager(muninnClient);
  const wsManager = new WebSocketManager();

  const processor = new PipelineProcessor(
    extractor,
    deduplicator,
    vaultManager,
    (topic, data) => {
      nats.publish(topic, data);
      // Also push to WebSocket if it's a user notification
      if (topic.startsWith('engrams.pending.')) {
        const userId = topic.replace('engrams.pending.', '');
        wsManager.notify(userId, { type: 'new_engram', engram: data });
      }
    }
  );

  // Subscribe to raw captures
  nats.subscribe(TOPICS.RAW_CAPTURES, async (data) => {
    try {
      const capture = data as RawCapture;
      const result = await processor.process(capture);
      console.log(`Processed ${capture.id}: ${result.action}${result.reason ? ` (${result.reason})` : ''}`);
    } catch (err) {
      console.error('Pipeline error:', err);
      nats.publish(TOPICS.DEAD_LETTER, { capture: data, error: String(err) });
    }
  });

  // Graph polling loop
  const poller = new GraphPoller(graphClient, deltaStore, (capture) => {
    nats.publish(TOPICS.RAW_CAPTURES, capture);
  });

  async function pollAllUsers() {
    try {
      const response = await graphClient.api('/users').select('id,displayName,mail,department').get();
      const users: GraphUser[] = response.value ?? [];

      for (const user of users) {
        if (!user.mail) continue;
        try {
          await poller.pollMail(user.id, user.mail);
          await poller.pollTeamsChat(user.id, user.mail);
        } catch (err) {
          console.error(`Poll error for ${user.mail}:`, err);
        }
      }
    } catch (err) {
      console.error('User list fetch error:', err);
    }
  }

  // Start polling
  await pollAllUsers();
  setInterval(pollAllUsers, config.pollIntervalMs);
  console.log(`Graph polling every ${config.pollIntervalMs}ms`);

  // Start API server
  const server = await createServer({ muninnClient, vaultManager, wsManager, engramIndex });
  await server.listen({ port: 3001, host: '0.0.0.0' });
  console.log('API server running on port 3001');

  // Graceful shutdown
  const shutdown = async () => {
    console.log('Shutting down...');
    await server.close();
    await nats.disconnect();
    deltaStore.close();
    deduplicator.close();
    engramIndex.close();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
```

- [ ] **Step 2: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors (or only minor fixable issues)

- [ ] **Step 3: Commit**

```bash
git add src/main.ts
git commit -m "feat: add main entry point wiring all pipeline components"
```

---

### Task 23: Run full test suite

- [ ] **Step 1: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Fix any failures**

Address any compilation or test issues discovered.

- [ ] **Step 3: Final commit**

```bash
git add -A
git commit -m "chore: fix any remaining test/compilation issues"
```
