import Database from 'better-sqlite3';

export interface EngramIndexRow {
  id: string;
  userId: string;
  concept: string;
  approvalStatus: string;
  capturedAt: string;
  sourceType: string;
  confidence: number;
  department?: string;
  /** Optional tags for full-text search indexing */
  tags?: readonly string[];
}

/** Filters for faceted engram queries */
export interface EngramFacetFilters {
  status?: string;
  source?: string;
  from?: string;
  to?: string;
  confidence_min?: number;
  confidence_max?: number;
  department?: string;
  q?: string;
  limit?: number;
  offset?: number;
}

/** Paginated result set */
export interface PaginatedEngrams {
  engrams: EngramIndexRow[];
  total: number;
  limit: number;
  offset: number;
}

/** Status count row returned by getStatusCounts */
export interface StatusCountRow {
  approval_status: string;
  count: number;
}

/** Daily volume row returned by getDailyVolume */
export interface DailyVolumeRow {
  date: string;
  count: number;
  approved: number;
  dismissed: number;
  pending: number;
}

/** Source breakdown row returned by getSourceBreakdown */
export interface SourceCountRow {
  source: string;
  count: number;
}

/** Confidence distribution bucket */
export interface ConfidenceBucketRow {
  range: string;
  count: number;
}

/** User engram count row */
export interface UserCountRow {
  user_id: string;
  count: number;
}

/** Department engram count row */
export interface DepartmentCountRow {
  department: string;
  count: number;
}

/** Aggregated user stats computed from engram_index */
export interface UserEngramStats {
  totalCaptures: number;
  totalApproved: number;
  totalDismissed: number;
  lastCaptureAt: string | null;
}

/** Date range result */
export interface DateRangeResult {
  earliest: string | null;
  latest: string | null;
}

/** Vault-scoped query filter */
export interface VaultQueryFilter {
  where: string;
  params: (string | number)[];
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
    this.db.pragma('busy_timeout = 5000');
    this.db.exec(`CREATE TABLE IF NOT EXISTS engram_index (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      concept TEXT NOT NULL,
      approval_status TEXT NOT NULL DEFAULT 'pending',
      captured_at TEXT NOT NULL,
      source_type TEXT NOT NULL,
      confidence REAL NOT NULL,
      department TEXT NOT NULL DEFAULT 'unassigned',
      tags TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_user_status ON engram_index (user_id, approval_status)`,
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_engram_captured_at ON engram_index (captured_at)`,
    );
    // Add department column if migrating from an older schema
    try {
      this.db.exec(`ALTER TABLE engram_index ADD COLUMN department TEXT NOT NULL DEFAULT 'unassigned'`);
    } catch {
      // Column already exists -- ignore
    }

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
    const dept = row.department || 'unassigned';
    this.db.prepare(
      `INSERT INTO engram_index (id, user_id, concept, approval_status, captured_at, source_type, confidence, department, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        concept = excluded.concept,
        approval_status = excluded.approval_status,
        department = excluded.department,
        tags = excluded.tags,
        updated_at = datetime('now')`,
    ).run(row.id, row.userId, row.concept, row.approvalStatus, row.capturedAt, row.sourceType, row.confidence, dept, tagsStr);
  }

  /**
   * Full-text search over concept and tags using FTS5.
   * Returns results ranked by BM25 relevance, filtered to the given user.
   */
  search(userId: string, query: string, limit = 20): FtsSearchResult[] {
    // Escape FTS5 special chars by wrapping in double quotes (literal phrase match)
    const escaped = '"' + query.replace(/"/g, '""') + '"';
    try {
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
    ).all(escaped, userId, limit) as FtsSearchResult[];
    } catch {
      // Invalid FTS5 query syntax — return empty rather than 500
      return [];
    }
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

  /**
   * Find engrams that share at least one tag with the given engram.
   * Returns up to `limit` results for the same user, excluding the source engram.
   */
  findRelatedByTags(userId: string, engramId: string, limit = 5): EngramIndexRow[] {
    // First get the tags for the source engram
    const source = this.db.prepare(
      `SELECT tags FROM engram_index WHERE id = ? AND user_id = ?`,
    ).get(engramId, userId) as { tags: string } | undefined;

    if (!source || !source.tags.trim()) return [];

    const tagList = source.tags.trim().split(/\s+/);
    if (tagList.length === 0) return [];

    // Build a query that matches any of the tags
    // Use LIKE for each tag to find overlapping engrams
    const escapeLike = (s: string) => s.replace(/%/g, '\\%').replace(/_/g, '\\_');
    const conditions = tagList.map(() => `e.tags LIKE ? ESCAPE '\\'`);
    const params = tagList.map((t) => `%${escapeLike(t)}%`);

    return this.db.prepare(
      `SELECT id, user_id AS userId, concept, approval_status AS approvalStatus,
        captured_at AS capturedAt, source_type AS sourceType, confidence, tags
      FROM engram_index e
      WHERE e.user_id = ? AND e.id != ? AND (${conditions.join(' OR ')})
      ORDER BY e.captured_at DESC
      LIMIT ?`,
    ).all(userId, engramId, ...params, limit) as EngramIndexRow[];
  }

  /**
   * Faceted query with dynamic WHERE clauses using parameterized queries.
   * Returns a paginated result set with total count.
   */
  queryFaceted(userId: string, filters: EngramFacetFilters): PaginatedEngrams {
    const conditions: string[] = ['user_id = ?'];
    const params: (string | number)[] = [userId];

    if (filters.status) {
      conditions.push('approval_status = ?');
      params.push(filters.status);
    }
    if (filters.source) {
      conditions.push('source_type = ?');
      params.push(filters.source);
    }
    if (filters.from) {
      conditions.push('captured_at >= ?');
      params.push(filters.from);
    }
    if (filters.to) {
      conditions.push('captured_at <= ?');
      params.push(filters.to);
    }
    if (filters.confidence_min !== undefined) {
      conditions.push('confidence >= ?');
      params.push(filters.confidence_min);
    }
    if (filters.confidence_max !== undefined) {
      conditions.push('confidence <= ?');
      params.push(filters.confidence_max);
    }
    if (filters.department) {
      conditions.push('department = ?');
      params.push(filters.department);
    }
    if (filters.q) {
      conditions.push('(concept LIKE ? OR tags LIKE ?)');
      const like = `%${filters.q}%`;
      params.push(like, like);
    }

    const where = conditions.join(' AND ');
    const limit = filters.limit ?? 20;
    const offset = filters.offset ?? 0;

    const countRow = this.db.prepare(
      `SELECT COUNT(*) AS cnt FROM engram_index WHERE ${where}`,
    ).get(...params) as { cnt: number };
    const total = countRow.cnt;

    const engrams = this.db.prepare(
      `SELECT id, user_id AS userId, concept, approval_status AS approvalStatus,
        captured_at AS capturedAt, source_type AS sourceType, confidence, department
      FROM engram_index
      WHERE ${where}
      ORDER BY captured_at DESC
      LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset) as EngramIndexRow[];

    return { engrams, total, limit, offset };
  }

  /** Return distinct departments for the given user's engrams. */
  listDepartments(userId: string): string[] {
    const rows = this.db.prepare(
      `SELECT DISTINCT department FROM engram_index WHERE user_id = ? ORDER BY department`,
    ).all(userId) as { department: string }[];
    return rows.map((r) => r.department);
  }

  // ---------------------------------------------------------------------------
  // Analytics query methods
  // ---------------------------------------------------------------------------

  /** Count engrams grouped by approval_status for a user. */
  getStatusCounts(userId: string): StatusCountRow[] {
    return this.db.prepare(
      `SELECT approval_status, COUNT(*) as count
       FROM engram_index WHERE user_id = ?
       GROUP BY approval_status`,
    ).all(userId) as StatusCountRow[];
  }

  /** Count engrams captured on or after the given date string for a user. */
  countSince(userId: string, sinceDate: string): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) as count FROM engram_index
       WHERE user_id = ? AND captured_at >= ?`,
    ).get(userId, sinceDate) as { count: number };
    return row.count;
  }

  /** Average confidence score for a user's engrams. Returns null when no rows exist. */
  getAverageConfidence(userId: string): number | null {
    const row = this.db.prepare(
      `SELECT AVG(confidence) as avg FROM engram_index WHERE user_id = ?`,
    ).get(userId) as { avg: number | null };
    return row.avg;
  }

  /** Daily capture volume with per-status breakdown since a given date. */
  getDailyVolume(userId: string, sinceDate: string): DailyVolumeRow[] {
    return this.db.prepare(
      `SELECT
        date(captured_at) as date,
        COUNT(*) as count,
        SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END) as approved,
        SUM(CASE WHEN approval_status = 'dismissed' THEN 1 ELSE 0 END) as dismissed,
        SUM(CASE WHEN approval_status = 'pending' THEN 1 ELSE 0 END) as pending
      FROM engram_index
      WHERE user_id = ? AND captured_at >= ?
      GROUP BY date(captured_at)
      ORDER BY date(captured_at) ASC`,
    ).all(userId, sinceDate) as DailyVolumeRow[];
  }

  /** Engram count grouped by source_type for a user. */
  getSourceBreakdown(userId: string): SourceCountRow[] {
    return this.db.prepare(
      `SELECT source_type as source, COUNT(*) as count
       FROM engram_index WHERE user_id = ?
       GROUP BY source_type
       ORDER BY count DESC`,
    ).all(userId) as SourceCountRow[];
  }

  /** All non-empty tag strings for a user (for client-side aggregation). */
  getAllTags(userId: string): string[] {
    const rows = this.db.prepare(
      `SELECT tags FROM engram_index WHERE user_id = ? AND tags != ''`,
    ).all(userId) as Array<{ tags: string }>;
    return rows.map((r) => r.tags);
  }

  /** Confidence distribution across fixed buckets for a user. */
  getConfidenceDistribution(userId: string): ConfidenceBucketRow[] {
    return this.db.prepare(
      `SELECT
        CASE
          WHEN confidence < 0.2 THEN '0.0-0.2'
          WHEN confidence < 0.4 THEN '0.2-0.4'
          WHEN confidence < 0.6 THEN '0.4-0.6'
          WHEN confidence < 0.8 THEN '0.6-0.8'
          ELSE '0.8-1.0'
        END as range,
        COUNT(*) as count
      FROM engram_index WHERE user_id = ?
      GROUP BY range
      ORDER BY range ASC`,
    ).all(userId) as ConfidenceBucketRow[];
  }

  // ---------------------------------------------------------------------------
  // Vault query methods
  // ---------------------------------------------------------------------------

  /** Count engrams grouped by user_id (for deriving personal vaults). */
  getUserCounts(): UserCountRow[] {
    return this.db.prepare(
      `SELECT user_id, COUNT(*) as count FROM engram_index GROUP BY user_id ORDER BY count DESC`,
    ).all() as UserCountRow[];
  }

  /** Count approved engrams grouped by department, excluding 'unassigned'. */
  getDepartmentCounts(): DepartmentCountRow[] {
    return this.db.prepare(
      `SELECT department, COUNT(*) as count
       FROM engram_index
       WHERE department != 'unassigned' AND approval_status = 'approved'
       GROUP BY department ORDER BY count DESC`,
    ).all() as DepartmentCountRow[];
  }

  /** Count all approved engrams (for the org vault). */
  countApproved(): number {
    const row = this.db.prepare(
      `SELECT COUNT(*) as count FROM engram_index WHERE approval_status = 'approved'`,
    ).get() as { count: number };
    return row.count;
  }

  /**
   * Paginated engram query using a dynamic vault filter.
   * The filter provides a WHERE clause fragment and bound params.
   */
  queryVaultEngrams(
    filter: VaultQueryFilter,
    searchTerm: string | undefined,
    limit: number,
    offset: number,
  ): PaginatedEngrams {
    let where = filter.where;
    const params = [...filter.params];

    if (searchTerm) {
      where += ` AND (concept LIKE ? OR tags LIKE ?)`;
      const like = `%${searchTerm}%`;
      params.push(like, like);
    }

    const countRow = this.db.prepare(
      `SELECT COUNT(*) AS cnt FROM engram_index WHERE ${where}`,
    ).get(...params) as { cnt: number };

    const engrams = this.db.prepare(
      `SELECT id, user_id AS userId, concept, approval_status AS approvalStatus,
        captured_at AS capturedAt, source_type AS sourceType, confidence, department
      FROM engram_index
      WHERE ${where}
      ORDER BY captured_at DESC
      LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset) as EngramIndexRow[];

    return { engrams, total: countRow.cnt, limit, offset };
  }

  /**
   * Vault stats: total count, date range, and top tags for a given vault filter.
   */
  getVaultStats(
    filter: VaultQueryFilter,
  ): { count: number; dateRange: DateRangeResult; topTags: Array<{ tag: string; count: number }> } {
    const { where, params } = filter;

    const countRow = this.db.prepare(
      `SELECT COUNT(*) AS cnt FROM engram_index WHERE ${where}`,
    ).get(...params) as { cnt: number };

    const rangeRow = this.db.prepare(
      `SELECT MIN(captured_at) AS earliest, MAX(captured_at) AS latest
       FROM engram_index WHERE ${where}`,
    ).get(...params) as DateRangeResult;

    const tagRows = this.db.prepare(
      `SELECT tags FROM engram_index WHERE ${where} AND tags != ''`,
    ).all(...params) as Array<{ tags: string }>;

    const tagCounts = new Map<string, number>();
    for (const row of tagRows) {
      const tags = row.tags.split(/\s+/).filter(Boolean);
      for (const tag of tags) {
        tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
      }
    }

    const topTags = [...tagCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([tag, count]) => ({ tag, count }));

    return {
      count: countRow.cnt,
      topTags,
      dateRange: {
        earliest: rangeRow.earliest,
        latest: rangeRow.latest,
      },
    };
  }

  /** Aggregate capture stats for a single user (used by user-store sync). */
  getUserStatsData(userId: string): UserEngramStats {
    const row = this.db.prepare(
      `SELECT
        COUNT(*) AS totalCaptures,
        SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END) AS totalApproved,
        SUM(CASE WHEN approval_status = 'dismissed' THEN 1 ELSE 0 END) AS totalDismissed,
        MAX(captured_at) AS lastCaptureAt
       FROM engram_index WHERE user_id = ?`,
    ).get(userId) as UserEngramStats;
    return row;
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
