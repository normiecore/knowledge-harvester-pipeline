import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';

export interface AuditEntry {
  userId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  details?: string;
  ipAddress?: string;
}

export interface AuditRecord {
  id: number;
  timestamp: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string | null;
  details: string | null;
  ipAddress: string | null;
}

export interface AuditQueryFilters {
  userId?: string;
  action?: string;
  resourceType?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export class AuditStore {
  private db: BetterSqlite3.Database;

  constructor(dbPath = 'audit.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');

    this.db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL DEFAULT (datetime('now')),
      user_id TEXT NOT NULL,
      action TEXT NOT NULL,
      resource_type TEXT NOT NULL,
      resource_id TEXT,
      details TEXT,
      ip_address TEXT
    )`);

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_log(timestamp)`);
  }

  log(entry: AuditEntry): void {
    this.db.prepare(
      `INSERT INTO audit_log (user_id, action, resource_type, resource_id, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.userId,
      entry.action,
      entry.resourceType,
      entry.resourceId ?? null,
      entry.details ?? null,
      entry.ipAddress ?? null,
    );
  }

  query(filters: AuditQueryFilters): { entries: AuditRecord[]; total: number } {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (filters.userId) {
      conditions.push('user_id = ?');
      params.push(filters.userId);
    }
    if (filters.action) {
      conditions.push('action = ?');
      params.push(filters.action);
    }
    if (filters.resourceType) {
      conditions.push('resource_type = ?');
      params.push(filters.resourceType);
    }
    if (filters.from) {
      conditions.push('timestamp >= ?');
      params.push(filters.from);
    }
    if (filters.to) {
      conditions.push('timestamp <= ?');
      params.push(filters.to);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters.limit ?? 50;
    const offset = filters.offset ?? 0;

    const countRow = this.db.prepare(
      `SELECT COUNT(*) AS cnt FROM audit_log ${where}`,
    ).get(...params) as { cnt: number };

    const entries = this.db.prepare(
      `SELECT id, timestamp, user_id AS userId, action, resource_type AS resourceType,
              resource_id AS resourceId, details, ip_address AS ipAddress
       FROM audit_log ${where}
       ORDER BY timestamp DESC
       LIMIT ? OFFSET ?`,
    ).all(...params, limit, offset) as AuditRecord[];

    return { entries, total: countRow.cnt };
  }

  getDistinctActions(): string[] {
    const rows = this.db.prepare(
      `SELECT DISTINCT action FROM audit_log ORDER BY action`,
    ).all() as { action: string }[];
    return rows.map((r) => r.action);
  }

  close(): void {
    this.db.close();
  }
}
