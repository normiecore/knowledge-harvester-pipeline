import { createHash } from 'node:crypto';
import Database from 'better-sqlite3';

export class Deduplicator {
  private db: Database.Database;
  private checkStmt: Database.Statement;
  private insertStmt: Database.Statement;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS content_hashes (
        user_id     TEXT NOT NULL,
        content_hash TEXT NOT NULL,
        seen_at     TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, content_hash)
      )
    `);

    this.checkStmt = this.db.prepare(
      'SELECT 1 FROM content_hashes WHERE user_id = ? AND content_hash = ?',
    );

    this.insertStmt = this.db.prepare(
      'INSERT OR IGNORE INTO content_hashes (user_id, content_hash) VALUES (?, ?)',
    );
  }

  isDuplicate(userId: string, content: string): boolean {
    const hash = createHash('sha256').update(content).digest('hex');
    const exists = this.checkStmt.get(userId, hash) !== undefined;
    if (!exists) {
      this.insertStmt.run(userId, hash);
    }
    return exists;
  }

  expireOlderThan(days: number): void {
    this.db.prepare(
      `DELETE FROM content_hashes WHERE seen_at < datetime('now', '-' || ? || ' days')`,
    ).run(days);
  }

  close(): void {
    this.db.close();
  }
}
