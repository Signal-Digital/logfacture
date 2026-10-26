/**
 * Couche d'accès aux données.
 *
 * Toute la logique métier utilise l'interface `Db`, implémentée :
 *  - dans l'application par le pilote Tauri (SQLite natif via Rust) ;
 *  - dans les tests par le pilote `node:sqlite`.
 *
 * Les accès sont sérialisés (file d'attente) : une transaction ne peut pas être
 * entrelacée avec une autre requête, ce qui garantit l'atomicité des opérations
 * financières (numérotation, paiements, émission).
 */

export type SqlValue = string | number | null | boolean | undefined;
export type Row = Record<string, any>;

export interface ExecResult {
  changes: number;
  lastInsertId: number;
}

export interface Driver {
  select(sql: string, params: SqlValue[]): Promise<Row[]>;
  execute(sql: string, params: SqlValue[]): Promise<ExecResult>;
  batch(sql: string): Promise<void>;
}

export interface Db {
  all<T = Row>(sql: string, params?: SqlValue[]): Promise<T[]>;
  get<T = Row>(sql: string, params?: SqlValue[]): Promise<T | undefined>;
  run(sql: string, params?: SqlValue[]): Promise<ExecResult>;
  batch(sql: string): Promise<void>;
  /** Exécute `fn` dans une transaction (BEGIN IMMEDIATE / COMMIT / ROLLBACK). */
  tx<T>(fn: (db: Db) => Promise<T>): Promise<T>;
}

function normalize(params: SqlValue[] = []): SqlValue[] {
  return params.map((p) => (p === undefined ? null : typeof p === 'boolean' ? (p ? 1 : 0) : p));
}

class Mutex {
  private tail: Promise<void> = Promise.resolve();
  lock(): Promise<() => void> {
    let release!: () => void;
    const next = new Promise<void>((r) => (release = r));
    const prev = this.tail;
    this.tail = prev.then(() => next);
    return prev.then(() => release);
  }
}

export function createDb(driver: Driver): Db {
  const mutex = new Mutex();

  const raw = (inTx: boolean): Db => {
    const guard = async <T>(fn: () => Promise<T>): Promise<T> => {
      if (inTx) return fn();
      const release = await mutex.lock();
      try {
        return await fn();
      } finally {
        release();
      }
    };
    const self: Db = {
      all: (sql, params) => guard(() => driver.select(sql, normalize(params))) as any,
      get: async (sql, params) => (await guard(() => driver.select(sql, normalize(params))))[0] as any,
      run: (sql, params) => guard(() => driver.execute(sql, normalize(params))),
      batch: (sql) => guard(() => driver.batch(sql)),
      tx: async (fn) => {
        if (inTx) return fn(self); // transactions imbriquées : aplaties
        const release = await mutex.lock();
        const inner = raw(true);
        try {
          await driver.batch('BEGIN IMMEDIATE');
          try {
            const result = await fn(inner);
            await driver.batch('COMMIT');
            return result;
          } catch (e) {
            await driver.batch('ROLLBACK').catch(() => undefined);
            throw e;
          }
        } finally {
          release();
        }
      },
    };
    return self;
  };
  return raw(false);
}

/** Construit une clause `IN (?, ?, …)` sûre. */
export function inClause(values: SqlValue[]): string {
  if (values.length === 0) return '(NULL)';
  return `(${values.map(() => '?').join(', ')})`;
}

export function nowIso(): string {
  return new Date().toISOString();
}
