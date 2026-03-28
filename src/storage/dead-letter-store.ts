import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';

export interface DeadLetterRecord {
  id: number;
  captureId: string;
  error: string;
  attempts: number;
  payload: string;
  createdAt: string;
}

export class DeadLetterStore {
  private db: BetterSqlite3.Database;

  constructor(dbPath = 'dead-letter.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`CREATE TABLE IF NOT EXISTS dead_letters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      capture_id TEXT NOT NULL,
      error TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }

  insert(captureId: string, error: string, attempts: number, payload: unknown): void {
    this.db.prepare(
      `INSERT INTO dead_letters (capture_id, error, attempts, payload) VALUES (?, ?, ?, ?)`,
    ).run(captureId, error, attempts, JSON.stringify(payload));
  }

  list(limit = 50): DeadLetterRecord[] {
    return this.db.prepare(
      `SELECT id, capture_id AS captureId, error, attempts, payload, created_at AS createdAt
       FROM dead_letters ORDER BY created_at DESC LIMIT ?`,
    ).all(limit) as DeadLetterRecord[];
  }

  get(id: number): DeadLetterRecord | undefined {
    return this.db.prepare(
      `SELECT id, capture_id AS captureId, error, attempts, payload, created_at AS createdAt
       FROM dead_letters WHERE id = ?`,
    ).get(id) as DeadLetterRecord | undefined;
  }

  count(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS cnt FROM dead_letters').get() as { cnt: number };
    return row.cnt;
  }

  delete(id: number): void {
    this.db.prepare('DELETE FROM dead_letters WHERE id = ?').run(id);
  }

  close(): void {
    this.db.close();
  }
}
