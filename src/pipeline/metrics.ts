import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';

export interface MetricsSnapshot {
  processed_total: number;
  blocked_total: number;
  deduplicated_total: number;
  errors_total: number;
  ocr_processed_total: number;
  ocr_failed_total: number;
  ocr_avg_confidence: number;
  last_poll_at: string | null;
}

interface MetricsRow {
  key: string;
  value: string;
}

export class PipelineMetrics {
  private processed = 0;
  private blocked = 0;
  private deduplicated = 0;
  private errors = 0;
  private ocrProcessed = 0;
  private ocrFailed = 0;
  private ocrConfidenceSum = 0;
  private ocrConfidenceCount = 0;
  private lastPollAt: string | null = null;
  private db: BetterSqlite3.Database | null = null;
  private upsertStmt: BetterSqlite3.Statement | null = null;

  constructor(dbPath?: string) {
    if (dbPath) {
      this.db = new Database(dbPath);
      this.db.pragma('journal_mode = WAL');
      this.db.pragma('busy_timeout = 5000');
      this.db.exec(`CREATE TABLE IF NOT EXISTS metrics (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )`);
      this.upsertStmt = this.db.prepare(
        `INSERT INTO metrics (key, value) VALUES (?, ?)
         ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
      );
      this.load();
    }
  }

  private load(): void {
    if (!this.db) return;
    const rows = this.db.prepare('SELECT key, value FROM metrics').all() as MetricsRow[];
    for (const row of rows) {
      switch (row.key) {
        case 'processed':
          this.processed = Number(row.value);
          break;
        case 'blocked':
          this.blocked = Number(row.value);
          break;
        case 'deduplicated':
          this.deduplicated = Number(row.value);
          break;
        case 'errors':
          this.errors = Number(row.value);
          break;
        case 'ocr_processed':
          this.ocrProcessed = Number(row.value);
          break;
        case 'ocr_failed':
          this.ocrFailed = Number(row.value);
          break;
        case 'ocr_confidence_sum':
          this.ocrConfidenceSum = Number(row.value);
          break;
        case 'ocr_confidence_count':
          this.ocrConfidenceCount = Number(row.value);
          break;
        case 'last_poll_at':
          this.lastPollAt = row.value || null;
          break;
      }
    }
  }

  private persist(key: string, value: string | number): void {
    this.upsertStmt?.run(key, String(value));
  }

  recordProcessed(): void {
    this.processed++;
    this.persist('processed', this.processed);
  }

  recordBlocked(): void {
    this.blocked++;
    this.persist('blocked', this.blocked);
  }

  recordDeduplicated(): void {
    this.deduplicated++;
    this.persist('deduplicated', this.deduplicated);
  }

  recordError(): void {
    this.errors++;
    this.persist('errors', this.errors);
  }

  recordOcrProcessed(confidence: number): void {
    this.ocrProcessed++;
    this.ocrConfidenceSum += confidence;
    this.ocrConfidenceCount++;
    this.persist('ocr_processed', this.ocrProcessed);
    this.persist('ocr_confidence_sum', this.ocrConfidenceSum);
    this.persist('ocr_confidence_count', this.ocrConfidenceCount);
  }

  recordOcrFailed(): void {
    this.ocrFailed++;
    this.persist('ocr_failed', this.ocrFailed);
  }

  recordPoll(): void {
    this.lastPollAt = new Date().toISOString();
    this.persist('last_poll_at', this.lastPollAt);
  }

  snapshot(): MetricsSnapshot {
    return {
      processed_total: this.processed,
      blocked_total: this.blocked,
      deduplicated_total: this.deduplicated,
      errors_total: this.errors,
      ocr_processed_total: this.ocrProcessed,
      ocr_failed_total: this.ocrFailed,
      ocr_avg_confidence:
        this.ocrConfidenceCount > 0
          ? this.ocrConfidenceSum / this.ocrConfidenceCount
          : 0,
      last_poll_at: this.lastPollAt,
    };
  }

  close(): void {
    this.db?.close();
  }
}
