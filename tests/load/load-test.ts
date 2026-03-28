/**
 * Load test for the Knowledge Harvester Pipeline ingestion endpoint.
 *
 * Simulates 135 concurrent users submitting captures to POST /api/captures
 * with realistic traffic patterns: burst, sustained, and mixed content types.
 *
 * Usage:
 *   npm run test:load
 *   npm run test:load -- --users 50 --duration 30
 *
 * Requires a running dev server (default: http://localhost:3001).
 * Uses native Node.js fetch — no extra dependencies.
 */

import jwt from 'jsonwebtoken';
import { randomUUID } from 'node:crypto';

const { sign } = jwt;

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'http://localhost:3001';
const DEFAULT_USERS = 135;
const DEFAULT_DURATION_SEC = 60;
const DEFAULT_JWT_SECRET = 'dev-secret';

interface LoadTestConfig {
  baseUrl: string;
  totalUsers: number;
  durationSec: number;
  jwtSecret: string;
}

function parseArgs(): LoadTestConfig {
  const args = process.argv.slice(2);
  const get = (flag: string, fallback: string): string => {
    const idx = args.indexOf(flag);
    return idx !== -1 && args[idx + 1] ? args[idx + 1] : fallback;
  };
  return {
    baseUrl: get('--url', process.env.LOAD_TEST_URL ?? DEFAULT_BASE_URL),
    totalUsers: parseInt(get('--users', String(DEFAULT_USERS)), 10),
    durationSec: parseInt(get('--duration', String(DEFAULT_DURATION_SEC)), 10),
    jwtSecret: get('--secret', process.env.JWT_DEV_SECRET ?? DEFAULT_JWT_SECRET),
  };
}

// ---------------------------------------------------------------------------
// Types matching RawCapture from src/types.ts
// ---------------------------------------------------------------------------

const SOURCE_TYPES = [
  'graph_email',
  'graph_teams',
  'graph_calendar',
  'graph_document',
  'graph_task',
  'desktop_screenshot',
] as const;
type SourceType = (typeof SOURCE_TYPES)[number];

interface RawCapture {
  id: string;
  userId: string;
  userEmail: string;
  sourceType: SourceType;
  sourceApp: string;
  capturedAt: string;
  rawContent: string;
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SOURCE_APPS: Record<SourceType, string> = {
  graph_email: 'Outlook',
  graph_teams: 'Teams',
  graph_calendar: 'Outlook Calendar',
  graph_document: 'SharePoint',
  graph_task: 'Planner',
  desktop_screenshot: 'ScreenCapture',
};

const SAMPLE_CONTENT: Record<SourceType, () => string> = {
  graph_email: () =>
    `Subject: Q1 Budget Review\nFrom: finance@contoso.com\nBody: Please review the attached budget spreadsheet for Q1. Key changes include a 12% increase in R&D spending and consolidation of vendor contracts. Action needed by Friday.`,
  graph_teams: () =>
    `Channel: #engineering\nFrom: alex.dev@contoso.com\nMessage: Deployed v2.4.1 to staging. Memory usage down 18% after the connection pool fix. Running soak test overnight — will promote to prod tomorrow if metrics hold.`,
  graph_calendar: () =>
    `Meeting: Sprint Planning\nOrganizer: pm@contoso.com\nAttendees: 8\nNotes: Velocity target 42 points. Carry-over: PIPE-891 (OCR timeout), PIPE-903 (dedup false positives). New: PIPE-920 (batch ingestion endpoint).`,
  graph_document: () =>
    `Title: Subsea Connector Spec Rev 3\nAuthor: eng@contoso.com\nContent: Updated torque specifications for the MK-IV wet-mate connector. Operating depth rated to 3000m. New seal material reduces maintenance interval from 18 to 24 months.`,
  graph_task: () =>
    `Task: Migrate staging DB to WAL mode\nAssigned: dba@contoso.com\nDue: 2026-04-01\nDescription: Switch all 6 SQLite databases to WAL journal mode for better concurrent read performance. Benchmark before/after.`,
  desktop_screenshot: () =>
    `[OCR Text] Pipeline Dashboard — Active: 47 captures in queue, Processing: 12, Failed: 2 (dedup collision). Throughput: 3.2 captures/sec. P95 latency: 840ms. Memory: 412MB RSS.`,
};

function randomElement<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateCapture(userId: string, userEmail: string): RawCapture {
  const sourceType = randomElement(SOURCE_TYPES);
  return {
    id: randomUUID(),
    userId,
    userEmail,
    sourceType,
    sourceApp: SOURCE_APPS[sourceType],
    capturedAt: new Date().toISOString(),
    rawContent: SAMPLE_CONTENT[sourceType](),
    metadata: {
      loadTest: true,
      generatedAt: Date.now(),
    },
  };
}

function generateToken(
  userId: string,
  userEmail: string,
  secret: string,
): string {
  return sign(
    { oid: userId, preferred_username: userEmail },
    secret,
    { expiresIn: '1h' },
  );
}

// ---------------------------------------------------------------------------
// Metrics collection
// ---------------------------------------------------------------------------

interface RequestResult {
  status: number;
  latencyMs: number;
  error?: string;
}

class MetricsCollector {
  private results: RequestResult[] = [];
  private startTime = 0;
  private endTime = 0;
  private memSnapshots: { rss: number; heap: number; ts: number }[] = [];

  start(): void {
    this.startTime = performance.now();
    this.sampleMemory();
  }

  stop(): void {
    this.endTime = performance.now();
    this.sampleMemory();
  }

  record(result: RequestResult): void {
    this.results.push(result);
  }

  sampleMemory(): void {
    const mem = process.memoryUsage();
    this.memSnapshots.push({
      rss: mem.rss,
      heap: mem.heapUsed,
      ts: Date.now(),
    });
  }

  report(): void {
    const elapsed = (this.endTime - this.startTime) / 1000;
    const total = this.results.length;
    const successes = this.results.filter((r) => r.status === 202).length;
    const errors = this.results.filter((r) => r.status !== 202);
    const latencies = this.results.map((r) => r.latencyMs).sort((a, b) => a - b);

    const percentile = (p: number): number => {
      if (latencies.length === 0) return 0;
      const idx = Math.ceil((p / 100) * latencies.length) - 1;
      return latencies[Math.max(0, idx)];
    };

    const errorsByStatus = new Map<number, number>();
    for (const e of errors) {
      errorsByStatus.set(e.status, (errorsByStatus.get(e.status) ?? 0) + 1);
    }

    const peakRss = Math.max(...this.memSnapshots.map((s) => s.rss));
    const peakHeap = Math.max(...this.memSnapshots.map((s) => s.heap));

    console.log('\n' + '='.repeat(70));
    console.log('  LOAD TEST RESULTS');
    console.log('='.repeat(70));
    console.log();
    console.log(`  Duration:            ${elapsed.toFixed(2)}s`);
    console.log(`  Total requests:      ${total}`);
    console.log(`  Successful (202):    ${successes}`);
    console.log(`  Failed:              ${errors.length}`);
    console.log(`  Error rate:          ${((errors.length / total) * 100).toFixed(2)}%`);
    console.log(`  Throughput:          ${(total / elapsed).toFixed(2)} req/s`);
    console.log();
    console.log('  Latency (ms):');
    console.log(`    min:               ${latencies[0]?.toFixed(1) ?? 'N/A'}`);
    console.log(`    p50:               ${percentile(50).toFixed(1)}`);
    console.log(`    p95:               ${percentile(95).toFixed(1)}`);
    console.log(`    p99:               ${percentile(99).toFixed(1)}`);
    console.log(`    max:               ${latencies[latencies.length - 1]?.toFixed(1) ?? 'N/A'}`);
    console.log();
    console.log(`  Client memory (peak):`);
    console.log(`    RSS:               ${(peakRss / 1024 / 1024).toFixed(1)} MB`);
    console.log(`    Heap:              ${(peakHeap / 1024 / 1024).toFixed(1)} MB`);

    if (errorsByStatus.size > 0) {
      console.log();
      console.log('  Errors by status:');
      for (const [status, count] of errorsByStatus) {
        console.log(`    ${status}:               ${count}`);
      }
    }

    console.log();
    console.log('='.repeat(70));

    // Exit code 1 if error rate > 5%
    const errorRate = errors.length / total;
    if (errorRate > 0.05) {
      console.log('  FAIL: Error rate exceeds 5% threshold');
      process.exitCode = 1;
    } else if (percentile(95) > 2000) {
      console.log('  WARN: p95 latency exceeds 2000ms');
    } else {
      console.log('  PASS: All thresholds met');
    }
    console.log();
  }
}

// ---------------------------------------------------------------------------
// Simulated user
// ---------------------------------------------------------------------------

interface UserProfile {
  userId: string;
  email: string;
  token: string;
}

async function sendCapture(
  baseUrl: string,
  user: UserProfile,
  metrics: MetricsCollector,
): Promise<void> {
  const capture = generateCapture(user.userId, user.email);
  const start = performance.now();

  try {
    const res = await fetch(`${baseUrl}/api/captures`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${user.token}`,
      },
      body: JSON.stringify(capture),
      signal: AbortSignal.timeout(10_000),
    });
    const latencyMs = performance.now() - start;
    metrics.record({ status: res.status, latencyMs });
  } catch (err: any) {
    const latencyMs = performance.now() - start;
    metrics.record({
      status: 0,
      latencyMs,
      error: err.message ?? String(err),
    });
  }
}

// ---------------------------------------------------------------------------
// Traffic patterns
// ---------------------------------------------------------------------------

/**
 * Phase 1 — Burst: All users fire a capture simultaneously.
 * Simulates shift start when everyone opens their laptop at once.
 */
async function burstPhase(
  baseUrl: string,
  users: UserProfile[],
  metrics: MetricsCollector,
): Promise<void> {
  console.log(`  [Burst]     ${users.length} simultaneous captures...`);
  await Promise.all(users.map((u) => sendCapture(baseUrl, u, metrics)));
}

/**
 * Phase 2 — Sustained: Steady stream over a window, each user sends
 * multiple captures with jittered intervals.
 */
async function sustainedPhase(
  baseUrl: string,
  users: UserProfile[],
  metrics: MetricsCollector,
  durationSec: number,
): Promise<void> {
  const capturesPerUser = 5;
  const intervalMs = (durationSec * 1000) / capturesPerUser;
  console.log(
    `  [Sustained] ${users.length} users x ${capturesPerUser} captures over ${durationSec}s...`,
  );

  const promises: Promise<void>[] = [];
  for (const user of users) {
    promises.push(
      (async () => {
        for (let i = 0; i < capturesPerUser; i++) {
          // Jitter: 0-100% of interval to spread load
          const jitter = Math.random() * intervalMs;
          await new Promise((r) => setTimeout(r, jitter));
          await sendCapture(baseUrl, user, metrics);
        }
      })(),
    );
  }
  await Promise.all(promises);
}

/**
 * Phase 3 — Ramp-up: Gradually add users to find the breaking point.
 * Starts at 10% of users, ramps to 100% over the window.
 */
async function rampPhase(
  baseUrl: string,
  users: UserProfile[],
  metrics: MetricsCollector,
  durationSec: number,
): Promise<void> {
  const steps = 5;
  const stepDuration = (durationSec * 1000) / steps;
  console.log(
    `  [Ramp]      ${steps} steps from ${Math.ceil(users.length * 0.2)} to ${users.length} users over ${durationSec}s...`,
  );

  for (let step = 1; step <= steps; step++) {
    const userCount = Math.ceil(users.length * (step / steps));
    const subset = users.slice(0, userCount);
    const stepStart = performance.now();

    // Each user in this step sends 2 captures with jitter
    await Promise.all(
      subset.map(async (u) => {
        await sendCapture(baseUrl, u, metrics);
        const jitter = Math.random() * (stepDuration * 0.5);
        await new Promise((r) => setTimeout(r, jitter));
        await sendCapture(baseUrl, u, metrics);
      }),
    );

    const stepElapsed = performance.now() - stepStart;
    const remaining = stepDuration - stepElapsed;
    if (remaining > 0) {
      await new Promise((r) => setTimeout(r, remaining));
    }

    metrics.sampleMemory();
    console.log(
      `              Step ${step}/${steps}: ${userCount} users, ${subset.length * 2} requests`,
    );
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function preflight(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/api/health`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) {
      console.error(`Health check returned ${res.status}`);
      return false;
    }
    const data = (await res.json()) as Record<string, unknown>;
    console.log(`  Server status: ${data.status}`);
    return true;
  } catch (err: any) {
    console.error(`Cannot reach server at ${baseUrl}: ${err.message}`);
    return false;
  }
}

async function main(): Promise<void> {
  const config = parseArgs();

  console.log();
  console.log('='.repeat(70));
  console.log('  KNOWLEDGE HARVESTER PIPELINE — LOAD TEST');
  console.log('='.repeat(70));
  console.log();
  console.log(`  Target:              ${config.baseUrl}`);
  console.log(`  Concurrent users:    ${config.totalUsers}`);
  console.log(`  Duration:            ${config.durationSec}s per phase`);
  console.log();

  // Preflight
  console.log('  Preflight...');
  const healthy = await preflight(config.baseUrl);
  if (!healthy) {
    console.error('\n  Aborting: server not reachable. Start the dev server first.');
    process.exit(1);
  }
  console.log();

  // Generate user pool
  const users: UserProfile[] = Array.from({ length: config.totalUsers }, (_, i) => {
    const userId = `load-user-${String(i + 1).padStart(3, '0')}`;
    const email = `${userId}@load-test.local`;
    const token = generateToken(userId, email, config.jwtSecret);
    return { userId, email, token };
  });

  const metrics = new MetricsCollector();

  // --- Run phases ---
  metrics.start();

  // Phase 1: Burst (all at once)
  console.log('  Phase 1/3: Burst');
  await burstPhase(config.baseUrl, users, metrics);
  metrics.sampleMemory();

  // Brief cool-down between phases
  await new Promise((r) => setTimeout(r, 2000));

  // Phase 2: Sustained throughput
  const sustainedDuration = Math.max(10, Math.floor(config.durationSec * 0.5));
  console.log(`\n  Phase 2/3: Sustained (${sustainedDuration}s)`);
  await sustainedPhase(config.baseUrl, users, metrics, sustainedDuration);
  metrics.sampleMemory();

  await new Promise((r) => setTimeout(r, 2000));

  // Phase 3: Ramp-up
  const rampDuration = Math.max(10, Math.floor(config.durationSec * 0.3));
  console.log(`\n  Phase 3/3: Ramp-up (${rampDuration}s)`);
  await rampPhase(config.baseUrl, users, metrics, rampDuration);

  metrics.stop();
  metrics.report();
}

main().catch((err) => {
  console.error('Load test crashed:', err);
  process.exit(1);
});
