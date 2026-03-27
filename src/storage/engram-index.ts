import Database from 'better-sqlite3';

export interface EngramIndexRow {
  id: string;
  userId: string;
  concept: string;
  approvalStatus: string;
  capturedAt: string;
  sourceType: string;
  confidence: number;
  /** Optional tags for full-text search indexing */
  tags?: readonly string[];
}

/** Row shape returned by the FTS5 search method */
export interface FtsSearchResult {
  id: string;
  userId: string;
  concept: string;
  approvalStatus: string;
  capturedAt: string;
  sourceType: string;
  confidence: number;
  tags: string;
  /** BM25 relevance rank (lower is more relevant) */
  rank: number;
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
      tags TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_user_status ON engram_index (user_id, approval_status)`,
    );

    // FTS5 virtual table for full-text search over concept and tags
    this.db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS engram_fts USING fts5(
      id UNINDEXED,
      concept,
      tags,
      content='engram_index',
      content_rowid='rowid'
    )`);

    // Triggers to keep the FTS index in sync with the main table
    this.db.exec(`
      CREATE TRIGGER IF NOT EXISTS engram_fts_insert AFTER INSERT ON engram_index BEGIN
        INSERT INTO engram_fts(rowid, id, concept, tags)
        VALUES (new.rowid, new.id, new.concept, new.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS engram_fts_delete AFTER DELETE ON engram_index BEGIN
        INSERT INTO engram_fts(engram_fts, rowid, id, concept, tags)
        VALUES ('delete', old.rowid, old.id, old.concept, old.tags);
      END;

      CREATE TRIGGER IF NOT EXISTS engram_fts_update AFTER UPDATE ON engram_index BEGIN
        INSERT INTO engram_fts(engram_fts, rowid, id, concept, tags)
        VALUES ('delete', old.rowid, old.id, old.concept, old.tags);
        INSERT INTO engram_fts(rowid, id, concept, tags)
        VALUES (new.rowid, new.id, new.concept, new.tags);
      END;
    `);
  }

  upsert(row: EngramIndexRow): void {
    const tagsStr = row.tags ? row.tags.join(' ') : '';
    this.db.prepare(
      `INSERT INTO engram_index (id, user_id, concept, approval_status, captured_at, source_type, confidence, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        concept = excluded.concept,
        approval_status = excluded.approval_status,
        tags = excluded.tags,
        updated_at = datetime('now')`,
    ).run(row.id, row.userId, row.concept, row.approvalStatus, row.capturedAt, row.sourceType, row.confidence, tagsStr);
  }

  /**
   * Full-text search over concept and tags using FTS5.
   * Returns results ranked by BM25 relevance, filtered to the given user.
   */
  search(userId: string, query: string, limit = 20): FtsSearchResult[] {
    return this.db.prepare(
      `SELECT
        e.id, e.user_id AS userId, e.concept,
        e.approval_status AS approvalStatus,
        e.captured_at AS capturedAt,
        e.source_type AS sourceType,
        e.confidence, e.tags,
        rank
      FROM engram_fts f
      JOIN engram_index e ON f.id = e.id
      WHERE engram_fts MATCH ? AND e.user_id = ?
      ORDER BY rank
      LIMIT ?`,
    ).all(query, userId, limit) as FtsSearchResult[];
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

  /**
   * Delete dismissed engrams whose `updated_at` is older than the given number of days.
   * Returns the count of purged rows.
   */
  purgeOlderThan(days: number): number {
    const result = this.db.prepare(
      `DELETE FROM engram_index
       WHERE approval_status = 'dismissed'
         AND updated_at <= datetime('now', ?)`,
    ).run(`-${days} days`);
    return result.changes;
  }

  close(): void {
    this.db.close();
  }
}
