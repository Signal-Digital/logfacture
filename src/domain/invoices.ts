/**
 * Factures, factures d'acompte et de solde, avoirs, paiements.
 *
 * Principes :
 *  - un brouillon n'a pas de numéro ; le numéro est attribué à l'émission,
 *    dans une transaction, à partir d'une séquence stockée (pas de doublon,
 *    pas de trou, ordre chronologique contrôlé) ;
 *  - une facture émise est immuable (déclencheurs SQLite) : pas de
 *    suppression, pas de renumérotation, pas de modification des montants ;
 *  - la rectification passe par un avoir (total ou partiel) ;
 *  - les coordonnées du vendeur et du client sont figées à l'émission.
 */
import type { Db } from '@/lib/db';
import { allocate, computeTotals, depositAmount, splitDepositByRate, type DiscountType, type Totals } from '@/lib/money';
import { addDays, formatRate, today } from '@/lib/format';
import { uuid } from '@/lib/crypto';
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
import { getQuote } from './quotes';

export type InvoiceKind = 'facture' | 'acompte' | 'solde' | 'avoir';
export type InvoiceStatus = 'brouillon' | 'emise' | 'partiellement_payee' | 'payee' | 'annulee';
export type DisplayStatus = InvoiceStatus | 'en_retard';

export const INVOICE_KINDS: { key: InvoiceKind; label: string }[] = [
  { key: 'facture', label: 'Facture' },
  { key: 'acompte', label: "Facture d'acompte" },
  { key: 'solde', label: 'Facture de solde' },
  { key: 'avoir', label: 'Avoir' },
];

export const INVOICE_STATUSES: { key: DisplayStatus; label: string; tone: string }[] = [
  { key: 'brouillon', label: 'Brouillon', tone: 'neutral' },
  { key: 'emise', label: 'Émise', tone: 'info' },
  { key: 'partiellement_payee', label: 'Partiellement payée', tone: 'warning' },
  { key: 'payee', label: 'Payée', tone: 'success' },
  { key: 'en_retard', label: 'En retard', tone: 'danger' },
  { key: 'annulee', label: 'Annulée (avoir)', tone: 'muted' },
];

export const PAYMENT_METHODS: { key: string; label: string }[] = [
  { key: 'virement', label: 'Virement' },
  { key: 'carte', label: 'Carte bancaire' },
  { key: 'cheque', label: 'Chèque' },
  { key: 'especes', label: 'Espèces' },
  { key: 'prelevement', label: 'Prélèvement' },
  { key: 'autre', label: 'Autre' },
];

export interface Invoice {
  id: number;
  uuid: string;
  number: string | null;
  kind: InvoiceKind;
  status: InvoiceStatus;
  company_id: number;
  contact_id: number | null;
  quote_id: number | null;
  project_id: number | null;
  contract_id: number | null;
  credited_invoice_id: number | null;
  title: string;
  issue_date: string | null;
  due_date: string | null;
  service_date: string | null;
  client_snapshot: string | null;
  seller_snapshot: string | null;
  global_discount_type: DiscountType;
  global_discount_value: number;
  payment_terms: string | null;
  legal_mentions: string | null;
  footer_notes: string | null;
  notes_internal: string | null;
  template_id: number | null;
  total_ht_cents: number;
  total_vat_cents: number;
  total_ttc_cents: number;
  totals_json: string | null;
  pdf_path: string | null;
  pdf_sha256: string | null;
  issued_at: string | null;
  cancelled_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Payment {
  id: number;
  invoice_id: number;
  amount_cents: number;
  paid_at: string;
  method: string;
  reference: string | null;
  notes: string | null;
  created_at: string;
}

export interface Balance {
  total_cents: number;
  paid_cents: number;
  credited_cents: number;
  due_cents: number;
  overdue: boolean;
  days_late: number;
}

export interface InvoiceFull extends Invoice {
  lines: DocLine[];
  totals: Totals;
  payments: Payment[];
  balance: Balance;
  company_name: string;
  quote_number: string | null;
  credited_invoice_number: string | null;
  credit_notes: { id: number; number: string | null; total_ttc_cents: number; status: InvoiceStatus }[];
  display_status: DisplayStatus;
}

/** Contenu figé d'une facture émise (base du PDF et de l'export Factur-X futur). */
export interface InvoiceSnapshot {
  type: 'facture';
  kind: InvoiceKind;
  invoice_uuid: string;
  number: string;
  title: string;
  issue_date: string;
  due_date: string | null;
  service_date: string | null;
  seller: SellerSnapshot;
  client: ClientSnapshot;
  lines: DocLine[];
  global_discount: { type: DiscountType; value: number };
  totals: Totals;
  payment_terms: string;
  legal_mentions: string[];
  footer_notes: string;
  quote_number: string | null;
  credited_invoice_number: string | null;
  credited_invoice_date: string | null;
}

export interface InvoiceHeaderInput {
  company_id?: number;
  contact_id?: number | null;
  quote_id?: number | null;
  project_id?: number | null;
  contract_id?: number | null;
  title?: string;
  issue_date?: string | null;
  due_date?: string | null;
  service_date?: string | null;
  global_discount_type?: DiscountType;
  global_discount_value?: number;
  payment_terms?: string | null;
  footer_notes?: string | null;
  notes_internal?: string | null;
  template_id?: number | null;
}

const HEADER_FIELDS = [
  'company_id', 'contact_id', 'quote_id', 'project_id', 'contract_id', 'title', 'issue_date', 'due_date', 'service_date',
  'global_discount_type', 'global_discount_value', 'payment_terms', 'footer_notes', 'notes_internal', 'template_id',
] as const;

// ---------- Brouillons ----------

export async function createInvoiceDraft(
  db: Db,
  input: InvoiceHeaderInput & { company_id: number; kind?: InvoiceKind; credited_invoice_id?: number | null; lines?: DocLine[] },
): Promise<number> {
  assert(input.company_id, 'Sélectionnez un client.');
  const s = await getAllSettings(db);
  return db.tx(async (t) => {
    const c = await t.get('SELECT id FROM companies WHERE id = ?', [input.company_id]);
    assert(c, 'Client introuvable.');
    const lines = input.lines ?? [];
    const kind = input.kind ?? 'facture';
    const totals = computeTotals(lines, { type: input.global_discount_type ?? 'none', value: input.global_discount_value ?? 0 });
    const r = await t.run(
      `INSERT INTO invoices (uuid, kind, company_id, contact_id, quote_id, project_id, contract_id, credited_invoice_id, title,
         service_date, global_discount_type, global_discount_value, payment_terms, footer_notes, notes_internal, template_id,
         total_ht_cents, total_vat_cents, total_ttc_cents)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        uuid(), kind, input.company_id, input.contact_id ?? null, input.quote_id ?? null, input.project_id ?? null, input.contract_id ?? null,
        input.credited_invoice_id ?? null, input.title ?? '', input.service_date ?? null, input.global_discount_type ?? 'none',
        input.global_discount_value ?? 0, input.payment_terms ?? (kind === 'avoir' ? null : s.payment.payment_terms_text),
        input.footer_notes ?? null, input.notes_internal ?? null, input.template_id ?? null,
        totals.total_ht_cents, totals.total_vat_cents, totals.total_ttc_cents,
      ],
    );
    const id = r.lastInsertId;
    if (lines.length) await saveLines(t, 'invoice_lines', 'invoice_id', id, lines);
    const label = INVOICE_KINDS.find((k) => k.key === kind)!.label;
    await logEvent(t, { entity: 'facture', id, action: 'creation', summary: `${label} créée (brouillon)`, companyId: input.company_id });
    return id;
  });
}

export async function saveInvoiceDraft(db: Db, id: number, header: InvoiceHeaderInput, lines?: DocLine[]): Promise<void> {
  await db.tx(async (t) => {
    const inv = await t.get<Invoice>('SELECT * FROM invoices WHERE id = ?', [id]);
    assert(inv, 'Facture introuvable.');
    if (inv.status !== 'brouillon') throw new BusinessError('Facture émise : elle ne peut plus être modifiée. Utilisez un avoir pour la rectifier.');
    const keys = HEADER_FIELDS.filter((k) => k in header);
    const merged: any = { ...inv, ...header };
    const currentLines = lines ?? (await loadLines(t, 'invoice_lines', 'invoice_id', id));
    const totals = computeTotals(currentLines, { type: merged.global_discount_type, value: merged.global_discount_value });
    const sets = [...keys.map((k) => `${k} = ?`), 'total_ht_cents = ?', 'total_vat_cents = ?', 'total_ttc_cents = ?', "updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')"];
    await t.run(`UPDATE invoices SET ${sets.join(', ')} WHERE id = ?`, [
      ...keys.map((k) => (header as any)[k] ?? null), totals.total_ht_cents, totals.total_vat_cents, totals.total_ttc_cents, id,
    ]);
    if (lines) await saveLines(t, 'invoice_lines', 'invoice_id', id, lines);
  });
}

export async function deleteDraftInvoice(db: Db, id: number): Promise<void> {
  await db.tx(async (t) => {
    const inv = await t.get<Invoice>('SELECT * FROM invoices WHERE id = ?', [id]);
    assert(inv, 'Facture introuvable.');
    if (inv.status !== 'brouillon') throw new BusinessError('Une facture émise ne peut pas être supprimée. Émettez un avoir pour l\'annuler.');
    await t.run('DELETE FROM contract_invoice_runs WHERE invoice_id = ?', [id]);
    await t.run('UPDATE activities SET invoice_id = NULL WHERE invoice_id = ?', [id]);
    await t.run('DELETE FROM documents WHERE invoice_id = ? AND locked = 0', [id]);
    await t.run('DELETE FROM invoices WHERE id = ?', [id]);
    await logEvent(t, { entity: 'facture', id, action: 'suppression', summary: 'Brouillon de facture supprimé', companyId: inv.company_id });
  });
}

// ---------- Lecture ----------

export async function computeBalance(db: Db, inv: Invoice, asOf = today()): Promise<Balance> {
  const paid = (await db.get<{ s: number }>('SELECT COALESCE(SUM(amount_cents), 0) AS s FROM payments WHERE invoice_id = ?', [inv.id]))!.s;
  const credited = inv.kind === 'avoir'
    ? 0
    : (await db.get<{ s: number }>("SELECT COALESCE(SUM(total_ttc_cents), 0) AS s FROM invoices WHERE credited_invoice_id = ? AND kind = 'avoir' AND status <> 'brouillon'", [inv.id]))!.s;
  const due = inv.total_ttc_cents - paid - credited;
  const isOpen = inv.status === 'emise' || inv.status === 'partiellement_payee';
  const overdue = isOpen && inv.kind !== 'avoir' && due > 0 && !!inv.due_date && inv.due_date < asOf;
  const daysLate = overdue ? Math.round((Date.parse(asOf) - Date.parse(inv.due_date!)) / 86400000) : 0;
  return { total_cents: inv.total_ttc_cents, paid_cents: paid, credited_cents: credited, due_cents: due, overdue, days_late: daysLate };
}

export function displayStatus(inv: Pick<Invoice, 'status' | 'kind' | 'due_date'>, due: number, asOf = today()): DisplayStatus {
  if ((inv.status === 'emise' || inv.status === 'partiellement_payee') && inv.kind !== 'avoir' && due > 0 && inv.due_date && inv.due_date < asOf) return 'en_retard';
  return inv.status;
}

export async function getInvoice(db: Db, id: number): Promise<InvoiceFull | undefined> {
  const inv = await db.get<Invoice & { company_name: string; quote_number: string | null; credited_invoice_number: string | null }>(
    `SELECT i.*, c.name AS company_name, q.number AS quote_number, ci.number AS credited_invoice_number
     FROM invoices i JOIN companies c ON c.id = i.company_id LEFT JOIN quotes q ON q.id = i.quote_id
     LEFT JOIN invoices ci ON ci.id = i.credited_invoice_id WHERE i.id = ?`,
    [id],
  );
  if (!inv) return undefined;
  const lines = await loadLines(db, 'invoice_lines', 'invoice_id', id);
  const totals = inv.totals_json ? (JSON.parse(inv.totals_json) as Totals) : computeTotals(lines, { type: inv.global_discount_type, value: inv.global_discount_value });
  const payments = await db.all<Payment>('SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_at, id', [id]);
  const balance = await computeBalance(db, inv);
  const credit_notes = await db.all<any>("SELECT id, number, total_ttc_cents, status FROM invoices WHERE credited_invoice_id = ? AND kind = 'avoir' ORDER BY id", [id]);
  return { ...inv, lines, totals, payments, balance, credit_notes, display_status: displayStatus(inv, balance.due_cents) };
}

export interface InvoiceListRow extends Invoice {
  company_name: string;
  paid_cents: number;
  credited_cents: number;
  due_cents: number;
  display_status: DisplayStatus;
}

export async function listInvoices(
  db: Db,
  f: { status?: DisplayStatus | DisplayStatus[]; kind?: InvoiceKind; companyId?: number; projectId?: number; quoteId?: number; contractId?: number; search?: string; from?: string; to?: string; archived?: boolean } = {},
): Promise<InvoiceListRow[]> {
  const where: string[] = [f.archived ? 'i.archived_at IS NOT NULL' : 'i.archived_at IS NULL'];
  const params: any[] = [];
  if (f.kind) { where.push('i.kind = ?'); params.push(f.kind); }
  if (f.companyId != null) { where.push('i.company_id = ?'); params.push(f.companyId); }
  if (f.projectId != null) { where.push('i.project_id = ?'); params.push(f.projectId); }
  if (f.quoteId != null) { where.push('i.quote_id = ?'); params.push(f.quoteId); }
  if (f.contractId != null) { where.push('i.contract_id = ?'); params.push(f.contractId); }
  if (f.from) { where.push('COALESCE(i.issue_date, date(i.created_at)) >= ?'); params.push(f.from); }
  if (f.to) { where.push('COALESCE(i.issue_date, date(i.created_at)) <= ?'); params.push(f.to); }
  if (f.search?.trim()) {
    where.push("(lower(COALESCE(i.number,'')) LIKE ? OR lower(i.title) LIKE ? OR lower(c.name) LIKE ?)");
    const s = `%${f.search.trim().toLowerCase()}%`;
    params.push(s, s, s);
  }
  const rows = await db.all<InvoiceListRow>(
    `SELECT i.*, c.name AS company_name,
       COALESCE((SELECT SUM(amount_cents) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid_cents,
       CASE WHEN i.kind = 'avoir' THEN 0 ELSE COALESCE((SELECT SUM(a.total_ttc_cents) FROM invoices a WHERE a.credited_invoice_id = i.id AND a.kind = 'avoir' AND a.status <> 'brouillon'), 0) END AS credited_cents
     FROM invoices i JOIN companies c ON c.id = i.company_id
     WHERE ${where.join(' AND ')}
     ORDER BY CASE WHEN i.status = 'brouillon' THEN 0 ELSE 1 END, COALESCE(i.issue_date, date(i.created_at)) DESC, i.id DESC`,
    params,
  );
  const asOf = today();
  for (const r of rows) {
    r.due_cents = r.status === 'brouillon' || r.status === 'annulee' ? 0 : r.total_ttc_cents - r.paid_cents - r.credited_cents;
    if (r.kind === 'avoir') r.due_cents = 0;
    r.display_status = displayStatus(r, r.due_cents, asOf);
  }
  if (f.status) {
    const st = Array.isArray(f.status) ? f.status : [f.status];
    return rows.filter((r) => st.includes(r.display_status) || (st.includes('emise') && r.display_status === 'en_retard' && st.includes('en_retard')));
  }
  return rows;
}

// ---------- Émission ----------

export async function checkInvoice(db: Db, id: number, issueDate = today()): Promise<IssueCheck> {
  const inv = await getInvoice(db, id);
  assert(inv, 'Facture introuvable.');
  const s = await getAllSettings(db);
  const client = await buildClientSnapshot(db, inv.company_id, inv.contact_id);
  const check = checkBeforeIssue(s, { kind: 'facture', client, lines: inv.lines, totals: inv.totals, allowNegative: inv.kind === 'solde' });
  if (issueDate > today()) check.errors.push("La date d'émission ne peut pas être dans le futur.");
  if (inv.kind === 'solde' && inv.totals.total_ttc_cents < 0) check.errors.push('Le total de la facture de solde est négatif : les acomptes dépassent le montant du devis.');
  if (inv.kind === 'avoir') {
    if (!inv.credited_invoice_id) check.errors.push("Un avoir doit être rattaché à la facture qu'il rectifie.");
    else {
      const orig = await db.get<Invoice>('SELECT * FROM invoices WHERE id = ?', [inv.credited_invoice_id]);
      if (!orig || orig.status === 'brouillon') check.errors.push("La facture d'origine doit être émise.");
      else {
        const already = (await db.get<{ s: number }>("SELECT COALESCE(SUM(total_ttc_cents),0) AS s FROM invoices WHERE credited_invoice_id = ? AND kind = 'avoir' AND status <> 'brouillon'", [orig.id]))!.s;
        if (inv.totals.total_ttc_cents > orig.total_ttc_cents - already) {
          check.errors.push(`Le montant de l'avoir dépasse le montant restant à créditer sur la facture ${orig.number}.`);
        }
      }
    }
  }
  // Ordre chronologique de la série
  const series = inv.kind === 'avoir' ? "kind = 'avoir'" : "kind <> 'avoir'";
  const last = await db.get<{ d: string | null }>(`SELECT MAX(issue_date) AS d FROM invoices WHERE status <> 'brouillon' AND ${series}`);
  if (last?.d && issueDate < last.d) {
    check.errors.push(`La date d'émission (${issueDate}) est antérieure à celle de la dernière facture émise de la série (${last.d}) : la numérotation doit rester chronologique.`);
  }
  return check;
}

/** Émet la facture : numéro définitif, instantanés figés, statut « émise ». */
export async function issueInvoice(db: Db, id: number, opts: { issueDate?: string; dueDate?: string } = {}): Promise<InvoiceSnapshot> {
  const issueDate = opts.issueDate ?? today();
  const check = await checkInvoice(db, id, issueDate);
  if (check.errors.length) throw new BusinessError('La facture ne peut pas être émise :', check.errors);
  const s = await getAllSettings(db);
  const snapshot = await db.tx(async (t) => {
    const inv = await getInvoice(t, id);
    assert(inv, 'Facture introuvable.');
    assert(inv.status === 'brouillon', 'Cette facture a déjà été émise.');
    const number = await nextNumber(t, inv.kind === 'avoir' ? 'avoir' : 'facture', issueDate, s);
    const dueDate = inv.kind === 'avoir' ? null : opts.dueDate ?? inv.due_date ?? addDays(issueDate, s.payment.default_terms_days);
    if (dueDate && dueDate < issueDate) throw new BusinessError("L'échéance ne peut pas précéder la date d'émission.");
    const client = await buildClientSnapshot(t, inv.company_id, inv.contact_id);
    const seller = sellerSnapshot(s);
    const mentions = legalMentions(s, 'facture', client);
    const credited = inv.credited_invoice_id ? await t.get<Invoice>('SELECT * FROM invoices WHERE id = ?', [inv.credited_invoice_id]) : undefined;
    const snap: InvoiceSnapshot = {
      type: 'facture',
      kind: inv.kind,
      invoice_uuid: inv.uuid,
      number,
      title: inv.title,
      issue_date: issueDate,
      due_date: dueDate,
      service_date: inv.service_date,
      seller,
      client,
      lines: inv.lines.map(({ id: _i, ...l }: any) => { delete l.invoice_id; return l; }),
      global_discount: { type: inv.global_discount_type, value: inv.global_discount_value },
      totals: inv.totals,
      payment_terms: inv.kind === 'avoir' ? '' : inv.payment_terms ?? s.payment.payment_terms_text,
      legal_mentions: mentions,
      footer_notes: inv.footer_notes ?? '',
      quote_number: inv.quote_number,
      credited_invoice_number: credited?.number ?? null,
      credited_invoice_date: credited?.issue_date ?? null,
    };
    await t.run(
      `UPDATE invoices SET status = 'emise', number = ?, issue_date = ?, due_date = ?, client_snapshot = ?, seller_snapshot = ?,
         totals_json = ?, legal_mentions = ?, payment_terms = ?, total_ht_cents = ?, total_vat_cents = ?, total_ttc_cents = ?,
         issued_at = strftime('%Y-%m-%dT%H:%M:%fZ','now'), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      [
        number, issueDate, dueDate, JSON.stringify(client), JSON.stringify(seller), JSON.stringify(inv.totals), JSON.stringify(mentions),
        snap.payment_terms, inv.totals.total_ht_cents, inv.totals.total_vat_cents, inv.totals.total_ttc_cents, id,
      ],
    );
    const label = INVOICE_KINDS.find((k) => k.key === inv.kind)!.label;
    await logEvent(t, { entity: 'facture', id, action: 'emission', summary: `${label} ${number} émise`, details: { total_ttc_cents: inv.totals.total_ttc_cents }, companyId: inv.company_id });
    if (inv.kind === 'avoir' && credited) await refreshInvoiceStatus(t, credited.id);
    return snap;
  });
  if (snapshot.kind !== 'avoir') await convertToClient(db, snapshot.client.company_id, `facture ${snapshot.number} émise`);
  return snapshot;
}

/** Instantané d'une facture émise (ou aperçu d'un brouillon). */
export async function invoiceSnapshot(db: Db, id: number): Promise<InvoiceSnapshot> {
  const inv = await getInvoice(db, id);
  assert(inv, 'Facture introuvable.');
  const s = await getAllSettings(db);
  const credited = inv.credited_invoice_id ? await db.get<Invoice>('SELECT * FROM invoices WHERE id = ?', [inv.credited_invoice_id]) : undefined;
  const client = inv.client_snapshot ? (JSON.parse(inv.client_snapshot) as ClientSnapshot) : await buildClientSnapshot(db, inv.company_id, inv.contact_id);
  return {
    type: 'facture',
    kind: inv.kind,
    invoice_uuid: inv.uuid,
    number: inv.number ?? 'BROUILLON',
    title: inv.title,
    issue_date: inv.issue_date ?? today(),
    due_date: inv.due_date ?? (inv.kind === 'avoir' ? null : addDays(today(), s.payment.default_terms_days)),
    service_date: inv.service_date,
    seller: inv.seller_snapshot ? JSON.parse(inv.seller_snapshot) : sellerSnapshot(s),
    client,
    lines: inv.lines,
    global_discount: { type: inv.global_discount_type, value: inv.global_discount_value },
    totals: inv.totals,
    payment_terms: inv.payment_terms ?? '',
    legal_mentions: inv.legal_mentions ? JSON.parse(inv.legal_mentions) : legalMentions(s, 'facture', client),
    footer_notes: inv.footer_notes ?? '',
    quote_number: inv.quote_number,
    credited_invoice_number: credited?.number ?? null,
    credited_invoice_date: credited?.issue_date ?? null,
  };
}

export async function attachInvoicePdf(db: Db, id: number, pdfPath: string, sha256: string): Promise<void> {
  const inv = await db.get<Invoice>('SELECT * FROM invoices WHERE id = ?', [id]);
  assert(inv, 'Facture introuvable.');
  assert(inv.status !== 'brouillon', 'Le PDF définitif ne peut être enregistré qu\'après émission.');
  if (inv.pdf_sha256) {
    if (inv.pdf_sha256 === sha256) return;
    throw new BusinessError('Le PDF de cette facture est déjà enregistré et ne peut pas être remplacé.');
  }
  await db.run('UPDATE invoices SET pdf_path = ?, pdf_sha256 = ? WHERE id = ?', [pdfPath, sha256, id]);
}

/** Recalcule le statut (émise / partiellement payée / payée / annulée) d'après paiements et avoirs. */
export async function refreshInvoiceStatus(db: Db, id: number): Promise<InvoiceStatus> {
  const inv = await db.get<Invoice>('SELECT * FROM invoices WHERE id = ?', [id]);
  assert(inv, 'Facture introuvable.');
  if (inv.status === 'brouillon' || inv.kind === 'avoir') return inv.status;
  const b = await computeBalance(db, inv);
  let status: InvoiceStatus;
  if (b.credited_cents >= inv.total_ttc_cents) status = 'annulee';
  else if (b.due_cents <= 0) status = 'payee';
  else if (b.paid_cents > 0 || b.credited_cents > 0) status = 'partiellement_payee';
  else status = 'emise';
  if (status !== inv.status) {
    await db.run(
      `UPDATE invoices SET status = ?, cancelled_at = CASE WHEN ? = 'annulee' THEN strftime('%Y-%m-%dT%H:%M:%fZ','now') ELSE cancelled_at END,
         updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
      [status, status, id],
    );
  }
  return status;
}

// ---------- Paiements ----------

export async function addPayment(
  db: Db,
  invoiceId: number,
  p: { amount_cents: number; paid_at: string; method: string; reference?: string | null; notes?: string | null },
): Promise<number> {
  if (!Number.isSafeInteger(p.amount_cents) || p.amount_cents <= 0) throw new BusinessError('Le montant du paiement doit être positif.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.paid_at)) throw new BusinessError('Date de paiement invalide.');
  if (p.paid_at > today()) throw new BusinessError('La date de paiement ne peut pas être dans le futur.');
  return db.tx(async (t) => {
    const inv = await t.get<Invoice>('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
    assert(inv, 'Facture introuvable.');
    assert(inv.kind !== 'avoir', 'Un paiement ne peut pas être enregistré sur un avoir.');
    assert(inv.status === 'emise' || inv.status === 'partiellement_payee', inv.status === 'brouillon' ? 'Émettez la facture avant d\'enregistrer un paiement.' : 'Cette facture est déjà soldée ou annulée.');
    const b = await computeBalance(t, inv);
    if (p.amount_cents > b.due_cents) {
      throw new BusinessError(`Le paiement (${(p.amount_cents / 100).toFixed(2).replace('.', ',')} €) dépasse le solde restant dû (${(b.due_cents / 100).toFixed(2).replace('.', ',')} €).`);
    }
    if (inv.issue_date && p.paid_at < inv.issue_date) {
      // Possible (acompte reçu avant facture) mais on le signale dans le journal.
    }
    const r = await t.run('INSERT INTO payments (invoice_id, amount_cents, paid_at, method, reference, notes) VALUES (?, ?, ?, ?, ?, ?)', [
      invoiceId, p.amount_cents, p.paid_at, p.method, p.reference ?? null, p.notes ?? null,
    ]);
    const status = await refreshInvoiceStatus(t, invoiceId);
    await logEvent(t, {
      entity: 'paiement', id: r.lastInsertId, action: 'creation',
      summary: `Paiement de ${(p.amount_cents / 100).toFixed(2).replace('.', ',')} € reçu sur ${inv.number} (${status === 'payee' ? 'facture soldée' : 'paiement partiel'})`,
      companyId: inv.company_id,
    });
    return r.lastInsertId;
  });
}

export async function deletePayment(db: Db, paymentId: number, reason: string): Promise<void> {
  assert(reason.trim(), 'Indiquez le motif de la suppression du paiement.');
  await db.tx(async (t) => {
    const p = await t.get<Payment>('SELECT * FROM payments WHERE id = ?', [paymentId]);
    assert(p, 'Paiement introuvable.');
    const inv = await t.get<Invoice>('SELECT * FROM invoices WHERE id = ?', [p.invoice_id]);
    await t.run('DELETE FROM payments WHERE id = ?', [paymentId]);
    await refreshInvoiceStatus(t, p.invoice_id);
    await logEvent(t, {
      entity: 'paiement', id: paymentId, action: 'suppression',
      summary: `Paiement de ${(p.amount_cents / 100).toFixed(2).replace('.', ',')} € du ${p.paid_at} supprimé sur ${inv?.number} — motif : ${reason.trim()}`,
      details: p, companyId: inv?.company_id,
    });
  });
}

export async function listPayments(db: Db, f: { from?: string; to?: string; companyId?: number; method?: string } = {}) {
  const where: string[] = [];
  const params: any[] = [];
  if (f.from) { where.push('p.paid_at >= ?'); params.push(f.from); }
  if (f.to) { where.push('p.paid_at <= ?'); params.push(f.to); }
  if (f.companyId != null) { where.push('i.company_id = ?'); params.push(f.companyId); }
  if (f.method) { where.push('p.method = ?'); params.push(f.method); }
  return db.all<Payment & { invoice_number: string; company_name: string; company_id: number }>(
    `SELECT p.*, i.number AS invoice_number, c.name AS company_name, i.company_id FROM payments p
     JOIN invoices i ON i.id = p.invoice_id JOIN companies c ON c.id = i.company_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.paid_at DESC, p.id DESC`,
    params,
  );
}

// ---------- Depuis un devis : facture totale, d'acompte, de solde ----------

export async function quoteInvoicingState(db: Db, quoteId: number) {
  const q = await getQuote(db, quoteId);
  assert(q, 'Devis introuvable.');
  const invs = await db.all<Invoice>("SELECT * FROM invoices WHERE quote_id = ? AND status <> 'brouillon' ORDER BY issue_date, id", [quoteId]);
  const drafts = await db.all<Invoice>("SELECT * FROM invoices WHERE quote_id = ? AND status = 'brouillon'", [quoteId]);
  const deposits = invs.filter((i) => i.kind === 'acompte');
  const hasFinal = invs.some((i) => i.kind === 'solde' || i.kind === 'facture');
  return { quote: q, issued: invs, drafts, deposits, hasFinal, deposits_ttc_cents: deposits.reduce((a, b) => a + b.total_ttc_cents, 0) };
}

export async function createInvoiceFromQuote(
  db: Db,
  quoteId: number,
  mode: 'totale' | 'acompte' | 'solde',
  opts: { depositType?: DiscountType; depositValue?: number } = {},
): Promise<number> {
  const state = await quoteInvoicingState(db, quoteId);
  const q = state.quote;
  if (q.status !== 'accepte') throw new BusinessError('Seul un devis accepté peut être facturé.');
  if (state.hasFinal) throw new BusinessError('Ce devis a déjà fait l\'objet d\'une facture finale (totale ou de solde).');
  const base = {
    company_id: q.company_id,
    contact_id: q.contact_id,
    quote_id: q.id,
    project_id: q.project_id,
    payment_terms: q.payment_terms,
    template_id: null,
  };
  const quoteLines = q.lines.map(({ id: _i, ...l }: any) => { delete l.quote_id; return l as DocLine; });

  if (mode === 'totale') {
    if (state.deposits.length) throw new BusinessError('Des acomptes ont déjà été facturés : créez une facture de solde.');
    return createInvoiceDraft(db, {
      ...base, kind: 'facture', title: q.title || `Devis ${q.number}`,
      global_discount_type: q.global_discount_type, global_discount_value: q.global_discount_value, lines: quoteLines,
    });
  }

  if (mode === 'acompte') {
    const type = opts.depositType ?? q.deposit_type;
    const value = opts.depositValue ?? q.deposit_value;
    if (type === 'none' || value <= 0) throw new BusinessError("Indiquez le pourcentage ou le montant de l'acompte.");
    const amount = depositAmount(q.totals.total_ttc_cents, type, value);
    if (state.deposits_ttc_cents + amount > q.totals.total_ttc_cents) throw new BusinessError('Le total des acomptes dépasserait le montant du devis.');
    const parts = splitDepositByRate(q.totals.vat, amount).filter((p) => p.base_cents + p.vat_cents !== 0);
    const label = type === 'percent' ? `Acompte de ${formatRate(value)} sur le devis ${q.number}` : `Acompte sur le devis ${q.number}`;
    const lines: DocLine[] = parts.map((p) => ({
      kind: 'item', designation: parts.length > 1 ? `${label} (part TVA ${formatRate(p.rate_bp)})` : label,
      description: q.title || null, quantity_milli: 1000, unit: 'forfait', unit_price_cents: p.base_cents,
      discount_type: 'none', discount_value: 0, vat_rate_bp: p.rate_bp,
    }));
    return createInvoiceDraft(db, { ...base, kind: 'acompte', title: `Acompte — ${q.title || 'devis ' + q.number}`, lines });
  }

  // Solde : toutes les lignes du devis, la remise globale convertie en lignes
  // par taux, puis déduction de chaque acompte facturé (par taux de TVA).
  const lines: DocLine[] = [...quoteLines];
  if (q.totals.global_discount_cents > 0) {
    // Même répartition que computeTotals : au prorata des bases HT de chaque taux.
    const grossByRate = q.totals.vat.map((v) =>
      q.lines.reduce((acc, l, idx) => (l.kind === 'item' && l.vat_rate_bp === v.rate_bp ? acc + q.totals.lines[idx].ht_cents : acc), 0),
    );
    const shares = allocate(q.totals.global_discount_cents, grossByRate.map((g) => Math.max(g, 0)));
    q.totals.vat.forEach((v, i) => {
      if (shares[i] === 0) return;
      lines.push({
        kind: 'item', designation: q.totals.vat.length > 1 ? `Remise commerciale (TVA ${formatRate(v.rate_bp)})` : 'Remise commerciale',
        quantity_milli: 1000, unit: 'forfait', unit_price_cents: -shares[i], discount_type: 'none', discount_value: 0, vat_rate_bp: v.rate_bp,
      });
    });
  }
  for (const dep of state.deposits) {
    const depLines = await loadLines(db, 'invoice_lines', 'invoice_id', dep.id);
    for (const l of depLines) {
      if (l.kind !== 'item') continue;
      lines.push({
        kind: 'item', designation: `Acompte déjà facturé — ${dep.number} du ${dep.issue_date!.split('-').reverse().join('/')}`,
        quantity_milli: 1000, unit: 'forfait', unit_price_cents: -computeTotals([l]).total_ht_cents, discount_type: 'none', discount_value: 0, vat_rate_bp: l.vat_rate_bp,
      });
    }
  }
  return createInvoiceDraft(db, { ...base, kind: state.deposits.length ? 'solde' : 'facture', title: `Solde — ${q.title || 'devis ' + q.number}`, lines });
}

// ---------- Avoirs ----------

/** Prépare un avoir (brouillon) : total (copie des lignes) ou partiel (lignes saisies). */
export async function createCreditNote(db: Db, invoiceId: number, opts: { mode: 'total' | 'partiel'; reason: string; lines?: DocLine[] }): Promise<number> {
  assert(opts.reason.trim(), "Indiquez le motif de l'avoir.");
  const inv = await getInvoice(db, invoiceId);
  assert(inv, 'Facture introuvable.');
  assert(inv.kind !== 'avoir', 'Un avoir ne peut pas être rectifié par un autre avoir.');
  assert(inv.status !== 'brouillon', 'Une facture brouillon se modifie ou se supprime directement : aucun avoir n\'est nécessaire.');
  const remaining = inv.total_ttc_cents - inv.balance.credited_cents;
  assert(remaining > 0, 'Cette facture est déjà entièrement créditée.');
  let lines: DocLine[];
  if (opts.mode === 'total') {
    if (inv.balance.credited_cents > 0) throw new BusinessError('Un avoir partiel existe déjà : créez un avoir partiel pour le solde.');
    lines = inv.lines.map(({ id: _i, ...l }: any) => { delete l.invoice_id; return l; });
  } else {
    assert(opts.lines && opts.lines.some((l) => l.kind === 'item'), "Saisissez au moins une ligne d'avoir.");
    lines = opts.lines!;
  }
  return createInvoiceDraft(db, {
    company_id: inv.company_id,
    contact_id: inv.contact_id,
    quote_id: inv.quote_id,
    project_id: inv.project_id,
    contract_id: inv.contract_id,
    kind: 'avoir',
    credited_invoice_id: inv.id,
    title: `Avoir sur facture ${inv.number} — ${opts.reason.trim()}`,
    global_discount_type: opts.mode === 'total' ? inv.global_discount_type : 'none',
    global_discount_value: opts.mode === 'total' ? inv.global_discount_value : 0,
    lines,
  });
}

export async function duplicateInvoice(db: Db, id: number): Promise<number> {
  const inv = await getInvoice(db, id);
  assert(inv, 'Facture introuvable.');
  assert(inv.kind !== 'avoir', 'Un avoir ne peut pas être dupliqué.');
  const newId = await createInvoiceDraft(db, {
    company_id: inv.company_id, contact_id: inv.contact_id, project_id: inv.project_id, kind: inv.kind === 'acompte' || inv.kind === 'solde' ? 'facture' : inv.kind,
    title: inv.title, global_discount_type: inv.global_discount_type, global_discount_value: inv.global_discount_value,
    payment_terms: inv.payment_terms, footer_notes: inv.footer_notes, template_id: inv.template_id,
    lines: inv.lines.map(({ id: _i, ...l }: any) => { delete l.invoice_id; return l; }),
  });
  await logEvent(db, { entity: 'facture', id: newId, action: 'duplication', summary: `Brouillon créé par duplication de ${inv.number ?? 'un brouillon'}`, companyId: inv.company_id });
  return newId;
}

export async function archiveInvoice(db: Db, id: number, archived = true): Promise<void> {
  const inv = await db.get<Invoice>('SELECT * FROM invoices WHERE id = ?', [id]);
  assert(inv, 'Facture introuvable.');
  if (archived && (inv.status === 'emise' || inv.status === 'partiellement_payee')) {
    throw new BusinessError('Une facture non soldée ne peut pas être archivée.');
  }
  await db.run(`UPDATE invoices SET archived_at = ${archived ? "strftime('%Y-%m-%dT%H:%M:%fZ','now')" : 'NULL'} WHERE id = ?`, [id]);
  await logEvent(db, { entity: 'facture', id, action: archived ? 'archivage' : 'desarchivage', summary: `${inv.number ?? 'Brouillon'} ${archived ? 'archivé(e)' : 'désarchivé(e)'}`, companyId: inv.company_id });
}

// ---------- Relances de paiement ----------

export type ReminderLevel = 'avant_echeance' | 'relance_1' | 'relance_finale';

export async function recordReminder(db: Db, invoiceId: number, level: ReminderLevel, channel: 'copie' | 'messagerie' | 'smtp', subject: string, body: string): Promise<void> {
  const inv = await db.get<Invoice>('SELECT * FROM invoices WHERE id = ?', [invoiceId]);
  assert(inv, 'Facture introuvable.');
  await db.run('INSERT INTO payment_reminders (invoice_id, level, channel, subject, body) VALUES (?, ?, ?, ?, ?)', [invoiceId, level, channel, subject, body]);
  const label = { avant_echeance: 'Rappel avant échéance', relance_1: 'Première relance', relance_finale: 'Relance finale' }[level];
  await logEvent(db, { entity: 'facture', id: invoiceId, action: 'relance', summary: `${label} préparée pour ${inv.number} (${channel === 'copie' ? 'texte copié' : channel === 'messagerie' ? 'ouverte dans la messagerie' : 'envoyée par SMTP'})`, companyId: inv.company_id });
}

export async function listReminders(db: Db, invoiceId: number) {
  return db.all<any>('SELECT * FROM payment_reminders WHERE invoice_id = ? ORDER BY created_at DESC', [invoiceId]);
}

/** Niveau de relance suggéré selon l'échéance et les relances déjà faites. */
export async function suggestedReminderLevel(db: Db, invoiceId: number): Promise<ReminderLevel | null> {
  const inv = await getInvoice(db, invoiceId);
  if (!inv || inv.kind === 'avoir' || !['emise', 'partiellement_payee'].includes(inv.status) || inv.balance.due_cents <= 0) return null;
  const done = await listReminders(db, invoiceId);
  if (!inv.balance.overdue) return 'avant_echeance';
  if (!done.some((r) => r.level === 'relance_1')) return 'relance_1';
  return 'relance_finale';
}
