import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';

export interface UserRow {
  id: string;
  email: string;
  displayName: string;
  department: string;
  role: string;
  harvestingEnabled: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserStatsRow {
  userId: string;
  totalCaptures: number;
  totalApproved: number;
  totalDismissed: number;
  lastCaptureAt: string | null;
}

export interface UserWithStats extends UserRow {
  stats: UserStatsRow;
}

export class UserStore {
  private db: BetterSqlite3.Database;

  constructor(dbPath = 'user-store.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');

    this.db.exec(`CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL DEFAULT '',
      display_name TEXT NOT NULL DEFAULT '',
      department TEXT NOT NULL DEFAULT '',
      role TEXT NOT NULL DEFAULT 'user',
      harvesting_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);

    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_users_department ON users (department)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_users_role ON users (role)`);

    this.db.exec(`CREATE TABLE IF NOT EXISTS user_stats (
      user_id TEXT PRIMARY KEY,
      total_captures INTEGER NOT NULL DEFAULT 0,
      total_approved INTEGER NOT NULL DEFAULT 0,
      total_dismissed INTEGER NOT NULL DEFAULT 0,
      last_capture_at TEXT
    )`);
  }

  getAll(page = 1, limit = 20, department?: string): { users: UserRow[]; total: number } {
    const offset = (page - 1) * limit;

    if (department) {
      const total = (this.db.prepare(
        `SELECT COUNT(*) as cnt FROM users WHERE department = ?`,
      ).get(department) as { cnt: number }).cnt;

      const users = this.db.prepare(
        `SELECT id, email, display_name AS displayName, department, role,
                harvesting_enabled AS harvestingEnabled,
                created_at AS createdAt, updated_at AS updatedAt
         FROM users WHERE department = ?
         ORDER BY display_name ASC
         LIMIT ? OFFSET ?`,
      ).all(department, limit, offset) as UserRow[];

      return { users, total };
    }

    const total = (this.db.prepare(
      `SELECT COUNT(*) as cnt FROM users`,
    ).get() as { cnt: number }).cnt;

    const users = this.db.prepare(
      `SELECT id, email, display_name AS displayName, department, role,
              harvesting_enabled AS harvestingEnabled,
              created_at AS createdAt, updated_at AS updatedAt
       FROM users
       ORDER BY display_name ASC
       LIMIT ? OFFSET ?`,
    ).all(limit, offset) as UserRow[];

    return { users, total };
  }

  getById(id: string): UserRow | undefined {
    return this.db.prepare(
      `SELECT id, email, display_name AS displayName, department, role,
              harvesting_enabled AS harvestingEnabled,
              created_at AS createdAt, updated_at AS updatedAt
       FROM users WHERE id = ?`,
    ).get(id) as UserRow | undefined;
  }

  upsert(user: { id: string; email?: string; displayName?: string; department?: string }): void {
    this.db.prepare(
      `INSERT INTO users (id, email, display_name, department)
       VALUES (?, ?, ?, ?)
       ON CONFLICT (id) DO UPDATE SET
         email = COALESCE(excluded.email, users.email),
         display_name = COALESCE(excluded.display_name, users.display_name),
         department = COALESCE(excluded.department, users.department),
         updated_at = datetime('now')`,
    ).run(user.id, user.email ?? '', user.displayName ?? '', user.department ?? '');
  }

  updateRole(id: string, role: string): void {
    this.db.prepare(
      `UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(role, id);
  }

  toggleHarvesting(id: string, enabled: boolean): void {
    this.db.prepare(
      `UPDATE users SET harvesting_enabled = ?, updated_at = datetime('now') WHERE id = ?`,
    ).run(enabled ? 1 : 0, id);
  }

  getStats(userId: string): UserStatsRow {
    const row = this.db.prepare(
      `SELECT user_id AS userId, total_captures AS totalCaptures,
              total_approved AS totalApproved, total_dismissed AS totalDismissed,
              last_capture_at AS lastCaptureAt
       FROM user_stats WHERE user_id = ?`,
    ).get(userId) as UserStatsRow | undefined;

    return row ?? { userId, totalCaptures: 0, totalApproved: 0, totalDismissed: 0, lastCaptureAt: null };
  }

  getAllWithStats(page = 1, limit = 20, department?: string): { users: UserWithStats[]; total: number } {
    const { users, total } = this.getAll(page, limit, department);
    const withStats = users.map((user) => ({
      ...user,
      stats: this.getStats(user.id),
    }));
    return { users: withStats, total };
  }

  /**
   * Recalculate stats for a user from the engram_index database.
   * Accepts an external better-sqlite3 database handle pointing to engram-index.db.
   */
  updateStats(userId: string, engramDb: BetterSqlite3.Database): void {
    const row = engramDb.prepare(
      `SELECT
        COUNT(*) AS totalCaptures,
        SUM(CASE WHEN approval_status = 'approved' THEN 1 ELSE 0 END) AS totalApproved,
        SUM(CASE WHEN approval_status = 'dismissed' THEN 1 ELSE 0 END) AS totalDismissed,
        MAX(captured_at) AS lastCaptureAt
       FROM engram_index WHERE user_id = ?`,
    ).get(userId) as { totalCaptures: number; totalApproved: number; totalDismissed: number; lastCaptureAt: string | null };

    this.db.prepare(
      `INSERT INTO user_stats (user_id, total_captures, total_approved, total_dismissed, last_capture_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET
         total_captures = excluded.total_captures,
         total_approved = excluded.total_approved,
         total_dismissed = excluded.total_dismissed,
         last_capture_at = excluded.last_capture_at`,
    ).run(userId, row.totalCaptures, row.totalApproved, row.totalDismissed, row.lastCaptureAt);
  }

  getDepartments(): Array<{ department: string; count: number }> {
    return this.db.prepare(
      `SELECT department, COUNT(*) as count
       FROM users
       WHERE department != ''
       GROUP BY department
       ORDER BY count DESC`,
    ).all() as Array<{ department: string; count: number }>;
  }

  search(query: string, page = 1, limit = 20): { users: UserRow[]; total: number } {
    const pattern = `%${query}%`;
    const offset = (page - 1) * limit;

    const total = (this.db.prepare(
      `SELECT COUNT(*) as cnt FROM users
       WHERE display_name LIKE ? OR email LIKE ?`,
    ).get(pattern, pattern) as { cnt: number }).cnt;

    const users = this.db.prepare(
      `SELECT id, email, display_name AS displayName, department, role,
              harvesting_enabled AS harvestingEnabled,
              created_at AS createdAt, updated_at AS updatedAt
       FROM users
       WHERE display_name LIKE ? OR email LIKE ?
       ORDER BY display_name ASC
       LIMIT ? OFFSET ?`,
    ).all(pattern, pattern, limit, offset) as UserRow[];

    return { users, total };
  }

  close(): void {
    this.db.close();
  }
}
