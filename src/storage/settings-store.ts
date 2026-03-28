import Database from 'better-sqlite3';
import type BetterSqlite3 from 'better-sqlite3';

export interface UserSettings {
  userId: string;
  notificationNewEngram: number;
  notificationSound: number;
  autoApproveConfidence: number;
  theme: string;
  itemsPerPage: number;
  updatedAt: string;
}

const DEFAULTS: Omit<UserSettings, 'userId' | 'updatedAt'> = {
  notificationNewEngram: 1,
  notificationSound: 0,
  autoApproveConfidence: 0,
  theme: 'dark',
  itemsPerPage: 20,
};

export class SettingsStore {
  private db: BetterSqlite3.Database;

  constructor(dbPath = 'settings.db') {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('busy_timeout = 5000');

    this.db.exec(`CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      notification_new_engram INTEGER DEFAULT 1,
      notification_sound INTEGER DEFAULT 0,
      auto_approve_confidence REAL DEFAULT 0,
      theme TEXT DEFAULT 'dark',
      items_per_page INTEGER DEFAULT 20,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
  }

  get(userId: string): UserSettings {
    const row = this.db.prepare(
      `SELECT user_id AS userId, notification_new_engram AS notificationNewEngram,
              notification_sound AS notificationSound,
              auto_approve_confidence AS autoApproveConfidence,
              theme, items_per_page AS itemsPerPage,
              updated_at AS updatedAt
       FROM user_settings WHERE user_id = ?`,
    ).get(userId) as UserSettings | undefined;

    if (row) return row;

    return {
      userId,
      ...DEFAULTS,
      updatedAt: new Date().toISOString(),
    };
  }

  update(userId: string, settings: Partial<Omit<UserSettings, 'userId' | 'updatedAt'>>): UserSettings {
    const current = this.get(userId);

    const merged = {
      notificationNewEngram: settings.notificationNewEngram ?? current.notificationNewEngram,
      notificationSound: settings.notificationSound ?? current.notificationSound,
      autoApproveConfidence: settings.autoApproveConfidence ?? current.autoApproveConfidence,
      theme: settings.theme ?? current.theme,
      itemsPerPage: settings.itemsPerPage ?? current.itemsPerPage,
    };

    this.db.prepare(
      `INSERT INTO user_settings (user_id, notification_new_engram, notification_sound,
        auto_approve_confidence, theme, items_per_page, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
       ON CONFLICT (user_id) DO UPDATE SET
         notification_new_engram = excluded.notification_new_engram,
         notification_sound = excluded.notification_sound,
         auto_approve_confidence = excluded.auto_approve_confidence,
         theme = excluded.theme,
         items_per_page = excluded.items_per_page,
         updated_at = datetime('now')`,
    ).run(
      userId,
      merged.notificationNewEngram,
      merged.notificationSound,
      merged.autoApproveConfidence,
      merged.theme,
      merged.itemsPerPage,
    );

    return this.get(userId);
  }

  getAutoApproveThreshold(userId: string): number {
    const row = this.db.prepare(
      `SELECT auto_approve_confidence FROM user_settings WHERE user_id = ?`,
    ).get(userId) as { auto_approve_confidence: number } | undefined;

    return row?.auto_approve_confidence ?? 0;
  }

  close(): void {
    this.db.close();
  }
}
