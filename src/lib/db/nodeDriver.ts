/**
 * Pilote `node:sqlite` utilisé par les tests automatisés (et les scripts).
 * Même moteur SQLite que l'application, mêmes migrations.
 */
import type { Driver, Row, SqlValue } from './index';

export function nodeDriver(path = ':memory:'): Driver & { close(): void } {
  // Import dynamique synchrone : ce module n'est jamais chargé dans l'application.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { DatabaseSync } = (globalThis as any).process.getBuiltinModule('node:sqlite');
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  return {
    async select(sql: string, params: SqlValue[]): Promise<Row[]> {
      return db.prepare(sql).all(...(params as any[])) as Row[];
    },
    async execute(sql: string, params: SqlValue[]) {
      const r = db.prepare(sql).run(...(params as any[]));
      return { changes: Number(r.changes), lastInsertId: Number(r.lastInsertRowid) };
    },
    async batch(sql: string) {
      db.exec(sql);
    },
    close() {
      db.close();
    },
  };
}
