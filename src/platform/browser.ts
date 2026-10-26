/**
 * Mode navigateur (démonstration et tests de l'interface uniquement).
 * Base SQLite en mémoire (sql.js / WebAssembly), fichiers en mémoire :
 * RIEN N'EST CONSERVÉ après fermeture. L'application Windows utilise le
 * pilote natif (src/platform/tauri.ts).
 */
import initSqlJs from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import { createDb, type Driver, type Row } from '@/lib/db';
import { MemoryFileStore } from '@/lib/files';
import type { Platform } from './types';

async function sqlJsDriver(): Promise<Driver> {
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  const db = new SQL.Database();
  db.exec('PRAGMA foreign_keys = ON;');
  return {
    async select(sql, params) {
      const stmt = db.prepare(sql);
      stmt.bind(params as any[]);
      const rows: Row[] = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      stmt.free();
      return rows;
    },
    async execute(sql, params) {
      db.run(sql, params as any[]);
      const changes = db.getRowsModified();
      const id = db.exec('SELECT last_insert_rowid() AS id')[0]?.values[0][0] as number;
      return { changes, lastInsertId: Number(id) };
    },
    async batch(sql) {
      db.exec(sql);
    },
  };
}

function download(name: string, bytes: Uint8Array, mime = 'application/octet-stream') {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export async function createBrowserPlatform(): Promise<Platform> {
  const db = createDb(await sqlJsDriver());
  const files = new MemoryFileStore();
  const unavailable = () => Promise.reject(new Error("Fonction disponible uniquement dans l'application Windows."));
  return {
    kind: 'browser',
    ctx: { db, files },
    info: { data_dir: '(mémoire du navigateur)', files_dir: '(mémoire)', db_path: '(mémoire)', default_backup_dir: '', version: '0.1.0', os: 'navigateur' },
    pickFile({ extensions }) {
      return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = extensions.map((e) => '.' + e).join(',');
        input.onchange = async () => {
          const f = input.files?.[0];
          if (!f) return resolve(null);
          resolve({ name: f.name, path: null, bytes: new Uint8Array(await f.arrayBuffer()) });
        };
        input.click();
      });
    },
    async saveFile(name, bytes) {
      download(name, bytes);
      return name;
    },
    async openManagedFile(rel) {
      const bytes = await files.read(rel);
      const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: rel.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream' }));
      window.open(url, '_blank');
    },
    revealManagedFile: unavailable,
    openFolder: unavailable,
    async openUrl(url) {
      window.open(url, '_blank');
    },
    pickDirectory: async () => null,
    backupCreate: unavailable,
    backupVerify: unavailable,
    backupRestore: unavailable,
    backupList: async () => [],
    pickBackupFile: async () => null,
    converters: async () => ({ libreoffice: null, word: false }),
    async notify(title, body) {
      console.info(`[notification] ${title} — ${body}`);
    },
    async openSignatureWindow(token) {
      // Mode navigateur : la base en mémoire n'est pas partagée entre onglets,
      // l'écran de signature s'ouvre donc dans la même fenêtre.
      location.hash = `#/signature/${token}`;
    },
    copyText: (t) => navigator.clipboard.writeText(t),
  };
}
