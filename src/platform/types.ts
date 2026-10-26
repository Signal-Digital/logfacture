import type { Ctx } from '@/domain/context';

export interface AppInfo {
  data_dir: string;
  files_dir: string;
  db_path: string;
  default_backup_dir: string;
  version: string;
  os: string;
}

export interface PickedFile {
  name: string;
  path: string | null;
  bytes: Uint8Array;
}

export interface BackupInfo {
  path: string;
  size: number;
  created_at: string;
  encrypted: boolean;
  file_count: number;
  sha256: string;
}

export interface BackupListItem {
  path: string;
  name: string;
  size: number;
  modified: string;
  encrypted: boolean;
}

export interface VerifyReport {
  ok: boolean;
  encrypted: boolean;
  created_at: string;
  app_version: string;
  schema_version: number;
  file_count: number;
  integrity_check: string;
  table_counts: Record<string, number>;
  errors: string[];
}

export interface Platform {
  kind: 'tauri' | 'browser';
  ctx: Ctx;
  info: AppInfo;
  pickFile(opts: { title?: string; extensions: string[]; label: string }): Promise<PickedFile | null>;
  /** Boîte « Enregistrer sous » puis écriture. Retourne le chemin choisi. */
  saveFile(defaultName: string, bytes: Uint8Array, filter: { label: string; extensions: string[] }): Promise<string | null>;
  /** Ouvre un fichier géré (chemin relatif) dans l'application par défaut (visionneuse PDF pour imprimer). */
  openManagedFile(rel: string): Promise<void>;
  /** Ouvre le dossier d'un fichier géré dans l'explorateur Windows. */
  revealManagedFile(rel: string): Promise<void>;
  openFolder(absPath: string): Promise<void>;
  openUrl(url: string): Promise<void>;
  pickDirectory(title: string): Promise<string | null>;
  backupCreate(destDir: string, passphrase: string | null, label: string): Promise<BackupInfo>;
  backupVerify(path: string, passphrase: string | null): Promise<VerifyReport>;
  backupRestore(path: string, passphrase: string | null): Promise<{ safety_backup: string; previous_data_dir: string }>;
  backupList(dir: string): Promise<BackupListItem[]>;
  pickBackupFile(): Promise<string | null>;
  converters(): Promise<{ libreoffice: string | null; word: boolean }>;
  notify(title: string, body: string): Promise<void>;
  openSignatureWindow(token: string): Promise<void>;
  copyText(text: string): Promise<void>;
}
