import { invoke } from '@tauri-apps/api/core';
import type { Driver, ExecResult, Row, SqlValue } from './index';

/** Pilote SQLite natif (commandes Rust `db_*`). */
export const tauriDriver: Driver = {
  select: (sql: string, params: SqlValue[]) => invoke<Row[]>('db_select', { sql, params }),
  execute: async (sql: string, params: SqlValue[]): Promise<ExecResult> => {
    const r = await invoke<{ changes: number; last_insert_id: number }>('db_execute', { sql, params });
    return { changes: r.changes, lastInsertId: r.last_insert_id };
  },
  batch: (sql: string) => invoke<void>('db_batch', { sql }),
};
