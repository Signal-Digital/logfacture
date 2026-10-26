/**
 * Entreprises (prospects et clients) et contacts.
 *
 * Une entreprise a un seul enregistrement tout au long de la relation :
 * prospect → client → ancien client. La conversion change `kind`, sans
 * duplication, et conserve tout l'historique.
 */
import type { Db } from '@/lib/db';
import { inClause } from '@/lib/db';
import { logEvent } from './audit';
import { BusinessError, assert } from './context';
import { csvToObjects, toCsv } from '@/lib/csv';
import { parseEuros } from '@/lib/money';

export type CompanyKind = 'prospect' | 'client' | 'ancien_client' | 'partenaire';

export const COMMERCIAL_STATUSES: { key: string; label: string }[] = [
  { key: 'nouveau', label: 'Nouveau' },
  { key: 'a_qualifier', label: 'À qualifier' },
  { key: 'a_contacter', label: 'À contacter' },
  { key: 'contacte', label: 'Contact établi' },
  { key: 'interesse', label: 'Intéressé' },
  { key: 'a_recontacter', label: 'À recontacter' },
  { key: 'non_interesse', label: 'Non intéressé' },
  { key: 'client', label: 'Client' },
];

export const SOURCES = [
  'Prospection téléphonique', 'Prospection terrain', 'Google Maps', 'Recommandation', 'Site Internet',
  'Réseaux sociaux', 'LinkedIn', 'Salon / événement', 'Email', 'Autre',
];

export interface Company {
  id: number;
  name: string;
  kind: CompanyKind;
  is_individual: number;
  legal_form: string | null;
  siren: string | null;
  siret: string | null;
  vat_number: string | null;
  sector: string | null;
  address_line1: string | null;
  address_line2: string | null;
  postal_code: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  gbp_url: string | null;
  source: string | null;
  commercial_status: string;
  potential_cents: number;
  notes: string | null;
  next_action: string | null;
  next_action_date: string | null;
  became_client_at: string | null;
  merged_into_id: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Contact {
  id: number;
  company_id: number | null;
  first_name: string | null;
  last_name: string;
  job_title: string | null;
  email: string | null;
  phone: string | null;
  mobile: string | null;
  is_primary: number;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export type CompanyInput = Partial<Omit<Company, 'id' | 'created_at' | 'updated_at' | 'merged_into_id'>> & { name: string };
export type ContactInput = Partial<Omit<Contact, 'id' | 'created_at' | 'updated_at'>>;

const COMPANY_FIELDS = [
  'name', 'kind', 'is_individual', 'legal_form', 'siren', 'siret', 'vat_number', 'sector', 'address_line1',
  'address_line2', 'postal_code', 'city', 'country', 'phone', 'email', 'website', 'gbp_url', 'source',
  'commercial_status', 'potential_cents', 'notes', 'next_action', 'next_action_date',
] as const;

const CONTACT_FIELDS = ['company_id', 'first_name', 'last_name', 'job_title', 'email', 'phone', 'mobile', 'is_primary', 'notes'] as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function clean(v: unknown): any {
  if (typeof v === 'string') {
    const t = v.trim();
    return t === '' ? null : t;
  }
  return v;
}

export function validateCompany(input: Partial<CompanyInput>): string[] {
  const errors: string[] = [];
  if (input.name !== undefined && !String(input.name).trim()) errors.push("Le nom de l'entreprise est obligatoire.");
  if (input.email && !EMAIL_RE.test(input.email.trim())) errors.push('Adresse email invalide.');
  if (input.siret && !/^\d{14}$/.test(input.siret.replace(/\s/g, ''))) errors.push('Le SIRET doit comporter 14 chiffres.');
  if (input.siren && !/^\d{9}$/.test(input.siren.replace(/\s/g, ''))) errors.push('Le SIREN doit comporter 9 chiffres.');
  if (input.website && /\s/.test(input.website.trim())) errors.push('Adresse du site Internet invalide.');
  if (input.potential_cents != null && (!Number.isSafeInteger(input.potential_cents) || input.potential_cents < 0)) {
    errors.push('Potentiel commercial invalide.');
  }
  if (input.next_action_date && !/^\d{4}-\d{2}-\d{2}/.test(input.next_action_date)) errors.push('Date de relance invalide.');
  return errors;
}

function normalizeCompany(input: Partial<CompanyInput>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const f of COMPANY_FIELDS) {
    if (f in input) out[f] = clean((input as any)[f]);
  }
  if (out.siret) out.siret = String(out.siret).replace(/\s/g, '');
  if (out.siren) out.siren = String(out.siren).replace(/\s/g, '');
  if (out.siret && !out.siren) out.siren = out.siret.slice(0, 9);
  if (out.email) out.email = String(out.email).toLowerCase();
  if (out.website && !/^https?:\/\//i.test(out.website)) out.website = 'https://' + out.website;
  if ('is_individual' in out) out.is_individual = out.is_individual ? 1 : 0;
  if ('potential_cents' in out && out.potential_cents == null) out.potential_cents = 0;
  if ('commercial_status' in out && out.commercial_status == null) out.commercial_status = 'nouveau';
  return out;
}

export async function createCompany(db: Db, input: CompanyInput): Promise<number> {
  const errors = validateCompany(input);
  if (errors.length) throw new BusinessError(errors[0], errors);
  const data = normalizeCompany({ kind: 'prospect', ...input });
  const keys = Object.keys(data);
  return db.tx(async (t) => {
    const r = await t.run(
      `INSERT INTO companies (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
      keys.map((k) => data[k]),
    );
    const id = r.lastInsertId;
    if (data.kind === 'client') await t.run("UPDATE companies SET became_client_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [id]);
    await logEvent(t, { entity: 'entreprise', id, action: 'creation', summary: `${data.kind === 'client' ? 'Client' : 'Prospect'} créé : ${data.name}`, companyId: id });
    return id;
  });
}

export async function updateCompany(db: Db, id: number, input: Partial<CompanyInput>): Promise<void> {
  const errors = validateCompany(input);
  if (errors.length) throw new BusinessError(errors[0], errors);
  const data = normalizeCompany(input);
  delete data.kind; // le changement de type passe par convertToClient / setKind
  const keys = Object.keys(data);
  if (keys.length === 0) return;
  await db.tx(async (t) => {
    const before = await getCompany(t, id);
    assert(before, 'Entreprise introuvable.');
    await t.run(
      `UPDATE companies SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      [...keys.map((k) => data[k]), id],
    );
    const changed = keys.filter((k) => (before as any)[k] !== data[k]);
    if (changed.length) {
      await logEvent(t, { entity: 'entreprise', id, action: 'modification', summary: `Fiche modifiée (${changed.join(', ')})`, companyId: id });
    }
  });
}

export async function getCompany(db: Db, id: number): Promise<Company | undefined> {
  return db.get<Company>('SELECT * FROM companies WHERE id = ?', [id]);
}

export interface CompanyFilter {
  kind?: CompanyKind | CompanyKind[];
  search?: string;
  status?: string;
  source?: string;
  sector?: string;
  city?: string;
  archived?: boolean;
  followUp?: 'today' | 'late' | 'week';
  orderBy?: 'name' | 'created_at' | 'next_action_date' | 'potential_cents' | 'updated_at';
  limit?: number;
}

export interface CompanyListRow extends Company {
  contact_name: string | null;
  open_opportunities: number;
  invoiced_cents: number;
  due_cents: number;
}

export async function listCompanies(db: Db, f: CompanyFilter = {}): Promise<CompanyListRow[]> {
  const where: string[] = ['c.merged_into_id IS NULL'];
  const params: any[] = [];
  if (f.kind) {
    const kinds = Array.isArray(f.kind) ? f.kind : [f.kind];
    where.push(`c.kind IN ${inClause(kinds)}`);
    params.push(...kinds);
  }
  where.push(f.archived ? 'c.archived_at IS NOT NULL' : 'c.archived_at IS NULL');
  if (f.search?.trim()) {
    const q = `%${f.search.trim().toLowerCase()}%`;
    where.push(`(lower(c.name) LIKE ? OR lower(COALESCE(c.email,'')) LIKE ? OR COALESCE(c.phone,'') LIKE ? OR lower(COALESCE(c.city,'')) LIKE ?
      OR EXISTS (SELECT 1 FROM contacts k WHERE k.company_id = c.id AND lower(COALESCE(k.first_name,'') || ' ' || k.last_name || ' ' || COALESCE(k.email,'')) LIKE ?))`);
    params.push(q, q, `%${f.search.trim()}%`, q, q);
  }
  if (f.status) { where.push('c.commercial_status = ?'); params.push(f.status); }
  if (f.source) { where.push('c.source = ?'); params.push(f.source); }
  if (f.sector) { where.push('c.sector = ?'); params.push(f.sector); }
  if (f.city) { where.push('lower(c.city) = lower(?)'); params.push(f.city); }
  if (f.followUp === 'today') where.push("c.next_action_date = date('now','localtime')");
  if (f.followUp === 'late') where.push("c.next_action_date < date('now','localtime')");
  if (f.followUp === 'week') where.push("c.next_action_date BETWEEN date('now','localtime') AND date('now','localtime','+7 days')");
  const order = {
    name: 'c.name COLLATE NOCASE ASC',
    created_at: 'c.created_at DESC',
    next_action_date: "CASE WHEN c.next_action_date IS NULL THEN 1 ELSE 0 END, c.next_action_date ASC",
    potential_cents: 'c.potential_cents DESC',
    updated_at: 'c.updated_at DESC',
  }[f.orderBy ?? 'name'];
  params.push(f.limit ?? 5000);
  return db.all<CompanyListRow>(
    `SELECT c.*,
      (SELECT TRIM(COALESCE(k.first_name,'') || ' ' || k.last_name) FROM contacts k WHERE k.company_id = c.id AND k.archived_at IS NULL ORDER BY k.is_primary DESC, k.id LIMIT 1) AS contact_name,
      (SELECT COUNT(*) FROM opportunities o WHERE o.company_id = c.id AND o.status = 'open' AND o.archived_at IS NULL) AS open_opportunities,
      COALESCE((SELECT SUM(CASE WHEN i.kind = 'avoir' THEN -i.total_ttc_cents ELSE i.total_ttc_cents END) FROM invoices i WHERE i.company_id = c.id AND i.status <> 'brouillon'), 0) AS invoiced_cents,
      0 AS due_cents
     FROM companies c WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT ?`,
    params,
  );
}

export async function archiveCompany(db: Db, id: number, archived = true): Promise<void> {
  await db.tx(async (t) => {
    const c = await getCompany(t, id);
    assert(c, 'Entreprise introuvable.');
    await t.run(
      `UPDATE companies SET archived_at = ${archived ? "strftime('%Y-%m-%dT%H:%M:%fZ','now')" : 'NULL'}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      [id],
    );
    await logEvent(t, { entity: 'entreprise', id, action: archived ? 'archivage' : 'desarchivage', summary: `${c.name} ${archived ? 'archivée' : 'restaurée'} (historique et documents conservés)`, companyId: id });
  });
}

/** Prospect → client, sans recréer la fiche. Idempotent. */
export async function convertToClient(db: Db, id: number, reason = 'Conversion manuelle'): Promise<boolean> {
  return db.tx(async (t) => {
    const c = await getCompany(t, id);
    assert(c, 'Entreprise introuvable.');
    if (c.kind === 'client') return false;
    await t.run(
      `UPDATE companies SET kind = 'client', commercial_status = 'client',
         became_client_at = COALESCE(became_client_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
         archived_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      [id],
    );
    await logEvent(t, { entity: 'entreprise', id, action: 'conversion_client', summary: `${c.name} devient client (${reason})`, companyId: id });
    return true;
  });
}

export async function setCompanyKind(db: Db, id: number, kind: CompanyKind): Promise<void> {
  if (kind === 'client') {
    await convertToClient(db, id);
    return;
  }
  await db.tx(async (t) => {
    const c = await getCompany(t, id);
    assert(c, 'Entreprise introuvable.');
    await t.run("UPDATE companies SET kind = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [kind, id]);
    await logEvent(t, { entity: 'entreprise', id, action: 'changement_type', summary: `Type modifié : ${c.kind} → ${kind}`, companyId: id });
  });
}

// ---------- Contacts ----------

export function validateContact(input: ContactInput): string[] {
  const errors: string[] = [];
  if (!(input.last_name ?? '').trim() && !(input.first_name ?? '').trim()) errors.push('Le nom du contact est obligatoire.');
  if (input.email && !EMAIL_RE.test(input.email.trim())) errors.push('Adresse email du contact invalide.');
  return errors;
}

export async function createContact(db: Db, input: ContactInput): Promise<number> {
  const errors = validateContact(input);
  if (errors.length) throw new BusinessError(errors[0], errors);
  const data: Record<string, any> = {};
  for (const f of CONTACT_FIELDS) if (f in input) data[f] = clean((input as any)[f]);
  data.last_name = data.last_name ?? '';
  data.is_primary = data.is_primary ? 1 : 0;
  if (data.email) data.email = String(data.email).toLowerCase();
  return db.tx(async (t) => {
    if (data.company_id) {
      const hasPrimary = await t.get("SELECT 1 FROM contacts WHERE company_id = ? AND is_primary = 1 AND archived_at IS NULL", [data.company_id]);
      if (!hasPrimary) data.is_primary = 1;
      else if (data.is_primary) await t.run('UPDATE contacts SET is_primary = 0 WHERE company_id = ?', [data.company_id]);
    }
    const keys = Object.keys(data);
    const r = await t.run(`INSERT INTO contacts (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => data[k]));
    await logEvent(t, { entity: 'contact', id: r.lastInsertId, action: 'creation', summary: `Contact ajouté : ${[data.first_name, data.last_name].filter(Boolean).join(' ')}`, companyId: data.company_id });
    return r.lastInsertId;
  });
}

export async function updateContact(db: Db, id: number, input: ContactInput): Promise<void> {
  const current = await db.get<Contact>('SELECT * FROM contacts WHERE id = ?', [id]);
  assert(current, 'Contact introuvable.');
  const errors = validateContact({ ...current, ...input });
  if (errors.length) throw new BusinessError(errors[0], errors);
  const data: Record<string, any> = {};
  for (const f of CONTACT_FIELDS) if (f in input) data[f] = clean((input as any)[f]);
  if ('is_primary' in data) data.is_primary = data.is_primary ? 1 : 0;
  if (data.email) data.email = String(data.email).toLowerCase();
  const keys = Object.keys(data);
  if (!keys.length) return;
  await db.tx(async (t) => {
    if (data.is_primary && current.company_id) await t.run('UPDATE contacts SET is_primary = 0 WHERE company_id = ?', [current.company_id]);
    await t.run(`UPDATE contacts SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [...keys.map((k) => data[k]), id]);
    await logEvent(t, { entity: 'contact', id, action: 'modification', summary: 'Contact modifié', companyId: current.company_id });
  });
}

export async function archiveContact(db: Db, id: number): Promise<void> {
  const c = await db.get<Contact>('SELECT * FROM contacts WHERE id = ?', [id]);
  assert(c, 'Contact introuvable.');
  await db.run("UPDATE contacts SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), is_primary = 0 WHERE id = ?", [id]);
  await logEvent(db, { entity: 'contact', id, action: 'archivage', summary: 'Contact archivé', companyId: c.company_id });
}

export async function listContacts(db: Db, opts: { companyId?: number; search?: string; includeArchived?: boolean } = {}): Promise<(Contact & { company_name: string | null })[]> {
  const where: string[] = [];
  const params: any[] = [];
  if (opts.companyId != null) { where.push('k.company_id = ?'); params.push(opts.companyId); }
  if (!opts.includeArchived) where.push('k.archived_at IS NULL');
  if (opts.search?.trim()) {
    const q = `%${opts.search.trim().toLowerCase()}%`;
    where.push("lower(COALESCE(k.first_name,'') || ' ' || k.last_name || ' ' || COALESCE(k.email,'') || ' ' || COALESCE(c.name,'')) LIKE ?");
    params.push(q);
  }
  return db.all(
    `SELECT k.*, c.name AS company_name FROM contacts k LEFT JOIN companies c ON c.id = k.company_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY k.is_primary DESC, k.last_name COLLATE NOCASE`,
    params,
  );
}

export function contactFullName(c: Pick<Contact, 'first_name' | 'last_name'> | null | undefined): string {
  if (!c) return '';
  return [c.first_name, c.last_name].filter((x) => x && x.trim()).join(' ');
}

export async function primaryContact(db: Db, companyId: number): Promise<Contact | undefined> {
  return db.get<Contact>('SELECT * FROM contacts WHERE company_id = ? AND archived_at IS NULL ORDER BY is_primary DESC, id LIMIT 1', [companyId]);
}

// ---------- Doublons ----------

export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(sarl|sas|sasu|eurl|sa|sci|ei|eirl|snc|ets|etablissements|societe|ste|la|le|les|l|de|du|des|et)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizePhone(p: string | null | undefined): string {
  if (!p) return '';
  let d = p.replace(/\D/g, '');
  if (d.startsWith('0033')) d = '0' + d.slice(4);
  else if (d.startsWith('33') && d.length === 11) d = '0' + d.slice(2);
  return d;
}

export function domainOf(s: string | null | undefined): string {
  if (!s) return '';
  const v = s.toLowerCase().trim();
  const at = v.lastIndexOf('@');
  const host = at >= 0 ? v.slice(at + 1) : v.replace(/^https?:\/\//, '').split('/')[0];
  return host.replace(/^www\./, '');
}

const GENERIC_DOMAINS = new Set(['gmail.com', 'hotmail.com', 'hotmail.fr', 'outlook.com', 'outlook.fr', 'yahoo.fr', 'yahoo.com', 'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'laposte.net', 'live.fr', 'icloud.com', 'gmx.fr', 'bbox.fr', 'neuf.fr']);

export interface DuplicateMatch {
  company: Company;
  reasons: string[];
  score: number;
}

/** Recherche les doublons potentiels d'une fiche (nom, email, téléphone, site, SIRET). */
export async function findDuplicates(db: Db, candidate: Partial<CompanyInput>, excludeId?: number): Promise<DuplicateMatch[]> {
  const all = await db.all<Company>('SELECT * FROM companies WHERE merged_into_id IS NULL AND (? IS NULL OR id <> ?)', [excludeId ?? null, excludeId ?? null]);
  const name = candidate.name ? normalizeName(candidate.name) : '';
  const phone = normalizePhone(candidate.phone);
  const emailDomain = domainOf(candidate.email);
  const webDomain = domainOf(candidate.website);
  const siret = candidate.siret?.replace(/\s/g, '');
  const out: DuplicateMatch[] = [];
  for (const c of all) {
    const reasons: string[] = [];
    let score = 0;
    if (siret && c.siret && siret === c.siret) { reasons.push('Même SIRET'); score += 100; }
    else if (siret && c.siren && siret.slice(0, 9) === c.siren) { reasons.push('Même SIREN'); score += 60; }
    if (name && normalizeName(c.name) === name) { reasons.push('Même nom'); score += 60; }
    else if (name.length >= 5 && normalizeName(c.name).length >= 5 && (normalizeName(c.name).includes(name) || name.includes(normalizeName(c.name)))) {
      reasons.push('Nom similaire'); score += 25;
    }
    if (candidate.email && c.email && candidate.email.trim().toLowerCase() === c.email.toLowerCase()) { reasons.push('Même email'); score += 70; }
    else if (emailDomain && !GENERIC_DOMAINS.has(emailDomain) && (domainOf(c.email) === emailDomain || domainOf(c.website) === emailDomain)) {
      reasons.push('Même domaine'); score += 35;
    }
    if (phone.length >= 9 && normalizePhone(c.phone) === phone) { reasons.push('Même téléphone'); score += 60; }
    if (webDomain && domainOf(c.website) === webDomain) { reasons.push('Même site Internet'); score += 60; }
    if (score >= 50) out.push({ company: c, reasons, score });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** Toutes les paires de doublons potentiels de la base. */
export async function scanDuplicates(db: Db): Promise<{ a: Company; b: Company; reasons: string[]; score: number }[]> {
  const all = await db.all<Company>('SELECT * FROM companies WHERE merged_into_id IS NULL ORDER BY id');
  const pairs: { a: Company; b: Company; reasons: string[]; score: number }[] = [];
  const seen = new Set<string>();
  for (const c of all) {
    const matches = await findDuplicates(db, c, c.id);
    for (const m of matches) {
      const key = [Math.min(c.id, m.company.id), Math.max(c.id, m.company.id)].join('-');
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push({ a: c.id < m.company.id ? c : m.company, b: c.id < m.company.id ? m.company : c, reasons: m.reasons, score: m.score });
    }
  }
  return pairs.sort((x, y) => y.score - x.score);
}

/**
 * Fusionne `sourceId` dans `targetId` : tous les éléments liés (contacts,
 * activités, opportunités, devis, factures, projets, contrats, documents,
 * journal) sont rattachés à la cible. Les champs vides de la cible sont
 * complétés. La fiche source est conservée, archivée et marquée comme fusionnée.
 */
export async function mergeCompanies(db: Db, targetId: number, sourceId: number): Promise<void> {
  assert(targetId !== sourceId, 'Impossible de fusionner une fiche avec elle-même.');
  await db.tx(async (t) => {
    const target = await getCompany(t, targetId);
    const source = await getCompany(t, sourceId);
    assert(target && source, 'Fiche introuvable.');
    assert(!source.merged_into_id, 'Cette fiche a déjà été fusionnée.');
    const fill: Record<string, any> = {};
    for (const f of COMPANY_FIELDS) {
      if (f === 'name' || f === 'kind') continue;
      const tv = (target as any)[f];
      const sv = (source as any)[f];
      if ((tv == null || tv === '' || tv === 0) && sv != null && sv !== '' && sv !== 0) fill[f] = sv;
    }
    if (source.notes && target.notes && source.notes !== target.notes) {
      fill.notes = `${target.notes}\n\n--- Notes fusionnées depuis « ${source.name} » ---\n${source.notes}`;
    }
    // Le type le plus avancé l'emporte (client > ancien client > partenaire > prospect)
    const rank: Record<CompanyKind, number> = { prospect: 0, partenaire: 1, ancien_client: 2, client: 3 };
    if (rank[source.kind] > rank[target.kind]) {
      fill.kind = source.kind;
      if (source.kind === 'client') fill.became_client_at = target.became_client_at ?? source.became_client_at;
    }
    const keys = Object.keys(fill);
    if (keys.length) {
      await t.run(`UPDATE companies SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`, [...keys.map((k) => fill[k]), targetId]);
    }
    for (const table of ['contacts', 'activities', 'opportunities', 'quotes', 'invoices', 'projects', 'contracts', 'documents']) {
      await t.run(`UPDATE ${table} SET company_id = ? WHERE company_id = ?`, [targetId, sourceId]);
    }
    // Un seul contact principal
    await t.run(
      `UPDATE contacts SET is_primary = 0 WHERE company_id = ? AND id <> COALESCE((SELECT id FROM contacts WHERE company_id = ? AND is_primary = 1 ORDER BY id LIMIT 1), -1)`,
      [targetId, targetId],
    );
    await t.run(
      `UPDATE companies SET merged_into_id = ?, archived_at = COALESCE(archived_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      [targetId, sourceId],
    );
    await logEvent(t, { entity: 'entreprise', id: targetId, action: 'fusion', summary: `Fiche « ${source.name} » (#${sourceId}) fusionnée dans « ${target.name} »`, details: { sourceId, filled: keys }, companyId: targetId });
    await logEvent(t, { entity: 'entreprise', id: sourceId, action: 'fusion', summary: `Fusionnée dans « ${target.name} » (#${targetId})`, companyId: sourceId });
  });
}

// ---------- Import / export CSV ----------

export const CSV_COLUMNS: { key: string; label: string; aliases: string[] }[] = [
  { key: 'name', label: 'Entreprise', aliases: ['entreprise', 'nom', 'societe', 'société', 'raison sociale', 'company', 'name'] },
  { key: 'contact_first_name', label: 'Prénom contact', aliases: ['prenom', 'prénom', 'prénom contact', 'first name'] },
  { key: 'contact_last_name', label: 'Nom contact', aliases: ['nom contact', 'contact', 'last name'] },
  { key: 'contact_job_title', label: 'Fonction', aliases: ['fonction', 'poste', 'job title'] },
  { key: 'sector', label: 'Secteur', aliases: ['secteur', "secteur d'activité", 'activité', 'industry'] },
  { key: 'address_line1', label: 'Adresse', aliases: ['adresse', 'address'] },
  { key: 'postal_code', label: 'Code postal', aliases: ['code postal', 'cp', 'zip'] },
  { key: 'city', label: 'Ville', aliases: ['ville', 'city'] },
  { key: 'phone', label: 'Téléphone', aliases: ['téléphone', 'telephone', 'tel', 'tél', 'phone'] },
  { key: 'email', label: 'Email', aliases: ['email', 'e-mail', 'mail', 'courriel'] },
  { key: 'website', label: 'Site Internet', aliases: ['site internet', 'site', 'site web', 'website', 'url'] },
  { key: 'gbp_url', label: 'Google Business Profile', aliases: ['google business profile', 'fiche google', 'gbp', 'google'] },
  { key: 'source', label: 'Source', aliases: ['source', 'origine'] },
  { key: 'commercial_status', label: 'Statut', aliases: ['statut', 'status'] },
  { key: 'potential', label: 'Potentiel (€)', aliases: ['potentiel', 'potentiel (€)', 'potential'] },
  { key: 'siret', label: 'SIRET', aliases: ['siret'] },
  { key: 'notes', label: 'Notes', aliases: ['notes', 'commentaire', 'commentaires'] },
  { key: 'next_action', label: 'Prochaine action', aliases: ['prochaine action'] },
  { key: 'next_action_date', label: 'Date de relance', aliases: ['date de relance', 'relance'] },
  { key: 'kind', label: 'Type', aliases: ['type'] },
  { key: 'created_at', label: 'Créé le', aliases: ['créé le', 'cree le', 'date de création'] },
];

export async function exportCompaniesCsv(db: Db, filter: CompanyFilter = {}): Promise<string> {
  const rows = await listCompanies(db, filter);
  const contacts = await db.all<Contact>('SELECT * FROM contacts WHERE archived_at IS NULL ORDER BY is_primary DESC, id');
  const byCompany = new Map<number, Contact>();
  for (const k of contacts) if (k.company_id && !byCompany.has(k.company_id)) byCompany.set(k.company_id, k);
  const data = rows.map((r) => {
    const k = byCompany.get(r.id);
    return {
      ...r,
      contact_first_name: k?.first_name ?? '',
      contact_last_name: k?.last_name ?? '',
      contact_job_title: k?.job_title ?? '',
      potential: (r.potential_cents / 100).toFixed(2).replace('.', ','),
      next_action_date: r.next_action_date ? r.next_action_date.split('-').reverse().join('/') : '',
      created_at: r.created_at.slice(0, 10).split('-').reverse().join('/'),
    };
  });
  return toCsv(data, CSV_COLUMNS);
}

function frDateToIso(s: string): string | null {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(s.trim());
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s.trim())) return s.trim();
  return null;
}

export interface ImportReport {
  created: number;
  skippedDuplicates: { line: number; name: string; existing: string; reasons: string[] }[];
  errors: { line: number; message: string }[];
}

export function mapCsvHeaders(headers: string[]): Record<string, string> {
  const map: Record<string, string> = {};
  for (const h of headers) {
    const n = h.trim().toLowerCase();
    const col = CSV_COLUMNS.find((c) => c.label.toLowerCase() === n || c.aliases.includes(n));
    if (col && !Object.values(map).includes(col.key)) map[h] = col.key;
  }
  return map;
}

/** Import CSV de prospects. Les doublons détectés sont ignorés (sauf `importDuplicates`). */
export async function importCompaniesCsv(
  db: Db,
  text: string,
  opts: { defaultKind?: CompanyKind; importDuplicates?: boolean; mapping?: Record<string, string> } = {},
): Promise<ImportReport> {
  const { headers, rows } = csvToObjects(text);
  const mapping = opts.mapping ?? mapCsvHeaders(headers);
  if (!Object.values(mapping).includes('name')) throw new BusinessError('Colonne « Entreprise » (ou « Nom ») introuvable dans le fichier CSV.');
  const report: ImportReport = { created: 0, skippedDuplicates: [], errors: [] };
  for (let i = 0; i < rows.length; i++) {
    const line = i + 2;
    const r: Record<string, string> = {};
    for (const [h, key] of Object.entries(mapping)) r[key] = rows[i][h] ?? '';
    try {
      if (!r.name?.trim()) throw new Error('Nom d\'entreprise manquant');
      const kind = (['prospect', 'client', 'ancien_client', 'partenaire'].includes(r.kind?.toLowerCase()) ? r.kind.toLowerCase() : opts.defaultKind ?? 'prospect') as CompanyKind;
      const statusKey = COMMERCIAL_STATUSES.find((s) => s.key === r.commercial_status || s.label.toLowerCase() === r.commercial_status?.toLowerCase())?.key;
      const input: CompanyInput = {
        name: r.name,
        kind,
        sector: r.sector, address_line1: r.address_line1, postal_code: r.postal_code, city: r.city,
        phone: r.phone, email: r.email, website: r.website, gbp_url: r.gbp_url, source: r.source || 'Import CSV',
        commercial_status: statusKey ?? 'nouveau',
        potential_cents: r.potential ? parseEuros(r.potential) : 0,
        siret: r.siret, notes: r.notes, next_action: r.next_action,
        next_action_date: r.next_action_date ? frDateToIso(r.next_action_date) : null,
      };
      if (!opts.importDuplicates) {
        const d = await findDuplicates(db, input);
        if (d.length && d[0].score >= 60) {
          report.skippedDuplicates.push({ line, name: r.name, existing: d[0].company.name, reasons: d[0].reasons });
          continue;
        }
      }
      const id = await createCompany(db, input);
      if (r.contact_last_name || r.contact_first_name) {
        await createContact(db, { company_id: id, first_name: r.contact_first_name, last_name: r.contact_last_name ?? '', job_title: r.contact_job_title, email: r.email, phone: r.phone, is_primary: 1 });
      }
      report.created++;
    } catch (e: any) {
      report.errors.push({ line, message: e.message ?? String(e) });
    }
  }
  return report;
}

// ---------- Synthèse client ----------

export interface ClientFinancials {
  invoiced_cents: number;
  credited_cents: number;
  paid_cents: number;
  due_cents: number;
  overdue_cents: number;
  quotes_count: number;
  quotes_accepted_cents: number;
}

export async function clientFinancials(db: Db, companyId: number): Promise<ClientFinancials> {
  const inv = await db.get<any>(
    `SELECT
       COALESCE(SUM(CASE WHEN kind <> 'avoir' THEN total_ttc_cents END), 0) AS invoiced,
       COALESCE(SUM(CASE WHEN kind = 'avoir' THEN total_ttc_cents END), 0) AS credited
     FROM invoices WHERE company_id = ? AND status <> 'brouillon'`,
    [companyId],
  );
  const paid = await db.get<any>(
    `SELECT COALESCE(SUM(p.amount_cents), 0) AS paid FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.company_id = ?`,
    [companyId],
  );
  const balances = await db.all<any>(
    `SELECT i.id, i.due_date, i.total_ttc_cents
        - COALESCE((SELECT SUM(amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0)
        - COALESCE((SELECT SUM(a.total_ttc_cents) FROM invoices a WHERE a.credited_invoice_id = i.id AND a.kind = 'avoir' AND a.status <> 'brouillon'), 0) AS balance
     FROM invoices i WHERE i.company_id = ? AND i.kind <> 'avoir' AND i.status IN ('emise','partiellement_payee')`,
    [companyId],
  );
  const todayIso = new Date().toISOString().slice(0, 10);
  const q = await db.get<any>(
    `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN status = 'accepte' THEN total_ht_cents END), 0) AS accepted FROM quotes WHERE company_id = ? AND archived_at IS NULL`,
    [companyId],
  );
  return {
    invoiced_cents: inv.invoiced,
    credited_cents: inv.credited,
    paid_cents: paid.paid,
    due_cents: balances.reduce((a, b) => a + Math.max(b.balance, 0), 0),
    overdue_cents: balances.filter((b) => b.due_date && b.due_date < todayIso).reduce((a, b) => a + Math.max(b.balance, 0), 0),
    quotes_count: q.n,
    quotes_accepted_cents: q.accepted,
  };
}

export interface TimelineItem {
  at: string;
  kind: 'journal' | 'activite';
  type: string;
  title: string;
  detail?: string | null;
  ref?: { entity: string; id: number };
}

/** Chronologie : journal des événements + activités (appels, emails, notes…). */
export async function companyTimeline(db: Db, companyId: number, limit = 300): Promise<TimelineItem[]> {
  const events = await db.all<any>('SELECT * FROM audit_log WHERE company_id = ? ORDER BY at DESC, id DESC LIMIT ?', [companyId, limit]);
  const acts = await db.all<any>(
    `SELECT * FROM activities WHERE company_id = ? ORDER BY COALESCE(done_at, due_at, created_at) DESC LIMIT ?`,
    [companyId, limit],
  );
  const items: TimelineItem[] = [
    ...events.map((e) => ({ at: e.at, kind: 'journal' as const, type: e.action, title: e.summary, ref: e.entity_id ? { entity: e.entity_type, id: e.entity_id } : undefined })),
    ...acts.map((a) => ({ at: a.done_at ?? a.due_at ?? a.created_at, kind: 'activite' as const, type: a.type, title: a.title, detail: a.notes, ref: { entity: 'activite', id: a.id } })),
  ];
  return items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0)).slice(0, limit);
}

/** Instantané des coordonnées client figé dans les documents émis. */
export interface ClientSnapshot {
  company_id: number;
  name: string;
  is_individual: boolean;
  contact_name: string;
  address_line1: string;
  address_line2: string;
  postal_code: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  siren: string;
  siret: string;
  vat_number: string;
}

export async function buildClientSnapshot(db: Db, companyId: number, contactId?: number | null): Promise<ClientSnapshot> {
  const c = await getCompany(db, companyId);
  assert(c, 'Client introuvable.');
  const k = contactId ? await db.get<Contact>('SELECT * FROM contacts WHERE id = ?', [contactId]) : await primaryContact(db, companyId);
  return {
    company_id: c.id,
    name: c.name,
    is_individual: !!c.is_individual,
    contact_name: contactFullName(k),
    address_line1: c.address_line1 ?? '',
    address_line2: c.address_line2 ?? '',
    postal_code: c.postal_code ?? '',
    city: c.city ?? '',
    country: c.country ?? 'France',
    email: k?.email ?? c.email ?? '',
    phone: k?.phone ?? c.phone ?? '',
    siren: c.siren ?? '',
    siret: c.siret ?? '',
    vat_number: c.vat_number ?? '',
  };
}
