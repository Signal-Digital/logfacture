/**
 * Devis.
 *
 * Cycle : brouillon → envoyé / en attente de signature → accepté | refusé | expiré | annulé.
 * À l'envoi, une version figée (instantané JSON + empreinte SHA-256) est
 * enregistrée dans `quote_versions`. Un devis non brouillon n'est plus
 * modifiable (déclencheurs SQLite) : toute modification passe par une
 * nouvelle version, l'ancienne (et sa signature éventuelle) restant conservée.
 */
import type { Db } from '@/lib/db';
import { computeTotals, depositAmount, type DiscountType, type Totals } from '@/lib/money';
import { addDays, today } from '@/lib/format';
import { sha256Hex, uuid } from '@/lib/crypto';
import { logEvent } from './audit';
import { BusinessError, assert } from './context';
import { buildClientSnapshot, convertToClient, type ClientSnapshot } from './companies';
import {
  checkBeforeIssue,
  legalMentions,
  loadLines,
  nextNumber,
  saveLines,
  sellerSnapshot,
  type DocLine,
  type IssueCheck,
  type SellerSnapshot,
} from './docCommon';
import { getAllSettings } from './settings';

export type QuoteStatus = 'brouillon' | 'envoye' | 'attente_signature' | 'accepte' | 'refuse' | 'expire' | 'annule';

export const QUOTE_STATUSES: { key: QuoteStatus; label: string; tone: string }[] = [
  { key: 'brouillon', label: 'Brouillon', tone: 'neutral' },
  { key: 'envoye', label: 'Envoyé', tone: 'info' },
  { key: 'attente_signature', label: 'En attente de signature', tone: 'warning' },
  { key: 'accepte', label: 'Accepté', tone: 'success' },
  { key: 'refuse', label: 'Refusé', tone: 'danger' },
  { key: 'expire', label: 'Expiré', tone: 'muted' },
  { key: 'annule', label: 'Annulé', tone: 'muted' },
];

export interface Quote {
  id: number;
  uuid: string;
  number: string;
  version: number;
  status: QuoteStatus;
  company_id: number;
  contact_id: number | null;
  opportunity_id: number | null;
  project_id: number | null;
  title: string;
  issue_date: string;
  validity_date: string | null;
  client_snapshot: string | null;
  seller_snapshot: string | null;
  global_discount_type: DiscountType;
  global_discount_value: number;
  deposit_type: DiscountType;
  deposit_value: number;
  payment_terms: string | null;
  special_conditions: string | null;
  footer_notes: string | null;
  notes_internal: string | null;
  template_id: number | null;
  total_ht_cents: number;
  total_vat_cents: number;
  total_ttc_cents: number;
  sent_at: string | null;
  accepted_at: string | null;
  refused_at: string | null;
  cancelled_at: string | null;
  accepted_version_id: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuoteFull extends Quote {
  lines: DocLine[];
  totals: Totals;
  deposit_ttc_cents: number;
  company_name: string;
}

export interface QuoteVersion {
  id: number;
  quote_id: number;
  version: number;
  snapshot: string;
  snapshot_sha256: string;
  pdf_path: string | null;
  pdf_sha256: string | null;
  reason: string | null;
  created_at: string;
}

/** Contenu complet et figé d'une version de devis. */
export interface QuoteSnapshot {
  type: 'devis';
  quote_uuid: string;
  number: string;
  version: number;
  title: string;
  issue_date: string;
  validity_date: string | null;
  seller: SellerSnapshot;
  client: ClientSnapshot;
  lines: DocLine[];
  global_discount: { type: DiscountType; value: number };
  totals: Totals;
  deposit: { type: DiscountType; value: number; ttc_cents: number };
  payment_terms: string;
  special_conditions: string;
  footer_notes: string;
  legal_mentions: string[];
}

export interface QuoteHeaderInput {
  company_id?: number;
  contact_id?: number | null;
  opportunity_id?: number | null;
  project_id?: number | null;
  title?: string;
  issue_date?: string;
  validity_date?: string | null;
  global_discount_type?: DiscountType;
  global_discount_value?: number;
  deposit_type?: DiscountType;
  deposit_value?: number;
  payment_terms?: string | null;
  special_conditions?: string | null;
  footer_notes?: string | null;
  notes_internal?: string | null;
  template_id?: number | null;
}

const HEADER_FIELDS = [
  'company_id', 'contact_id', 'opportunity_id', 'project_id', 'title', 'issue_date', 'validity_date', 'global_discount_type',
  'global_discount_value', 'deposit_type', 'deposit_value', 'payment_terms', 'special_conditions', 'footer_notes', 'notes_internal', 'template_id',
] as const;

export async function createQuote(db: Db, input: QuoteHeaderInput & { company_id: number; lines?: DocLine[] }): Promise<number> {
  assert(input.company_id, 'Sélectionnez un client ou un prospect.');
  const s = await getAllSettings(db);
  return db.tx(async (t) => {
    const company = await t.get<any>('SELECT id, name FROM companies WHERE id = ?', [input.company_id]);
    assert(company, 'Entreprise introuvable.');
    const issue = input.issue_date ?? today();
    const number = await nextNumber(t, 'devis', issue, s);
    const lines = input.lines ?? [];
    const totals = computeTotals(lines, { type: input.global_discount_type ?? 'none', value: input.global_discount_value ?? 0 });
    const r = await t.run(
      `INSERT INTO quotes (uuid, number, company_id, contact_id, opportunity_id, project_id, title, issue_date, validity_date,
         global_discount_type, global_discount_value, deposit_type, deposit_value, payment_terms, special_conditions,
         footer_notes, notes_internal, template_id, total_ht_cents, total_vat_cents, total_ttc_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuid(), number, input.company_id, input.contact_id ?? null, input.opportunity_id ?? null, input.project_id ?? null,
        input.title ?? '', issue, input.validity_date ?? addDays(issue, s.quotes.validity_days),
        input.global_discount_type ?? 'none', input.global_discount_value ?? 0, input.deposit_type ?? 'none', input.deposit_value ?? 0,
        input.payment_terms ?? s.payment.payment_terms_text, input.special_conditions ?? (s.quotes.default_conditions || null),
        input.footer_notes ?? null, input.notes_internal ?? null, input.template_id ?? null,
        totals.total_ht_cents, totals.total_vat_cents, totals.total_ttc_cents,
      ],
    );
    const id = r.lastInsertId;
    if (lines.length) await saveLines(t, 'quote_lines', 'quote_id', id, lines);
    await logEvent(t, { entity: 'devis', id, action: 'creation', summary: `Devis ${number} créé (brouillon)`, companyId: input.company_id });
    return id;
  });
}

export async function getQuote(db: Db, id: number): Promise<QuoteFull | undefined> {
  const q = await db.get<Quote & { company_name: string }>('SELECT q.*, c.name AS company_name FROM quotes q JOIN companies c ON c.id = q.company_id WHERE q.id = ?', [id]);
  if (!q) return undefined;
  const lines = await loadLines(db, 'quote_lines', 'quote_id', id);
  const totals = computeTotals(lines, { type: q.global_discount_type, value: q.global_discount_value });
  let deposit = 0;
  try {
    deposit = depositAmount(totals.total_ttc_cents, q.deposit_type, q.deposit_value);
  } catch {
    deposit = 0;
  }
  return { ...q, lines, totals, deposit_ttc_cents: deposit };
}

/** Enregistre un brouillon (en-tête + lignes). Refusé si le devis n'est plus un brouillon. */
export async function saveQuoteDraft(db: Db, id: number, header: QuoteHeaderInput, lines?: DocLine[]): Promise<void> {
  await db.tx(async (t) => {
    const q = await t.get<Quote>('SELECT * FROM quotes WHERE id = ?', [id]);
    assert(q, 'Devis introuvable.');
    if (q.status !== 'brouillon') throw new BusinessError('Ce devis n\'est plus un brouillon : créez une nouvelle version pour le modifier.');
    const keys = HEADER_FIELDS.filter((k) => k in header);
    const merged: any = { ...q, ...header };
    const currentLines = lines ?? (await loadLines(t, 'quote_lines', 'quote_id', id));
    const totals = computeTotals(currentLines, { type: merged.global_discount_type, value: merged.global_discount_value });
    depositAmount(totals.total_ttc_cents, merged.deposit_type, merged.deposit_value); // valide l'acompte
    const sets = [...keys.map((k) => `${k} = ?`), 'total_ht_cents = ?', 'total_vat_cents = ?', 'total_ttc_cents = ?', "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"];
    await t.run(`UPDATE quotes SET ${sets.join(', ')} WHERE id = ?`, [
      ...keys.map((k) => (header as any)[k] ?? null), totals.total_ht_cents, totals.total_vat_cents, totals.total_ttc_cents, id,
    ]);
    if (lines) await saveLines(t, 'quote_lines', 'quote_id', id, lines);
  });
}

async function buildSnapshot(db: Db, q: QuoteFull): Promise<QuoteSnapshot> {
  const s = await getAllSettings(db);
  const client = await buildClientSnapshot(db, q.company_id, q.contact_id);
  return {
    type: 'devis',
    quote_uuid: q.uuid,
    number: q.number,
    version: q.version,
    title: q.title,
    issue_date: q.issue_date,
    validity_date: q.validity_date,
    seller: sellerSnapshot(s),
    client,
    lines: q.lines.map(({ id: _id, ...l }: any) => { delete l.quote_id; return l; }),
    global_discount: { type: q.global_discount_type, value: q.global_discount_value },
    totals: q.totals,
    deposit: { type: q.deposit_type, value: q.deposit_value, ttc_cents: q.deposit_ttc_cents },
    payment_terms: q.payment_terms ?? '',
    special_conditions: q.special_conditions ?? '',
    footer_notes: q.footer_notes ?? '',
    legal_mentions: legalMentions(s, 'devis', client),
  };
}

/** Aperçu de l'instantané (sans enregistrer) : utilisé pour la prévisualisation PDF d'un brouillon. */
export async function previewSnapshot(db: Db, id: number): Promise<QuoteSnapshot> {
  const q = await getQuote(db, id);
  assert(q, 'Devis introuvable.');
  return buildSnapshot(db, q);
}

export async function checkQuote(db: Db, id: number): Promise<IssueCheck> {
  const q = await getQuote(db, id);
  assert(q, 'Devis introuvable.');
  const s = await getAllSettings(db);
  const client = await buildClientSnapshot(db, q.company_id, q.contact_id);
  const check = checkBeforeIssue(s, { kind: 'devis', client, lines: q.lines, totals: q.totals });
  if (q.validity_date && q.validity_date < q.issue_date) check.errors.push('La date de validité est antérieure à la date d\'émission.');
  return check;
}

/**
 * Fige le devis (version enregistrée + empreinte) et le passe à « envoyé »
 * ou « en attente de signature ». Retourne la version créée.
 */
export async function finalizeQuote(db: Db, id: number, opts: { awaitingSignature?: boolean } = {}): Promise<QuoteVersion> {
  const check = await checkQuote(db, id);
  if (check.errors.length) throw new BusinessError('Le devis ne peut pas être finalisé :', check.errors);
  return db.tx(async (t) => {
    const q = await getQuote(t, id);
    assert(q, 'Devis introuvable.');
    assert(q.status === 'brouillon', 'Seul un brouillon peut être finalisé.');
    const snapshot = await buildSnapshot(t, q);
    const json = JSON.stringify(snapshot);
    const hash = await sha256Hex(json);
    const status: QuoteStatus = opts.awaitingSignature ? 'attente_signature' : 'envoye';
    await t.run(
      `UPDATE quotes SET status = ?, client_snapshot = ?, seller_snapshot = ?, sent_at = COALESCE(sent_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
         total_ht_cents = ?, total_vat_cents = ?, total_ttc_cents = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      [status, JSON.stringify(snapshot.client), JSON.stringify(snapshot.seller), q.totals.total_ht_cents, q.totals.total_vat_cents, q.totals.total_ttc_cents, id],
    );
    const r = await t.run('INSERT INTO quote_versions (quote_id, version, snapshot, snapshot_sha256, reason) VALUES (?, ?, ?, ?, ?)', [
      id, q.version, json, hash, q.version === 1 ? 'Version initiale' : 'Nouvelle version',
    ]);
    if (q.opportunity_id) {
      const stage = await t.get<{ id: number }>("SELECT id FROM pipeline_stages WHERE name = 'Devis envoyé' AND archived_at IS NULL");
      if (stage) {
        await t.run("UPDATE opportunities SET stage_id = ?, probability = MAX(probability, 60), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ? AND status = 'open' AND stage_id IN (SELECT id FROM pipeline_stages WHERE position < (SELECT position FROM pipeline_stages WHERE id = ?))", [stage.id, q.opportunity_id, stage.id]);
      }
    }
    await logEvent(t, {
      entity: 'devis', id, action: 'finalisation',
      summary: `Devis ${q.number} v${q.version} finalisé (${status === 'envoye' ? 'envoyé' : 'en attente de signature'}) — empreinte ${hash.slice(0, 12)}…`,
      companyId: q.company_id,
    });
    return (await t.get<QuoteVersion>('SELECT * FROM quote_versions WHERE id = ?', [r.lastInsertId]))!;
  });
}

/** Rattache le PDF généré à une version (une seule fois : immuable ensuite). */
export async function attachVersionPdf(db: Db, versionId: number, pdfPath: string, pdfSha256: string): Promise<void> {
  const v = await db.get<QuoteVersion>('SELECT * FROM quote_versions WHERE id = ?', [versionId]);
  assert(v, 'Version introuvable.');
  if (v.pdf_sha256) {
    if (v.pdf_sha256 === pdfSha256) return;
    throw new BusinessError('Le PDF de cette version a déjà été enregistré et ne peut pas être remplacé.');
  }
  await db.run('UPDATE quote_versions SET pdf_path = ?, pdf_sha256 = ? WHERE id = ?', [pdfPath, pdfSha256, versionId]);
}

export async function listVersions(db: Db, quoteId: number): Promise<QuoteVersion[]> {
  return db.all<QuoteVersion>('SELECT * FROM quote_versions WHERE quote_id = ? ORDER BY version DESC', [quoteId]);
}

export async function latestVersion(db: Db, quoteId: number): Promise<QuoteVersion | undefined> {
  return db.get<QuoteVersion>('SELECT * FROM quote_versions WHERE quote_id = ? ORDER BY version DESC LIMIT 1', [quoteId]);
}

export async function setAwaitingSignature(db: Db, id: number): Promise<void> {
  const q = await db.get<Quote>('SELECT * FROM quotes WHERE id = ?', [id]);
  assert(q, 'Devis introuvable.');
  assert(q.status === 'envoye' || q.status === 'attente_signature', 'Le devis doit être envoyé pour être soumis à signature.');
  await db.run("UPDATE quotes SET status = 'attente_signature', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [id]);
}

/**
 * Crée une nouvelle version modifiable. La version précédente (et, pour un
 * devis accepté, la version acceptée et sa signature) reste conservée.
 */
export async function newVersion(db: Db, id: number, reason: string): Promise<void> {
  assert(reason.trim(), 'Indiquez le motif de la nouvelle version.');
  await db.tx(async (t) => {
    const q = await t.get<Quote>('SELECT * FROM quotes WHERE id = ?', [id]);
    assert(q, 'Devis introuvable.');
    assert(q.status !== 'brouillon', 'Ce devis est déjà modifiable.');
    assert(q.status !== 'annule', 'Un devis annulé ne peut pas être modifié : dupliquez-le.');
    const hasVersion = await t.get('SELECT 1 FROM quote_versions WHERE quote_id = ? AND version = ?', [id, q.version]);
    assert(hasVersion, 'La version actuelle n\'a pas été figée.');
    await t.run(
      `UPDATE quotes SET status = 'brouillon', version = version + 1, refused_at = NULL,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      [id],
    );
    await t.run("UPDATE signature_requests SET status = 'annulee' WHERE quote_id = ? AND status = 'ouverte'", [id]);
    await logEvent(t, {
      entity: 'devis', id, action: 'nouvelle_version',
      summary: `Devis ${q.number} : version ${q.version + 1} créée (${reason.trim()})${q.status === 'accepte' ? ' — la version acceptée v' + q.version + ' reste conservée' : ''}`,
      companyId: q.company_id,
    });
  });
}

export interface AcceptResult {
  convertedToClient: boolean;
  companyId: number;
}

/** Acceptation (manuelle ou suite à signature). Le prospect devient client. */
export async function acceptQuote(db: Db, id: number, opts: { versionId?: number; via: 'signature' | 'manuel'; note?: string }): Promise<AcceptResult> {
  const result = await db.tx(async (t) => {
    const q = await t.get<Quote>('SELECT * FROM quotes WHERE id = ?', [id]);
    assert(q, 'Devis introuvable.');
    assert(['envoye', 'attente_signature'].includes(q.status), 'Seul un devis envoyé ou en attente de signature peut être accepté.');
    const version = opts.versionId
      ? await t.get<QuoteVersion>('SELECT * FROM quote_versions WHERE id = ? AND quote_id = ?', [opts.versionId, id])
      : await t.get<QuoteVersion>('SELECT * FROM quote_versions WHERE quote_id = ? ORDER BY version DESC LIMIT 1', [id]);
    assert(version, 'Version du devis introuvable.');
    assert(version.version === q.version, 'La version acceptée doit être la version en cours du devis.');
    await t.run(
      `UPDATE quotes SET status = 'accepte', accepted_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), accepted_version_id = ?,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      [version.id, id],
    );
    await logEvent(t, {
      entity: 'devis', id, action: 'acceptation',
      summary: `Devis ${q.number} v${version.version} accepté (${opts.via === 'signature' ? 'signature électronique' : 'acceptation enregistrée manuellement'})${opts.note ? ' — ' + opts.note : ''}`,
      companyId: q.company_id,
    });
    if (q.opportunity_id) {
      const won = await t.get<{ id: number }>("SELECT id FROM pipeline_stages WHERE kind = 'won' AND archived_at IS NULL ORDER BY position LIMIT 1");
      if (won) {
        await t.run(
          `UPDATE opportunities SET stage_id = ?, status = 'won', probability = 100, closed_at = COALESCE(closed_at, strftime('%Y-%m-%dT%H:%M:%fZ','now')),
             amount_cents = CASE WHEN amount_cents = 0 THEN ? ELSE amount_cents END WHERE id = ?`,
          [won.id, q.total_ht_cents, q.opportunity_id],
        );
      }
    }
    return q;
  });
  const converted = await convertToClient(db, result.company_id, `devis ${result.number} accepté`);
  return { convertedToClient: converted, companyId: result.company_id };
}

export async function refuseQuote(db: Db, id: number, reason?: string): Promise<void> {
  await db.tx(async (t) => {
    const q = await t.get<Quote>('SELECT * FROM quotes WHERE id = ?', [id]);
    assert(q, 'Devis introuvable.');
    assert(['envoye', 'attente_signature', 'expire'].includes(q.status), 'Ce devis ne peut pas être marqué comme refusé.');
    await t.run("UPDATE quotes SET status = 'refuse', refused_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [id]);
    await t.run("UPDATE signature_requests SET status = 'annulee' WHERE quote_id = ? AND status = 'ouverte'", [id]);
    await logEvent(t, { entity: 'devis', id, action: 'refus', summary: `Devis ${q.number} refusé${reason ? ' : ' + reason : ''}`, companyId: q.company_id });
  });
}

export async function cancelQuote(db: Db, id: number, reason?: string): Promise<void> {
  await db.tx(async (t) => {
    const q = await t.get<Quote>('SELECT * FROM quotes WHERE id = ?', [id]);
    assert(q, 'Devis introuvable.');
    assert(q.status !== 'annule', 'Ce devis est déjà annulé.');
    const invoiced = await t.get("SELECT 1 FROM invoices WHERE quote_id = ? AND status <> 'brouillon'", [id]);
    if (invoiced) throw new BusinessError('Ce devis a déjà été facturé : il ne peut pas être annulé. Émettez un avoir si nécessaire.');
    await t.run("UPDATE quotes SET status = 'annule', cancelled_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [id]);
    await t.run("UPDATE signature_requests SET status = 'annulee' WHERE quote_id = ? AND status = 'ouverte'", [id]);
    await logEvent(t, { entity: 'devis', id, action: 'annulation', summary: `Devis ${q.number} annulé${reason ? ' : ' + reason : ''}`, companyId: q.company_id });
  });
}

/** Passe en « expiré » les devis envoyés dont la date de validité est dépassée. */
export async function expireQuotes(db: Db, asOf = today()): Promise<number> {
  const rows = await db.all<Quote>("SELECT * FROM quotes WHERE status IN ('envoye','attente_signature') AND validity_date IS NOT NULL AND validity_date < ?", [asOf]);
  for (const q of rows) {
    await db.run("UPDATE quotes SET status = 'expire', updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [q.id]);
    await db.run("UPDATE signature_requests SET status = 'expiree' WHERE quote_id = ? AND status = 'ouverte'", [q.id]);
    await logEvent(db, { entity: 'devis', id: q.id, action: 'expiration', summary: `Devis ${q.number} expiré (validité au ${q.validity_date})`, companyId: q.company_id });
  }
  return rows.length;
}

export async function duplicateQuote(db: Db, id: number, opts: { companyId?: number } = {}): Promise<number> {
  const q = await getQuote(db, id);
  assert(q, 'Devis introuvable.');
  const newId = await createQuote(db, {
    company_id: opts.companyId ?? q.company_id,
    contact_id: opts.companyId ? null : q.contact_id,
    title: q.title,
    global_discount_type: q.global_discount_type,
    global_discount_value: q.global_discount_value,
    deposit_type: q.deposit_type,
    deposit_value: q.deposit_value,
    payment_terms: q.payment_terms,
    special_conditions: q.special_conditions,
    footer_notes: q.footer_notes,
    template_id: q.template_id,
    lines: q.lines.map(({ id: _i, ...l }: any) => l),
  });
  await logEvent(db, { entity: 'devis', id: newId, action: 'duplication', summary: `Dupliqué depuis le devis ${q.number}`, companyId: opts.companyId ?? q.company_id });
  return newId;
}

export async function archiveQuote(db: Db, id: number, archived = true): Promise<void> {
  const q = await db.get<Quote>('SELECT * FROM quotes WHERE id = ?', [id]);
  assert(q, 'Devis introuvable.');
  await db.run(`UPDATE quotes SET archived_at = ${archived ? "strftime('%Y-%m-%dT%H:%M:%fZ','now')" : 'NULL'} WHERE id = ?`, [id]);
  await logEvent(db, { entity: 'devis', id, action: archived ? 'archivage' : 'desarchivage', summary: `Devis ${q.number} ${archived ? 'archivé' : 'désarchivé'}`, companyId: q.company_id });
}

/** Suppression : uniquement un brouillon jamais finalisé. */
export async function deleteDraftQuote(db: Db, id: number): Promise<void> {
  await db.tx(async (t) => {
    const q = await t.get<Quote>('SELECT * FROM quotes WHERE id = ?', [id]);
    assert(q, 'Devis introuvable.');
    assert(q.status === 'brouillon', 'Seul un brouillon peut être supprimé.');
    const v = await t.get('SELECT 1 FROM quote_versions WHERE quote_id = ?', [id]);
    if (v) throw new BusinessError('Ce devis a déjà été envoyé (versions enregistrées) : il ne peut pas être supprimé, archivez-le ou annulez-le.');
    await t.run('DELETE FROM documents WHERE quote_id = ? AND locked = 0', [id]);
    await t.run('UPDATE activities SET quote_id = NULL WHERE quote_id = ?', [id]);
    await t.run('UPDATE projects SET quote_id = NULL WHERE quote_id = ?', [id]);
    await t.run('DELETE FROM quotes WHERE id = ?', [id]);
    await logEvent(t, { entity: 'devis', id, action: 'suppression', summary: `Brouillon de devis ${q.number} supprimé`, companyId: q.company_id });
  });
}

export interface QuoteListRow extends Quote {
  company_name: string;
  invoiced_cents: number;
}

export async function listQuotes(
  db: Db,
  f: { status?: QuoteStatus | QuoteStatus[]; companyId?: number; search?: string; from?: string; to?: string; archived?: boolean; projectId?: number } = {},
): Promise<QuoteListRow[]> {
  const where: string[] = [f.archived ? 'q.archived_at IS NOT NULL' : 'q.archived_at IS NULL'];
  const params: any[] = [];
  if (f.status) {
    const st = Array.isArray(f.status) ? f.status : [f.status];
    where.push(`q.status IN (${st.map(() => '?').join(',')})`);
    params.push(...st);
  }
  if (f.companyId != null) { where.push('q.company_id = ?'); params.push(f.companyId); }
  if (f.projectId != null) { where.push('q.project_id = ?'); params.push(f.projectId); }
  if (f.from) { where.push('q.issue_date >= ?'); params.push(f.from); }
  if (f.to) { where.push('q.issue_date <= ?'); params.push(f.to); }
  if (f.search?.trim()) {
    where.push('(lower(q.number) LIKE ? OR lower(q.title) LIKE ? OR lower(c.name) LIKE ?)');
    const s = `%${f.search.trim().toLowerCase()}%`;
    params.push(s, s, s);
  }
  return db.all<QuoteListRow>(
    `SELECT q.*, c.name AS company_name,
       COALESCE((SELECT SUM(CASE WHEN i.kind = 'avoir' THEN -i.total_ttc_cents ELSE i.total_ttc_cents END) FROM invoices i WHERE i.quote_id = q.id AND i.status <> 'brouillon'), 0) AS invoiced_cents
     FROM quotes q JOIN companies c ON c.id = q.company_id WHERE ${where.join(' AND ')} ORDER BY q.issue_date DESC, q.id DESC`,
    params,
  );
}
