/**
 * Catalogue de prestations.
 * Les documents copient les valeurs (désignation, prix, TVA) au moment de
 * l'insertion : modifier un document ne modifie jamais le catalogue, et
 * modifier le catalogue ne modifie jamais les documents existants.
 */
import type { Db } from '@/lib/db';
import { logEvent } from './audit';
import { assert, BusinessError } from './context';

export interface Service {
  id: number;
  name: string;
  description: string | null;
  category: string | null;
  unit_price_cents: number;
  unit: string;
  vat_rate_bp: number;
  duration_label: string | null;
  is_recurring: number;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export type ServiceInput = Partial<Omit<Service, 'id' | 'created_at' | 'updated_at' | 'archived_at'>> & { name: string };

export const UNITS = ['forfait', 'heure', 'jour', 'demi-journée', 'mois', 'trimestre', 'an', 'page', 'article', 'unité', 'mot'];

const FIELDS = ['name', 'description', 'category', 'unit_price_cents', 'unit', 'vat_rate_bp', 'duration_label', 'is_recurring'] as const;

function validate(s: Partial<ServiceInput>) {
  if ('name' in s) assert(String(s.name ?? '').trim(), 'Le nom de la prestation est obligatoire.');
  if (s.unit_price_cents != null && !Number.isSafeInteger(s.unit_price_cents)) throw new BusinessError('Prix invalide.');
  if (s.vat_rate_bp != null && (s.vat_rate_bp < 0 || s.vat_rate_bp > 10000)) throw new BusinessError('Taux de TVA invalide.');
}

export async function createService(db: Db, input: ServiceInput): Promise<number> {
  validate(input);
  const data: Record<string, any> = { unit: 'forfait', vat_rate_bp: 2000, unit_price_cents: 0, is_recurring: 0 };
  for (const f of FIELDS) if (f in input) data[f] = (input as any)[f] ?? data[f] ?? null;
  data.name = String(data.name).trim();
  data.is_recurring = data.is_recurring ? 1 : 0;
  const keys = Object.keys(data);
  const r = await db.run(`INSERT INTO services (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => data[k]));
  await logEvent(db, { entity: 'prestation', id: r.lastInsertId, action: 'creation', summary: `Prestation ajoutée au catalogue : ${data.name}` });
  return r.lastInsertId;
}

export async function updateService(db: Db, id: number, input: Partial<ServiceInput>): Promise<void> {
  validate(input);
  const keys = FIELDS.filter((f) => f in input);
  if (!keys.length) return;
  const values = keys.map((k) => (k === 'is_recurring' ? ((input as any)[k] ? 1 : 0) : (input as any)[k] ?? null));
  await db.run(`UPDATE services SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [...values, id]);
  await logEvent(db, { entity: 'prestation', id, action: 'modification', summary: `Prestation modifiée : ${input.name ?? '#' + id}` });
}

export async function archiveService(db: Db, id: number, archived = true): Promise<void> {
  await db.run(`UPDATE services SET archived_at = ${archived ? "strftime('%Y-%m-%dT%H:%M:%fZ','now')" : 'NULL'} WHERE id = ?`, [id]);
}

export async function duplicateService(db: Db, id: number): Promise<number> {
  const s = await getService(db, id);
  assert(s, 'Prestation introuvable.');
  return createService(db, { ...s, name: `${s.name} (copie)` });
}

export async function getService(db: Db, id: number): Promise<Service | undefined> {
  return db.get<Service>('SELECT * FROM services WHERE id = ?', [id]);
}

export async function listServices(db: Db, opts: { includeArchived?: boolean; search?: string; category?: string } = {}): Promise<Service[]> {
  const where: string[] = [];
  const params: any[] = [];
  if (!opts.includeArchived) where.push('archived_at IS NULL');
  if (opts.category) { where.push('category = ?'); params.push(opts.category); }
  if (opts.search?.trim()) {
    where.push("(lower(name) LIKE ? OR lower(COALESCE(description,'')) LIKE ? OR lower(COALESCE(category,'')) LIKE ?)");
    const q = `%${opts.search.trim().toLowerCase()}%`;
    params.push(q, q, q);
  }
  return db.all<Service>(`SELECT * FROM services ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY category COLLATE NOCASE, name COLLATE NOCASE`, params);
}

export async function listCategories(db: Db): Promise<string[]> {
  const rows = await db.all<{ category: string }>("SELECT DISTINCT category FROM services WHERE category IS NOT NULL AND category <> '' ORDER BY category COLLATE NOCASE");
  return rows.map((r) => r.category);
}

export const DEFAULT_SERVICES: ServiceInput[] = [
  { name: 'Audit SEO', category: 'SEO', description: 'Analyse technique, sémantique et concurrentielle du site, avec plan d\'actions priorisé.', unit_price_cents: 49000, unit: 'forfait', vat_rate_bp: 2000, duration_label: '1 semaine' },
  { name: 'Optimisation Google Business Profile', category: 'Référencement local', description: 'Optimisation complète de la fiche : catégories, description, photos, services, avis.', unit_price_cents: 29000, unit: 'forfait', vat_rate_bp: 2000 },
  { name: 'Création de site Internet', category: 'Site Internet', description: 'Site vitrine responsive, jusqu\'à 5 pages, optimisé pour le référencement.', unit_price_cents: 180000, unit: 'forfait', vat_rate_bp: 2000, duration_label: '4 à 6 semaines' },
  { name: 'Référencement naturel', category: 'SEO', description: 'Optimisations on-page, suivi des positions et rapport mensuel.', unit_price_cents: 45000, unit: 'mois', vat_rate_bp: 2000, is_recurring: 1 },
  { name: 'Rédaction d\'article SEO', category: 'Contenu', description: 'Article optimisé de 1 000 mots environ, recherche de mots-clés incluse.', unit_price_cents: 12000, unit: 'article', vat_rate_bp: 2000 },
  { name: 'Création de contenu', category: 'Contenu', description: 'Création de visuels et publications pour les réseaux sociaux.', unit_price_cents: 6000, unit: 'heure', vat_rate_bp: 2000 },
  { name: 'Maintenance', category: 'Site Internet', description: 'Mises à jour, sauvegardes, surveillance et petites évolutions.', unit_price_cents: 6900, unit: 'mois', vat_rate_bp: 2000, is_recurring: 1 },
  { name: 'Accompagnement mensuel', category: 'Accompagnement', description: 'Suivi stratégique mensuel : point visio, recommandations, pilotage des actions.', unit_price_cents: 39000, unit: 'mois', vat_rate_bp: 2000, is_recurring: 1 },
];
