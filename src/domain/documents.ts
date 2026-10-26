/**
 * Bibliothèque documentaire : PDF émis (verrouillés), pièces jointes,
 * versions. Les liens avec entreprises, projets, devis et factures sont
 * conservés. Les documents verrouillés ne peuvent être ni modifiés ni
 * supprimés (déclencheurs SQLite).
 */
import type { Ctx } from './context';
import type { Db } from '@/lib/db';
import { assert } from './context';
import { logEvent } from './audit';
import { sha256Hex } from '@/lib/crypto';
import { mimeOf, safeFileName } from '@/lib/files';

export type DocType = 'devis' | 'devis_signe' | 'facture' | 'avoir' | 'contrat' | 'piece_jointe' | 'modele' | 'autre';

export const DOC_TYPES: { key: DocType; label: string }[] = [
  { key: 'devis', label: 'Devis' },
  { key: 'devis_signe', label: 'Devis signé' },
  { key: 'facture', label: 'Facture' },
  { key: 'avoir', label: 'Avoir' },
  { key: 'contrat', label: 'Contrat' },
  { key: 'piece_jointe', label: 'Pièce jointe' },
  { key: 'modele', label: 'Modèle' },
  { key: 'autre', label: 'Autre' },
];

export interface DocumentRow {
  id: number;
  title: string;
  doc_type: DocType;
  file_path: string;
  file_name: string;
  mime: string | null;
  size: number;
  sha256: string | null;
  company_id: number | null;
  project_id: number | null;
  quote_id: number | null;
  invoice_id: number | null;
  contract_id: number | null;
  year: number | null;
  version: number;
  parent_document_id: number | null;
  locked: number;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  company_name?: string | null;
  project_name?: string | null;
}

export interface StoreInput {
  title: string;
  docType: DocType;
  fileName: string;
  bytes: Uint8Array;
  folder?: string;
  companyId?: number | null;
  projectId?: number | null;
  quoteId?: number | null;
  invoiceId?: number | null;
  contractId?: number | null;
  locked?: boolean;
  notes?: string | null;
  parentId?: number | null;
  year?: number;
}

/** Enregistre un fichier dans la bibliothèque (jamais d'écrasement : nom unique). */
export async function storeDocument(ctx: Ctx, input: StoreInput): Promise<DocumentRow> {
  const year = input.year ?? new Date().getFullYear();
  const folder = input.folder ?? `documents/${year}/${input.docType}`;
  const base = safeFileName(input.fileName);
  let rel = `${folder}/${base}`;
  let n = 1;
  while (await ctx.files.exists(rel)) {
    const dot = base.lastIndexOf('.');
    rel = dot > 0 ? `${folder}/${base.slice(0, dot)} (${++n})${base.slice(dot)}` : `${folder}/${base} (${++n})`;
  }
  await ctx.files.write(rel, input.bytes);
  const sha = await sha256Hex(input.bytes);
  let version = 1;
  if (input.parentId) {
    const p = await ctx.db.get<{ v: number }>('SELECT MAX(version) AS v FROM documents WHERE id = ? OR parent_document_id = ?', [input.parentId, input.parentId]);
    version = (p?.v ?? 1) + 1;
  }
  const r = await ctx.db.run(
    `INSERT INTO documents (title, doc_type, file_path, file_name, mime, size, sha256, company_id, project_id, quote_id, invoice_id, contract_id, year, version, parent_document_id, locked, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.title, input.docType, rel, rel.split('/').pop()!, mimeOf(base), input.bytes.length, sha, input.companyId ?? null, input.projectId ?? null,
      input.quoteId ?? null, input.invoiceId ?? null, input.contractId ?? null, year, version, input.parentId ?? null, input.locked ? 1 : 0, input.notes ?? null,
    ],
  );
  await logEvent(ctx.db, { entity: 'document', id: r.lastInsertId, action: 'ajout', summary: `Document enregistré : ${input.title}${input.locked ? ' (verrouillé)' : ''}`, companyId: input.companyId ?? null });
  return (await getDocument(ctx.db, r.lastInsertId))!;
}

export async function getDocument(db: Db, id: number): Promise<DocumentRow | undefined> {
  return db.get<DocumentRow>('SELECT * FROM documents WHERE id = ?', [id]);
}

export interface DocumentFilter {
  year?: number;
  companyId?: number;
  projectId?: number;
  quoteId?: number;
  invoiceId?: number;
  docType?: DocType;
  search?: string;
  archived?: boolean;
}

export async function listDocuments(db: Db, f: DocumentFilter = {}): Promise<DocumentRow[]> {
  const where: string[] = [f.archived ? 'd.archived_at IS NOT NULL' : 'd.archived_at IS NULL'];
  const params: any[] = [];
  if (f.year) { where.push('d.year = ?'); params.push(f.year); }
  if (f.companyId != null) { where.push('d.company_id = ?'); params.push(f.companyId); }
  if (f.projectId != null) { where.push('d.project_id = ?'); params.push(f.projectId); }
  if (f.quoteId != null) { where.push('d.quote_id = ?'); params.push(f.quoteId); }
  if (f.invoiceId != null) { where.push('d.invoice_id = ?'); params.push(f.invoiceId); }
  if (f.docType) { where.push('d.doc_type = ?'); params.push(f.docType); }
  if (f.search?.trim()) {
    where.push("(lower(d.title) LIKE ? OR lower(d.file_name) LIKE ? OR lower(COALESCE(c.name,'')) LIKE ? OR lower(COALESCE(d.notes,'')) LIKE ?)");
    const q = `%${f.search.trim().toLowerCase()}%`;
    params.push(q, q, q, q);
  }
  return db.all<DocumentRow>(
    `SELECT d.*, c.name AS company_name, p.name AS project_name FROM documents d
     LEFT JOIN companies c ON c.id = d.company_id LEFT JOIN projects p ON p.id = d.project_id
     WHERE ${where.join(' AND ')} ORDER BY d.created_at DESC, d.id DESC`,
    params,
  );
}

export async function documentYears(db: Db): Promise<number[]> {
  return (await db.all<{ year: number }>('SELECT DISTINCT year FROM documents WHERE year IS NOT NULL ORDER BY year DESC')).map((r) => r.year);
}

export async function documentVersions(db: Db, id: number): Promise<DocumentRow[]> {
  const d = await getDocument(db, id);
  if (!d) return [];
  const root = d.parent_document_id ?? d.id;
  return db.all<DocumentRow>('SELECT * FROM documents WHERE id = ? OR parent_document_id = ? ORDER BY version DESC', [root, root]);
}

export async function updateDocumentInfo(db: Db, id: number, info: { title?: string; notes?: string | null; companyId?: number | null; projectId?: number | null; docType?: DocType }): Promise<void> {
  const d = await getDocument(db, id);
  assert(d, 'Document introuvable.');
  await db.run(
    'UPDATE documents SET title = COALESCE(?, title), notes = ?, company_id = ?, project_id = ?, doc_type = COALESCE(?, doc_type) WHERE id = ?',
    [info.title?.trim() || null, info.notes !== undefined ? info.notes : d.notes, info.companyId !== undefined ? info.companyId : d.company_id, info.projectId !== undefined ? info.projectId : d.project_id, d.locked ? null : info.docType ?? null, id],
  );
}

export async function archiveDocument(db: Db, id: number, archived = true): Promise<void> {
  const d = await getDocument(db, id);
  assert(d, 'Document introuvable.');
  await db.run(`UPDATE documents SET archived_at = ${archived ? "strftime('%Y-%m-%dT%H:%M:%fZ','now')" : 'NULL'} WHERE id = ?`, [id]);
  await logEvent(db, { entity: 'document', id, action: archived ? 'archivage' : 'desarchivage', summary: `Document ${archived ? 'archivé' : 'désarchivé'} : ${d.title}`, companyId: d.company_id });
}

/** Suppression : uniquement les pièces jointes non verrouillées (le fichier reste sur le disque). */
export async function deleteDocument(db: Db, id: number): Promise<void> {
  const d = await getDocument(db, id);
  assert(d, 'Document introuvable.');
  assert(!d.locked, 'Document verrouillé (émis ou signé) : il ne peut pas être supprimé.');
  await db.run('DELETE FROM documents WHERE id = ?', [id]);
  await logEvent(db, { entity: 'document', id, action: 'suppression', summary: `Document retiré de la bibliothèque : ${d.title}`, companyId: d.company_id });
}

/** Vérifie l'intégrité d'un document (empreinte SHA-256 recalculée). */
export async function verifyDocument(ctx: Ctx, id: number): Promise<{ ok: boolean; expected: string | null; actual: string | null; message: string }> {
  const d = await getDocument(ctx.db, id);
  assert(d, 'Document introuvable.');
  let actual: string | null = null;
  try {
    actual = await sha256Hex(await ctx.files.read(d.file_path));
  } catch {
    return { ok: false, expected: d.sha256, actual: null, message: 'Fichier introuvable sur le disque.' };
  }
  const ok = !d.sha256 || d.sha256 === actual;
  return { ok, expected: d.sha256, actual, message: ok ? 'Empreinte conforme : le fichier n\'a pas été modifié.' : 'ATTENTION : le fichier a été modifié depuis son enregistrement.' };
}

/** Recherche d'un PDF par son empreinte (vérification d'un document reçu). */
export async function findByHash(db: Db, sha256: string) {
  const docs = await db.all<DocumentRow>('SELECT * FROM documents WHERE sha256 = ?', [sha256]);
  const sigs = await db.all<any>('SELECT * FROM signatures WHERE original_sha256 = ? OR signed_sha256 = ?', [sha256, sha256]);
  const versions = await db.all<any>('SELECT * FROM quote_versions WHERE pdf_sha256 = ?', [sha256]);
  const invoices = await db.all<any>('SELECT id, number FROM invoices WHERE pdf_sha256 = ?', [sha256]);
  return { docs, sigs, versions, invoices, found: docs.length + sigs.length + versions.length + invoices.length > 0 };
}
