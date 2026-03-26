import Database from 'better-sqlite3';

export class DeltaStore {
  private db: Database.Database;
  private getStmt: Database.Statement;
  private setStmt: Database.Statement;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS delta_links (
        user_id   TEXT NOT NULL,
        source_type TEXT NOT NULL,
        delta_link TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (user_id, source_type)
      )
    `);

    this.getStmt = this.db.prepare(
      'SELECT delta_link FROM delta_links WHERE user_id = ? AND source_type = ?',
    );

    this.setStmt = this.db.prepare(`
      INSERT INTO delta_links (user_id, source_type, delta_link)
      VALUES (?, ?, ?)
      ON CONFLICT (user_id, source_type)
      DO UPDATE SET delta_link = excluded.delta_link, updated_at = datetime('now')
    `);
  }

  getDeltaLink(userId: string, sourceType: string): string | null {
    const row = this.getStmt.get(userId, sourceType) as
      | { delta_link: string }
      | undefined;
    return row?.delta_link ?? null;
  }

  setDeltaLink(userId: string, sourceType: string, deltaLink: string): void {
    this.setStmt.run(userId, sourceType, deltaLink);
  }

  close(): void {
    this.db.close();
  }
}
