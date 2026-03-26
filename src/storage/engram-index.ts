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
    this.db.exec(`CREATE TABLE IF NOT EXISTS engram_index (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      concept TEXT NOT NULL,
      approval_status TEXT NOT NULL DEFAULT 'pending',
      captured_at TEXT NOT NULL,
      source_type TEXT NOT NULL,
      confidence REAL NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_user_status ON engram_index (user_id, approval_status)`,
    );
  }

  upsert(row: EngramIndexRow): void {
    this.db.prepare(
      `INSERT INTO engram_index (id, user_id, concept, approval_status, captured_at, source_type, confidence)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        approval_status = excluded.approval_status,
        updated_at = datetime('now')`,
    ).run(row.id, row.userId, row.concept, row.approvalStatus, row.capturedAt, row.sourceType, row.confidence);
  }

  listByStatus(userId: string, status: string, limit = 20): EngramIndexRow[] {
    return this.db.prepare(
      `SELECT id, user_id as userId, concept, approval_status as approvalStatus,
        captured_at as capturedAt, source_type as sourceType, confidence
      FROM engram_index
      WHERE user_id = ? AND approval_status = ?
      ORDER BY captured_at DESC LIMIT ?`,
    ).all(userId, status, limit) as EngramIndexRow[];
  }

  listAll(userId: string, limit = 20): EngramIndexRow[] {
    return this.db.prepare(
      `SELECT id, user_id as userId, concept, approval_status as approvalStatus,
        captured_at as capturedAt, source_type as sourceType, confidence
      FROM engram_index
      WHERE user_id = ?
      ORDER BY captured_at DESC LIMIT ?`,
    ).all(userId, limit) as EngramIndexRow[];
  }

  updateStatus(id: string, status: string): void {
    this.db.prepare(
      `UPDATE engram_index SET approval_status = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(status, id);
  }

  close(): void {
    this.db.close();
  }
}
