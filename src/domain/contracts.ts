/**
 * Contrats et revenus récurrents.
 *
 * La préparation d'une facture récurrente crée un BROUILLON, enregistré dans
 * `contract_invoice_runs` avec une contrainte d'unicité (contrat, période) :
 * relancer l'application ou cliquer deux fois ne crée jamais de doublon.
 * L'émission automatique n'a lieu que si elle est activée explicitement
 * (paramètre global ET option du contrat).
 */
import type { Db } from '@/lib/db';
import { addDays, addMonths, today } from '@/lib/format';
import { logEvent } from './audit';
import { BusinessError, assert } from './context';
import { createInvoiceDraft, issueInvoice } from './invoices';
import { getSetting } from './settings';

export type Periodicity = 'mensuel' | 'trimestriel' | 'semestriel' | 'annuel';
export type ContractStatus = 'actif' | 'suspendu' | 'resilie' | 'termine';

export const PERIODICITIES: { key: Periodicity; label: string; months: number }[] = [
  { key: 'mensuel', label: 'Mensuel', months: 1 },
  { key: 'trimestriel', label: 'Trimestriel', months: 3 },
  { key: 'semestriel', label: 'Semestriel', months: 6 },
  { key: 'annuel', label: 'Annuel', months: 12 },
];

export const CONTRACT_STATUSES: { key: ContractStatus; label: string; tone: string }[] = [
  { key: 'actif', label: 'Actif', tone: 'success' },
  { key: 'suspendu', label: 'Suspendu', tone: 'warning' },
  { key: 'resilie', label: 'Résilié', tone: 'danger' },
  { key: 'termine', label: 'Terminé', tone: 'muted' },
];

export interface Contract {
  id: number;
  company_id: number;
  service_id: number | null;
  title: string;
  description: string | null;
  amount_cents: number;
  vat_rate_bp: number;
  periodicity: Periodicity;
  start_date: string;
  next_invoice_date: string | null;
  renewal_date: string | null;
  end_date: string | null;
  termination_terms: string | null;
  status: ContractStatus;
  auto_issue: number;
  payment_terms_days: number;
  quote_id: number | null;
  project_id: number | null;
  notes: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ContractRow extends Contract {
  company_name: string;
  service_name: string | null;
  monthly_cents: number;
  invoices_count: number;
}

export type ContractInput = Partial<Omit<Contract, 'id' | 'created_at' | 'updated_at' | 'archived_at'>> & { company_id: number; title: string; amount_cents: number; start_date: string };

const FIELDS = [
  'company_id', 'service_id', 'title', 'description', 'amount_cents', 'vat_rate_bp', 'periodicity', 'start_date', 'next_invoice_date',
  'renewal_date', 'end_date', 'termination_terms', 'status', 'auto_issue', 'payment_terms_days', 'quote_id', 'project_id', 'notes',
] as const;

export function periodMonths(p: Periodicity): number {
  return PERIODICITIES.find((x) => x.key === p)!.months;
}

/** Montant mensualisé (MRR) en centimes HT. */
export function monthlyAmount(c: Pick<Contract, 'amount_cents' | 'periodicity'>): number {
  return Math.round(c.amount_cents / periodMonths(c.periodicity));
}

function validate(c: Partial<ContractInput>) {
  if ('title' in c) assert(String(c.title ?? '').trim(), 'Le titre du contrat est obligatoire.');
  if (c.amount_cents != null && (!Number.isSafeInteger(c.amount_cents) || c.amount_cents < 0)) throw new BusinessError('Montant invalide.');
  if (c.start_date && c.end_date && c.end_date < c.start_date) throw new BusinessError('La date de fin précède la date de début.');
  if (c.periodicity && !PERIODICITIES.some((p) => p.key === c.periodicity)) throw new BusinessError('Périodicité invalide.');
}

export async function createContract(db: Db, input: ContractInput): Promise<number> {
  validate(input);
  const data: Record<string, any> = { periodicity: 'mensuel', status: 'actif', vat_rate_bp: 0, auto_issue: 0, payment_terms_days: 30 };
  for (const f of FIELDS) if (f in input) data[f] = (input as any)[f] ?? data[f] ?? null;
  data.title = String(data.title).trim();
  data.auto_issue = data.auto_issue ? 1 : 0;
  if (!data.next_invoice_date) data.next_invoice_date = data.start_date;
  if (!data.renewal_date) data.renewal_date = addMonths(data.start_date, 12);
  const keys = Object.keys(data);
  const r = await db.run(`INSERT INTO contracts (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`, keys.map((k) => data[k]));
  await logEvent(db, { entity: 'contrat', id: r.lastInsertId, action: 'creation', summary: `Contrat créé : ${data.title}`, companyId: data.company_id });
  return r.lastInsertId;
}

export async function updateContract(db: Db, id: number, input: Partial<ContractInput>): Promise<void> {
  validate(input);
  const keys = FIELDS.filter((f) => f in input);
  if (!keys.length) return;
  const c = await getContract(db, id);
  assert(c, 'Contrat introuvable.');
  await db.run(
    `UPDATE contracts SET ${keys.map((k) => `${k} = ?`).join(', ')}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?`,
    [...keys.map((k) => (k === 'auto_issue' ? ((input as any)[k] ? 1 : 0) : (input as any)[k] ?? null)), id],
  );
  await logEvent(db, { entity: 'contrat', id, action: 'modification', summary: `Contrat modifié : ${input.title ?? c.title}${input.status && input.status !== c.status ? ` (statut : ${input.status})` : ''}`, companyId: c.company_id });
}

export async function getContract(db: Db, id: number): Promise<Contract | undefined> {
  return db.get<Contract>('SELECT * FROM contracts WHERE id = ?', [id]);
}

export async function listContracts(db: Db, f: { companyId?: number; status?: ContractStatus; archived?: boolean } = {}): Promise<ContractRow[]> {
  const where = [f.archived ? 'k.archived_at IS NOT NULL' : 'k.archived_at IS NULL'];
  const params: any[] = [];
  if (f.companyId != null) { where.push('k.company_id = ?'); params.push(f.companyId); }
  if (f.status) { where.push('k.status = ?'); params.push(f.status); }
  const rows = await db.all<ContractRow>(
    `SELECT k.*, c.name AS company_name, s.name AS service_name,
       (SELECT COUNT(*) FROM contract_invoice_runs r WHERE r.contract_id = k.id) AS invoices_count
     FROM contracts k JOIN companies c ON c.id = k.company_id LEFT JOIN services s ON s.id = k.service_id
     WHERE ${where.join(' AND ')} ORDER BY CASE k.status WHEN 'actif' THEN 0 WHEN 'suspendu' THEN 1 ELSE 2 END, k.next_invoice_date`,
    params,
  );
  for (const r of rows) r.monthly_cents = monthlyAmount(r);
  return rows;
}

export interface DuePeriod {
  contract: Contract;
  period_start: string;
  period_end: string;
}

/** Périodes à facturer jusqu'à `asOf` (incluse), pour les contrats actifs. */
export async function duePeriods(db: Db, asOf = today()): Promise<DuePeriod[]> {
  const contracts = await db.all<Contract>("SELECT * FROM contracts WHERE status = 'actif' AND archived_at IS NULL AND next_invoice_date IS NOT NULL AND next_invoice_date <= ?", [asOf]);
  const out: DuePeriod[] = [];
  for (const c of contracts) {
    let start = c.next_invoice_date!;
    let guard = 0;
    while (start <= asOf && (!c.end_date || start <= c.end_date) && guard++ < 60) {
      const end = addDays(addMonths(start, periodMonths(c.periodicity)), -1);
      out.push({ contract: c, period_start: start, period_end: c.end_date && end > c.end_date ? c.end_date : end });
      start = addMonths(start, periodMonths(c.periodicity));
    }
  }
  return out;
}

function frDate(iso: string) {
  return iso.split('-').reverse().join('/');
}

/**
 * Prépare (brouillon) la facture d'une période. Idempotent : si la période a
 * déjà été préparée, retourne la facture existante.
 */
export async function prepareRecurringInvoice(db: Db, contractId: number, periodStart: string): Promise<{ invoiceId: number; created: boolean }> {
  return db.tx(async (t) => {
    const c = await getContract(t, contractId);
    assert(c, 'Contrat introuvable.');
    const existing = await t.get<{ invoice_id: number | null }>('SELECT invoice_id FROM contract_invoice_runs WHERE contract_id = ? AND period_start = ?', [contractId, periodStart]);
    if (existing?.invoice_id) return { invoiceId: existing.invoice_id, created: false };
    const months = periodMonths(c.periodicity);
    let periodEnd = addDays(addMonths(periodStart, months), -1);
    if (c.end_date && periodEnd > c.end_date) periodEnd = c.end_date;
    const service = c.service_id ? await t.get<any>('SELECT * FROM services WHERE id = ?', [c.service_id]) : null;
    const invoiceId = await createInvoiceDraft(t, {
      company_id: c.company_id,
      contract_id: c.id,
      project_id: c.project_id,
      kind: 'facture',
      title: `${c.title} — période du ${frDate(periodStart)} au ${frDate(periodEnd)}`,
      service_date: periodStart,
      lines: [{
        kind: 'item', service_id: c.service_id, designation: c.title,
        description: [c.description ?? service?.description, `Période du ${frDate(periodStart)} au ${frDate(periodEnd)}`].filter(Boolean).join('\n'),
        quantity_milli: 1000, unit: PERIODICITIES.find((p) => p.key === c.periodicity)!.label.toLowerCase(),
        unit_price_cents: c.amount_cents, discount_type: 'none', discount_value: 0, vat_rate_bp: c.vat_rate_bp, is_recurring: 1,
      }],
    });
    await t.run('INSERT INTO contract_invoice_runs (contract_id, period_start, period_end, invoice_id) VALUES (?, ?, ?, ?)', [contractId, periodStart, periodEnd, invoiceId]);
    const next = addMonths(periodStart, months);
    await t.run("UPDATE contracts SET next_invoice_date = CASE WHEN next_invoice_date IS NULL OR next_invoice_date <= ? THEN ? ELSE next_invoice_date END, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [periodStart, next, contractId]);
    if (c.end_date && next > c.end_date) await t.run("UPDATE contracts SET status = 'termine' WHERE id = ?", [contractId]);
    await logEvent(t, { entity: 'contrat', id: contractId, action: 'facture_preparee', summary: `Facture récurrente préparée (brouillon) : ${c.title}, période du ${frDate(periodStart)}`, companyId: c.company_id });
    return { invoiceId, created: true };
  });
}

/**
 * Traite les échéances : prépare les brouillons manquants et, uniquement si
 * l'émission automatique est activée (paramètre global ET contrat), les émet.
 */
export async function runRecurring(db: Db, asOf = today()): Promise<{ prepared: number; issued: number; errors: string[] }> {
  const automation = await getSetting(db, 'automation');
  const periods = await duePeriods(db, asOf);
  let prepared = 0;
  let issued = 0;
  const errors: string[] = [];
  for (const p of periods) {
    try {
      const r = await prepareRecurringInvoice(db, p.contract.id, p.period_start);
      if (r.created) prepared++;
      if (r.created && automation.recurring_auto_issue && p.contract.auto_issue) {
        const terms = p.contract.payment_terms_days;
        await issueInvoice(db, r.invoiceId, { dueDate: addDays(asOf, terms) });
        issued++;
      }
    } catch (e: any) {
      errors.push(`${p.contract.title} : ${e.message}`);
    }
  }
  return { prepared, issued, errors };
}

export async function recurringSummary(db: Db) {
  const rows = await listContracts(db, { status: 'actif' });
  const mrr = rows.reduce((a, r) => a + r.monthly_cents, 0);
  return { active: rows.length, mrr_cents: mrr, arr_cents: mrr * 12 };
}

export async function archiveContract(db: Db, id: number): Promise<void> {
  const c = await getContract(db, id);
  assert(c, 'Contrat introuvable.');
  await db.run("UPDATE contracts SET archived_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = ?", [id]);
  await logEvent(db, { entity: 'contrat', id, action: 'archivage', summary: `Contrat archivé : ${c.title}`, companyId: c.company_id });
}
