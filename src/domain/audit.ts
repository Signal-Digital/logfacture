/** Journal des événements (insertion seule, protégé par déclencheurs SQLite). */
import type { Db } from '@/lib/db';

export type EntityType =
  | 'entreprise' | 'contact' | 'opportunite' | 'activite' | 'prestation' | 'projet' | 'contrat'
  | 'devis' | 'facture' | 'paiement' | 'signature' | 'document' | 'modele' | 'parametres'
  | 'sauvegarde' | 'securite' | 'email';

export async function logEvent(
  db: Db,
  e: { entity: EntityType; id?: number | null; action: string; summary: string; details?: unknown; companyId?: number | null },
): Promise<void> {
  await db.run(
    'INSERT INTO audit_log (entity_type, entity_id, action, summary, details, company_id) VALUES (?, ?, ?, ?, ?, ?)',
    [e.entity, e.id ?? null, e.action, e.summary, e.details === undefined ? null : JSON.stringify(e.details), e.companyId ?? null],
  );
}

export interface AuditRow {
  id: number;
  at: string;
  entity_type: EntityType;
  entity_id: number | null;
  action: string;
  summary: string;
  details: string | null;
  company_id: number | null;
}

export async function listEvents(db: Db, filter: { entity?: EntityType; id?: number; companyId?: number; limit?: number } = {}): Promise<AuditRow[]> {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (filter.entity) { where.push('entity_type = ?'); params.push(filter.entity); }
  if (filter.id != null) { where.push('entity_id = ?'); params.push(filter.id); }
  if (filter.companyId != null) { where.push('company_id = ?'); params.push(filter.companyId); }
  params.push(filter.limit ?? 200);
  return db.all<AuditRow>(
    `SELECT * FROM audit_log ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY at DESC, id DESC LIMIT ?`,
    params,
  );
}
