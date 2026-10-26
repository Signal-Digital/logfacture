/**
 * Éléments communs aux devis et factures : lignes, instantané vendeur,
 * numérotation, mentions légales, contrôles avant émission.
 */
import type { Db } from '@/lib/db';
import { computeTotals, type DiscountType, type LineInput, type Totals } from '@/lib/money';
import { formatRate } from '@/lib/format';
import { BusinessError } from './context';
import {
  checkAdministrativeSetup,
  getAllSettings,
  sellerDisplayName,
  type AllSettings,
  type VatRegime,
} from './settings';
import type { ClientSnapshot } from './companies';

export interface DocLine extends LineInput {
  id?: number;
  position?: number;
  kind: 'item' | 'section' | 'text';
  service_id?: number | null;
  designation: string;
  description?: string | null;
  unit?: string | null;
  is_recurring?: number | boolean;
}

export const LINE_COLUMNS = [
  'position', 'kind', 'service_id', 'designation', 'description', 'quantity_milli', 'unit', 'unit_price_cents',
  'discount_type', 'discount_value', 'vat_rate_bp', 'is_recurring',
] as const;

export function emptyLine(vatRateBp: number): DocLine {
  return { kind: 'item', designation: '', description: '', quantity_milli: 1000, unit: 'forfait', unit_price_cents: 0, discount_type: 'none', discount_value: 0, vat_rate_bp: vatRateBp, is_recurring: 0 };
}

export function normalizeLines(lines: DocLine[]): DocLine[] {
  return lines.map((l, i) => ({
    kind: l.kind ?? 'item',
    service_id: l.service_id ?? null,
    designation: (l.designation ?? '').trim(),
    description: l.description?.trim() || null,
    quantity_milli: l.kind === 'item' || !l.kind ? Math.round(l.quantity_milli ?? 0) : 0,
    unit: l.unit?.trim() || null,
    unit_price_cents: l.kind === 'item' || !l.kind ? Math.round(l.unit_price_cents ?? 0) : 0,
    discount_type: (l.discount_type ?? 'none') as DiscountType,
    discount_value: l.discount_type && l.discount_type !== 'none' ? Math.round(l.discount_value ?? 0) : 0,
    vat_rate_bp: Math.round(l.vat_rate_bp ?? 0),
    is_recurring: l.is_recurring ? 1 : 0,
    position: i + 1,
  }));
}

export function validateLines(lines: DocLine[], opts: { allowNegative?: boolean } = {}): string[] {
  const errors: string[] = [];
  lines.forEach((l, i) => {
    const n = i + 1;
    if (l.kind === 'item') {
      if (!l.designation.trim()) errors.push(`Ligne ${n} : la désignation est obligatoire.`);
      if (!opts.allowNegative && l.quantity_milli < 0) errors.push(`Ligne ${n} : quantité négative.`);
      if (l.vat_rate_bp < 0 || l.vat_rate_bp > 10000) errors.push(`Ligne ${n} : taux de TVA invalide.`);
      if (l.discount_type === 'percent' && (l.discount_value < 0 || l.discount_value > 10000)) errors.push(`Ligne ${n} : remise invalide.`);
    } else if (!l.designation.trim()) {
      errors.push(`Ligne ${n} : le titre de section ou le texte est vide.`);
    }
  });
  try {
    computeTotals(lines);
  } catch (e: any) {
    errors.push(e.message);
  }
  return errors;
}

export async function saveLines(db: Db, table: 'quote_lines' | 'invoice_lines', fk: 'quote_id' | 'invoice_id', docId: number, lines: DocLine[]): Promise<void> {
  await db.run(`DELETE FROM ${table} WHERE ${fk} = ?`, [docId]);
  for (const l of normalizeLines(lines)) {
    await db.run(
      `INSERT INTO ${table} (${fk}, ${LINE_COLUMNS.join(', ')}) VALUES (?, ${LINE_COLUMNS.map(() => '?').join(', ')})`,
      [docId, ...LINE_COLUMNS.map((c) => (l as any)[c] ?? null)],
    );
  }
}

export async function loadLines(db: Db, table: 'quote_lines' | 'invoice_lines', fk: 'quote_id' | 'invoice_id', docId: number): Promise<DocLine[]> {
  return db.all<DocLine>(`SELECT * FROM ${table} WHERE ${fk} = ? ORDER BY position, id`, [docId]);
}

// ---------- Vendeur ----------

export interface SellerSnapshot {
  display_name: string;
  trade_name: string;
  legal_name: string;
  legal_status: string;
  manager: string;
  address_line1: string;
  address_line2: string;
  postal_code: string;
  city: string;
  country: string;
  email: string;
  phone: string;
  website: string;
  siret: string;
  siren: string;
  ape_code: string;
  rcs_rm: string;
  vat_number: string;
  vat_regime: VatRegime;
  franchise_mention: string;
  iban: string;
  bic: string;
  bank_name: string;
  account_holder: string;
  logo_path: string;
}

export function sellerSnapshot(s: AllSettings): SellerSnapshot {
  const c = s.company;
  return {
    display_name: sellerDisplayName(c),
    trade_name: c.trade_name,
    legal_name: c.legal_name,
    legal_status: c.legal_status,
    manager: c.manager,
    address_line1: c.address_line1,
    address_line2: c.address_line2,
    postal_code: c.postal_code,
    city: c.city,
    country: c.country,
    email: c.email,
    phone: c.phone,
    website: c.website,
    siret: c.siret,
    siren: c.siren,
    ape_code: c.ape_code,
    rcs_rm: c.rcs_rm,
    vat_number: c.vat_number,
    vat_regime: s.vat.regime,
    franchise_mention: s.vat.franchise_mention,
    iban: s.payment.iban,
    bic: s.payment.bic,
    bank_name: s.payment.bank_name,
    account_holder: s.payment.account_holder || sellerDisplayName(c),
    logo_path: c.logo_path,
  };
}

// ---------- Numérotation ----------

export type Series = 'facture' | 'avoir' | 'devis';

export function formatNumber(format: string, n: number, dateIso: string, minDigits: number): string {
  const [y, m] = dateIso.split('-');
  return format
    .replace(/\{AAAA\}/g, y)
    .replace(/\{AA\}/g, y.slice(2))
    .replace(/\{MM\}/g, m)
    .replace(/\{N\}/g, String(n).padStart(minDigits, '0'));
}

export function seriesYear(format: string, dateIso: string): number {
  return /\{AAAA\}|\{AA\}/.test(format) ? Number(dateIso.slice(0, 4)) : 0;
}

/**
 * Réserve le numéro suivant d'une série (à appeler DANS une transaction).
 * La séquence est stockée en base : pas de doublon, pas de trou, même après
 * un redémarrage.
 */
export async function nextNumber(db: Db, series: Series, dateIso: string, s: AllSettings): Promise<string> {
  const format = series === 'facture' ? s.numbering.invoice_format : series === 'avoir' ? s.numbering.credit_format : s.numbering.quote_format;
  if (!format.includes('{N}')) throw new BusinessError('Le format de numérotation doit contenir {N}.');
  const year = seriesYear(format, dateIso);
  await db.run('INSERT INTO number_sequences (series, year, last_number) VALUES (?, ?, 0) ON CONFLICT(series, year) DO NOTHING', [series, year]);
  await db.run('UPDATE number_sequences SET last_number = last_number + 1 WHERE series = ? AND year = ?', [series, year]);
  const row = await db.get<{ last_number: number }>('SELECT last_number FROM number_sequences WHERE series = ? AND year = ?', [series, year]);
  const number = formatNumber(format, row!.last_number, dateIso, s.numbering.min_digits);
  const table = series === 'devis' ? 'quotes' : 'invoices';
  const clash = await db.get(`SELECT 1 FROM ${table} WHERE number = ?`, [number]);
  if (clash) {
    throw new BusinessError(
      `Le numéro ${number} existe déjà. Vérifiez le format de numérotation dans les paramètres (un changement de format en cours d'année peut provoquer ce conflit).`,
    );
  }
  return number;
}

// ---------- Mentions légales ----------

export function legalMentions(s: AllSettings, kind: 'facture' | 'devis', client?: ClientSnapshot | null): string[] {
  const out: string[] = [];
  if (s.vat.regime === 'franchise' && s.vat.franchise_mention.trim()) out.push(s.vat.franchise_mention.trim());
  if (s.vat.regime && s.vat.regime !== 'franchise' && s.vat.vat_on_debits) out.push('Option pour le paiement de la TVA d\'après les débits.');
  if (kind === 'facture') {
    if (s.payment.late_penalty_text.trim()) out.push(s.payment.late_penalty_text.trim());
    if (s.payment.recovery_fee_text.trim() && !client?.is_individual) out.push(s.payment.recovery_fee_text.trim());
    if (s.payment.early_payment_text.trim()) out.push(s.payment.early_payment_text.trim());
    if (s.legal.invoice_extra_mentions.trim()) out.push(s.legal.invoice_extra_mentions.trim());
  } else if (s.legal.quote_extra_mentions.trim()) {
    out.push(s.legal.quote_extra_mentions.trim());
  }
  if (client?.is_individual && s.legal.b2c_mention.trim()) out.push(s.legal.b2c_mention.trim());
  return out;
}

export function vatSummaryLabel(rateBp: number): string {
  return rateBp === 0 ? 'TVA 0 %' : `TVA ${formatRate(rateBp)}`;
}

// ---------- Contrôles avant émission ----------

export interface IssueCheck {
  errors: string[];
  warnings: string[];
}

export function checkBeforeIssue(
  s: AllSettings,
  doc: { kind: 'facture' | 'devis'; client: ClientSnapshot; lines: DocLine[]; totals: Totals; allowNegative?: boolean },
): IssueCheck {
  const errors: string[] = [];
  const warnings: string[] = [];
  for (const issue of checkAdministrativeSetup(s)) {
    if (issue.severity === 'bloquant') errors.push(`Paramètres : ${issue.label}`);
    else warnings.push(`Paramètres : ${issue.label}`);
  }
  if (!doc.client.name.trim()) errors.push('Le nom du client est obligatoire.');
  if (doc.kind === 'facture' && !(doc.client.address_line1 && doc.client.postal_code && doc.client.city)) {
    errors.push("L'adresse complète du client (adresse, code postal, ville) est obligatoire sur une facture.");
  }
  const items = doc.lines.filter((l) => l.kind === 'item');
  if (items.length === 0) errors.push('Le document doit contenir au moins une ligne de prestation.');
  errors.push(...validateLines(doc.lines, { allowNegative: doc.allowNegative }));
  if (s.vat.regime === 'franchise' && items.some((l) => l.vat_rate_bp !== 0)) {
    errors.push('Franchise en base de TVA : toutes les lignes doivent avoir un taux de TVA de 0 %.');
  }
  if (s.vat.regime && s.vat.regime !== 'franchise' && items.some((l) => l.vat_rate_bp === 0)) {
    warnings.push("Des lignes sont à 0 % de TVA alors que vous êtes assujetti : vérifiez qu'une exonération s'applique et ajoutez sa mention légale.");
  }
  if (doc.kind === 'facture' && doc.totals.total_ttc_cents <= 0 && !doc.allowNegative) errors.push('Le total de la facture doit être positif.');
  if (doc.kind === 'facture' && !doc.client.is_individual && !doc.client.siren) {
    warnings.push(
      "SIREN du client non renseigné : il deviendra obligatoire sur les factures entre professionnels avec la réforme de la facturation électronique (calendrier à vérifier).",
    );
  }
  return { errors: [...new Set(errors)], warnings: [...new Set(warnings)] };
}

export async function loadSettingsForDocs(db: Db): Promise<AllSettings> {
  return getAllSettings(db);
}
