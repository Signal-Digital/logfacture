import type { Db } from '@/lib/db';
import type { FileStore } from '@/lib/files';

/** Contexte partagé par tous les services métier. */
export interface Ctx {
  db: Db;
  files: FileStore;
  /** Conversion DOCX → PDF (LibreOffice ou Word) ; absente si aucun convertisseur. */
  convertDocx?: (docx: Uint8Array) => Promise<Uint8Array>;
}

/** Erreur métier : message destiné à l'utilisateur, sans détail technique. */
export class BusinessError extends Error {
  constructor(message: string, public readonly details?: string[]) {
    super(message);
    this.name = 'BusinessError';
  }
}

export function assert(cond: unknown, message: string): asserts cond {
  if (!cond) throw new BusinessError(message);
}
