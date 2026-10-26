/**
 * Stockage de fichiers de l'application (chemins relatifs au dossier `files`).
 * Implémentations : Tauri (Rust, chemins confinés) et mémoire/disque pour les tests.
 */
export interface FileStore {
  write(rel: string, data: Uint8Array): Promise<void>;
  read(rel: string): Promise<Uint8Array>;
  exists(rel: string): Promise<boolean>;
  remove(rel: string): Promise<void>;
}

export class MemoryFileStore implements FileStore {
  files = new Map<string, Uint8Array>();
  async write(rel: string, data: Uint8Array) {
    if (rel.includes('..') || rel.startsWith('/')) throw new Error('Chemin non autorisé');
    this.files.set(rel, new Uint8Array(data));
  }
  async read(rel: string) {
    const f = this.files.get(rel);
    if (!f) throw new Error(`Fichier introuvable : ${rel}`);
    return new Uint8Array(f);
  }
  async exists(rel: string) {
    return this.files.has(rel);
  }
  async remove(rel: string) {
    this.files.delete(rel);
  }
}

/** Nom de fichier sûr (Windows) à partir d'un libellé. */
export function safeFileName(name: string, maxLen = 120): string {
  const cleaned = name
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/, '');
  return (cleaned || 'document').slice(0, maxLen);
}

export function extensionOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : '';
}

export function mimeOf(name: string): string {
  const ext = extensionOf(name);
  return (
    {
      pdf: 'application/pdf',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      csv: 'text/csv',
      txt: 'text/plain',
      ttf: 'font/ttf',
      otf: 'font/otf',
    } as Record<string, string>
  )[ext] ?? 'application/octet-stream';
}
